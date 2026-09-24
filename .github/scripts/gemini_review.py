"""
gemini_review.py: sends a PR diff or project files to Gemini 2.5 Pro for review.

Modes:
  Diff review (default): reads pr_diff.txt, reviews a PR or local changes.
  Full audit (REVIEW_FULL=1): reads pr_diff.txt as concatenated source files
    and produces a holistic project audit instead of a change-focused review.

Environment variables:
  GEMINI_API_KEY:  Google AI Studio API key
  PR_TITLE:        Pull request title or review label
  PR_BODY:         Pull request description (may be empty)
  REVIEW_FULL:     Set to "1" to activate full project audit mode
"""

import json
import os
import sys
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
PR_TITLE = os.environ.get("PR_TITLE", "(no title)")
PR_BODY = os.environ.get("PR_BODY", "")
REVIEW_FULL = os.environ.get("REVIEW_FULL", "") == "1"
MODEL = "gemini-2.5-pro"

# Truncate very large diffs so we stay well within the context window and
# avoid unexpectedly large token bills. 80 000 chars covers ~20 000 tokens.
# more than enough for any realistic PR.
MAX_DIFF_CHARS = 80_000

# ---------------------------------------------------------------------------
# System prompt: encodes this project's rules and conventions
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
You are a code reviewer for "yo", a personal Gmail-backed email client. The
frontend is React 19 + TypeScript + Vite + Tailwind CSS v4 (client/). The
backend is Express + TypeScript (server/), using the Gmail API for all mail
data and better-sqlite3 only for local triage state (screener decisions,
bucket assignments, OAuth tokens, sync cursor). Gmail itself remains the
source of truth for actual mail content, never duplicated at rest.

## The MailProvider abstraction

`server/src/mail-provider/GmailProvider.ts` is the ONLY file allowed to
import `googleapis`. Everything else (routes, screener logic, the sync
engine) depends only on the provider-neutral domain types in
`server/src/mail-provider/types.ts` and the `MailProvider` interface. Flag
any new code outside that one file that imports `googleapis` directly, or
that couples business logic to a Gmail-specific API shape instead of going
through `MailProvider`.

## Gmail API quota discipline

Gmail's API quota (6,000 units/minute/user) is tight enough to hit in normal
use. Every call must go through the existing patterns:
- Bulk operations use `mapWithConcurrency` (`server/src/lib/concurrency.ts`)
  to cap concurrent requests, not unbounded `Promise.all`.
- List endpoints use bounded page sizes, not unbounded fetches.
- Client-side retries are deliberately disabled (`server/src/main.tsx`'s
  QueryClient config); retrying a quota error only makes it worse. Don't
  reintroduce retry logic for Gmail-backed queries/mutations.

## The invalidateQueries quirk

`useInfiniteQuery` + `invalidateQueries` re-fetches the ENTIRE accumulated
page chain, not just page one, and `queryKey: ['threads']` prefix-matches
every list view (Yobox/Paper Trail/Feed/Sent) at once. Mutations should
patch the React Query cache directly (`setQueriesData`, see
`client/src/hooks/useThreads.ts`) instead of invalidating `['threads']`
flag any new mutation that calls `invalidateQueries({ queryKey: ['threads'] })`
or a prefix of it.

## Test/database isolation

`server/src/db/database.ts` must never let a test write into the real
`server/data/yo.db`. It defaults to `:memory:` when `process.env.VITEST` is
set and `DB_PATH` isn't explicitly overridden. Treat any change to this
file, or any new test that imports the `db` singleton in a way that could
bypass this check, as CRITICAL. This exact bug previously polluted the
real dev database with fake sender_approvals rows.

## Email content security

Email HTML is rendered only inside `EmailBodyFrame`'s sandboxed iframe
(`sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"`,
deliberately no `allow-scripts`), after passing through `sanitizeEmailHtml`
server-side. Flag any code that renders message HTML/content outside that
component, via `dangerouslySetInnerHTML` elsewhere, or that skips
sanitization before sending HTML to the client.

## Auth

Every `/api/*` route must sit behind the `requireAuth` middleware
(`server/src/index.ts`). Flag any new route mounted under `/api` that isn't
covered by it.

## Responsive design (Tailwind v4, mobile-first)

Base (unprefixed) Tailwind classes apply at every screen size; a
mobile-specific style change needs an explicit `sm:` (or other breakpoint)
override restoring the desktop value, or it silently applies to desktop
too. This has caused real regressions in this project before. Flag any
diff that changes sizing/spacing/color for what looks like a mobile-only
adjustment (comment, context, or narrow scope suggests it) without a
paired breakpoint override.

## Other conventions

- Sender logos come from BIMI (DNS TXT lookup, `server/src/lib/bimiLookup.ts`)
  and must always render via `<img>`, never inlined as raw SVG markup
  inlining defeats the browser's script-execution sandboxing for `<img>`.
