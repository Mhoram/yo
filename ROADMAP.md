# Roadmap

Roughly in the order I expect to get to them. Done items move to the README.

## Web Push notifications

A nudge when new senders land in the Gatekeeper, or when approved mail arrives in Yobox. The PWA shell (service worker, manifest) already exists, so this needs a push handler in the worker and a VAPID-configured endpoint on the server.

## Bucket suggestions at approval time

When a new sender is held, suggest Yobox, Receipts, or Feed based on their held mail: subject-line patterns, list headers, how similar senders were sorted. Approval stays a manual click; the suggestion just pre-fills the choice.

## Light mode

The theme is dark-only right now (a synthwave palette defined in `client/src/styles/theme.css`). A light variant would live next to it behind a media query or a toggle.

## Gatekeeper label repair

`moveSenderToBucket` trusts the database and returns "already there" without checking whether the thread's Gmail labels actually match. If Gmail search lagged during approval (which happens), the thread keeps a stale pending label and shows up in neither Yobox nor the Gatekeeper list. The move endpoint should sweep stale pending-labeled threads for the sender before it no-ops. Longer term: some way to keep a dev instance and a production instance from both gating the same Gmail account, since they run separate decision databases.
