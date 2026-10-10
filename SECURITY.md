# Security policy

## Reporting a vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/Mhoram/yo/security/advisories/new)
(**Security → Report a vulnerability**) rather than opening a public issue.

This is a personal project, so support is best-effort: I aim to acknowledge
reports within a week and will keep you updated on the fix. Once a fix is
released, you're welcome to credit in the advisory.

## Scope

yo is a self-hosted, single-user email client. The threat model assumes the
person with shell access on the host is the owner — the interesting attack
surface is everything that comes in over the wire or from Google:

- **In scope**
  - The OAuth flow: session handling, token storage in SQLite, the callback endpoint
  - Rendering of untrusted email HTML/CSS (sandboxed iframe in
    `client/src/components/EmailBodyFrame.tsx` — a script-execution or
    same-origin escape there is critical)
  - The Gmail-label manipulation the app performs (Gatekeeper, buckets)
  - Anything that would let another Google account take over or read the owner's mail
- **Out of scope**
  - Compromise of the host machine itself (see [`deploy/self-host.md`](./deploy/self-host.md)
    for the hardening posture: localhost-only port binding, Tailscale for access)
  - Gmail-side issues (report those to Google)
  - Spam or phishing content arriving in the mailbox — the Gatekeeper holds
    unknown senders, but it is a sorting tool, not a security boundary against
    malicious mail you choose to open

## Supported versions

Only the latest commit on `main` is supported. If you're self-hosting, pull
and rebuild regularly (`docker compose up -d --build`).