- Screener/bucket state is implemented via real Gmail labels (`App/Screener-Pending`,
  `App/Screener-Blocked`, `App/Paper-Trail`, `App/Feed`) resolved through
  `ensureLabel`/`labelRegistry.ts`; flag hand-rolled label ID lookups that
  bypass it.
- SQL must go through better-sqlite3 prepared statement parameters, never
  string-concatenated/interpolated values.
- No secrets (API keys, session secrets, OAuth client secrets) committed in
  code or docs; they belong in `.env` (gitignored) or GitHub Actions secrets.

## What NOT to flag

- Tailwind arbitrary-value classes like `text-[0.9rem]` or `h-[2.4rem]`:
  intentional, precisely-computed sizing in this codebase, not sloppiness.
- Missing JSDoc/comments on internal (non-exported) helpers.
- The self-hosted Docker container running as root: a documented, accepted
  tradeoff for this personal single-user deployment.
- Minor naming preferences when the existing convention is already
  consistent.

## Response format

Reply in markdown using exactly this structure:

### Summary
One or two sentences on the overall quality of the change.

### Issues
For each issue found:
**[CRITICAL|HIGH|MEDIUM|LOW]** `path/to/file.ts`: brief description and why it matters.

If there are no issues, write: "No issues found."

### Suggestions
Optional non-blocking improvements. Omit this section entirely if there are none.
""".strip()


# ---------------------------------------------------------------------------
# Full audit system prompt
# ---------------------------------------------------------------------------

FULL_AUDIT_PROMPT = """
You are auditing the "yo" codebase: a personal Gmail-backed email client.
The frontend is React 19 + TypeScript + Vite + Tailwind CSS v4 (client/).
The backend is Express + TypeScript (server/), using the Gmail API for mail
data via a MailProvider abstraction, and better-sqlite3 only for local
triage state (never a copy of mail content).

Your job is a holistic review across the key source files provided. Look
for systemic issues, not line-by-line nits.

## What to assess

**1. MailProvider abstraction integrity**
`server/src/mail-provider/GmailProvider.ts` should be the only file
importing `googleapis`. Flag any other file that imports it directly or
otherwise leaks Gmail-specific shapes into routes/business logic.

**2. Gmail API quota discipline**
Bulk operations should use `mapWithConcurrency`, not unbounded concurrent
calls. List endpoints should use bounded page sizes. Client-side retries on
Gmail-backed queries should stay disabled.

**3. React Query cache discipline**
Mutations affecting thread lists should patch the cache directly
(`setQueriesData`) rather than calling `invalidateQueries` on `['threads']`
or a prefix of it, which re-fetches every accumulated page across every
list view.

**4. Test/database isolation**
`server/src/db/database.ts` must default to `:memory:` under `process.env.VITEST`
unless `DB_PATH` is explicitly set, so tests can never write into the real
`server/data/yo.db`.

**5. Security posture**
- Email HTML only ever rendered inside `EmailBodyFrame`'s sandboxed iframe,
  after `sanitizeEmailHtml`.
- Every `/api/*` route behind `requireAuth`.
- Sender logos (BIMI) rendered via `<img>`, never inlined as raw SVG.
- SQL via prepared statement parameters, never string concatenation.
- No secrets committed in code or docs.

**6. Responsive design consistency**
Tailwind is mobile-first; check that mobile-specific styling changes carry
a `sm:` (or other breakpoint) override restoring the desktop value, rather
than silently changing desktop too.

**7. TypeScript and React patterns**
- Functional components only.
- React Query hooks follow the existing `{ data, isLoading, error }` /
  mutation `{ mutate, isPending, error }` contract.
- New client-server contracts (routes + `client/src/lib/api.ts`) kept in
  sync: a route change without a matching `api.ts`/type update is a bug.

## What NOT to flag

- Tailwind arbitrary-value classes (`text-[0.9rem]`, `h-[2.4rem]`, etc.):
  intentional precise sizing, not sloppiness.
- Missing JSDoc on internal helpers.
- The self-hosted Docker container running as root: documented, accepted.
- Minor naming preferences where the existing convention is consistent.

## Response format

### Executive Summary
2–3 sentences on overall code health and the most important finding.

### Findings
For each issue, one per line:
**[CRITICAL|HIGH|MEDIUM|LOW]** `file`: description and why it matters.

Group findings by severity. If none in a category, omit it.

