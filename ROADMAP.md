# Roadmap

Roughly in the order I expect to get to them. Done items move to the README.

## Web Push notifications

A nudge when new senders land in the Gatekeeper, or when approved mail arrives in Yobox. The PWA shell (service worker, manifest) already exists, so this needs a push handler in the worker and a VAPID-configured endpoint on the server.

## Bucket suggestions at approval time

When a new sender is held, suggest Yobox, Receipts, or Feed based on their held mail: subject-line patterns, list headers, how similar senders were sorted. Approval stays a manual click; the suggestion just pre-fills the choice.

## Backup restore drill (recurring)

Nightly backups (03:17 cron) and the offsite S3 bucket are live, and the
restore path was drill-tested end to end. The drill should be repeated every
few months; the runbook is in `deploy/self-host.md` §8e.

## Gatekeeper label repair

`moveSenderToBucket` trusts the database and returns "already there" without checking whether the thread's Gmail labels actually match. If Gmail search lagged during approval (which happens), the thread keeps a stale pending label and shows up in neither Yobox nor the Gatekeeper list. The move endpoint should sweep stale pending-labeled threads for the sender before it no-ops. Longer term: some way to keep a dev instance and a production instance from both gating the same Gmail account, since they run separate decision databases.