### What's working well
2–4 bullet points on patterns or decisions that are being done right.
""".strip()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    # Read the content written by the workflow step or review.sh
    try:
        with open("pr_diff.txt", "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except FileNotFoundError:
        print("ERROR: pr_diff.txt not found.", file=sys.stderr)
        sys.exit(1)

    if not content.strip():
        label = "Project Audit" if REVIEW_FULL else "Code Review"
        write_review(f"## 🤖 Gemini {label}\n\nNothing to review, no content provided.")
        return

    # Truncate if needed and note it in the content
    if len(content) > MAX_DIFF_CHARS:
        content = content[:MAX_DIFF_CHARS] + "\n\n[content truncated, too large to review in full]"

    if REVIEW_FULL:
        # Full audit mode: content is concatenated source files, not a diff.
        # Use the holistic audit prompt and a plain user message.
        system_prompt = FULL_AUDIT_PROMPT
        user_message = content
        output_label = "Gemini Project Audit"
    else:
        # Diff review mode: content is a git diff for a specific PR or local change.
        system_prompt = SYSTEM_PROMPT
        user_message = f"""## PR: {PR_TITLE}

{PR_BODY.strip() or '(no description provided)'}

## Diff

```diff
{content}
```
"""
        output_label = "Gemini Code Review"

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_message}],
            }
        ],
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "generationConfig": {
            # Low temperature for consistent, focused reviews
            "temperature": 0.2,
            # 2.5 Pro uses thinking tokens that count against maxOutputTokens.
            # 4096 was too small: the model exhausted its budget on reasoning
            # before producing any response text (finishReason=MAX_TOKENS with
            # empty parts). 16384 gives ~8k for thinking and ~8k for the reply.
            "maxOutputTokens": 16384,
            # Cap thinking tokens so the response always gets sufficient budget.
            # Without this, 2.5 Pro can spend the entire output budget on reasoning.
            "thinkingConfig": {
                "thinkingBudget": 8192,
            },
        },
    }

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{MODEL}:generateContent?key={GEMINI_API_KEY}"
    )

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    # Retry on transient errors (503 overload, 429 rate limit) with exponential backoff.
    # Gemini 2.5 Pro can be briefly unavailable during demand spikes.
    MAX_RETRIES = 4
    result = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                result = json.loads(response.read())
            break  # success: exit retry loop
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code in (429, 503) and attempt < MAX_RETRIES - 1:
                wait = 10 * (2 ** attempt)  # 10s, 20s, 40s
                print(f"Gemini returned {e.code} (attempt {attempt + 1}/{MAX_RETRIES}), retrying in {wait}s...", file=sys.stderr)
                import time; time.sleep(wait)
                # Rebuild the request object; it can't be reused after an error
                req = urllib.request.Request(
                    url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
            elif e.code in (429, 503):
                # All retries exhausted for a transient error: write a soft
                # failure comment so the PR check passes and merging isn't blocked.
                print(f"Gemini unavailable after {MAX_RETRIES} attempts ({e.code}). Writing soft-failure comment.", file=sys.stderr)
                write_review(
                    f"## 🤖 Gemini Code Review\n\n"
                    f"⚠️ Gemini is temporarily unavailable (HTTP {e.code}). "
                    f"Re-run the workflow once the service recovers.\n\n"
                    f"---\n*Attempted {MAX_RETRIES} times using [{MODEL}](https://ai.google.dev/)*"
                )
                return
            else:
                print(f"ERROR: Gemini API returned {e.code}: {body}", file=sys.stderr)
                sys.exit(1)
    if result is None:
        print("ERROR: All retries exhausted.", file=sys.stderr)
        sys.exit(1)

    # Gemini 2.5 Pro returns thinking tokens as extra parts before the real response.
    # Find the first non-thought part that contains text.
    candidate = result["candidates"][0]
    finish_reason = candidate.get("finishReason", "UNKNOWN")

    # "content" may be absent (MAX_TOKENS, SAFETY, RECITATION) or present but
    # without "parts" (empty/filtered response). Handle both cases gracefully.
    parts = candidate.get("content", {}).get("parts", [])
    review_text = next(
        (p["text"] for p in parts if "text" in p and not p.get("thought")),
        None,
    )
    if not review_text:
        print(f"WARNING: Gemini returned no usable text (finishReason={finish_reason}): {json.dumps(result)}", file=sys.stderr)
        write_review(
            f"## 🤖 Gemini Code Review\n\n"
            f"⚠️ Gemini returned an empty response (finishReason={finish_reason}). "
            f"This can happen when the diff is too large or triggers a safety filter. "
            f"Re-run the workflow or check the action logs for details.\n\n"
            f"---\n*Reviewed by [{MODEL}](https://ai.google.dev/)*"
        )
        return
    write_review(f"## 🤖 {output_label}\n\n{review_text}\n\n---\n*Reviewed by [{MODEL}](https://ai.google.dev/)*")
    print(f"Review written to gemini_review.md")


def write_review(content: str):
    with open("gemini_review.md", "w", encoding="utf-8") as f:
        f.write(content)


if __name__ == "__main__":
    main()
