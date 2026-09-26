# Self-hosting on a home machine

A single Docker container running on an always-on machine at home (a mini PC,
an old laptop, a NAS that can run Docker). Access from outside the house goes
through Tailscale. Run each step below **on the home machine** unless marked
otherwise.

You'll be on the same home LAN as the machine for setup, so the SSH/`scp`/
`git clone` steps just use its plain LAN IP. Substitute your actual
`<media-pc-ip>` and `<you>` (your username on that machine) everywhere below.

## 0. Clone the repo

```bash
ssh <you>@<media-pc-ip>
git clone https://github.com/Mhoram/yo.git ~/yo
```

## 1. Bring your existing Screener/sender history over

If you've been running the app locally and already made gatekeeper decisions,
copy the database over so the home machine doesn't start empty. **On the dev
machine:**

```bash
cd yo/server
npx tsx -e "import('./src/db/database.js').then(({db}) => { db.pragma('wal_checkpoint(TRUNCATE)'); console.log('checkpointed'); })"
scp data/yo.db <you>@<media-pc-ip>:~/yo/server/data/yo.db
```

The checkpoint folds the WAL file into `yo.db` itself first, so the copy is a
clean, consistent snapshot.

## 2. Find the machine's Tailscale (MagicDNS) hostname

This is only needed from here on, for the OAuth redirect URI and the HTTPS
access set up in steps 3, 4 and 6, so the app is reachable from outside the
house too.

```bash
tailscale status
```

Your own device is the first row; note its name. The full hostname you'll use
everywhere below is `<that-name>.<your-tailnet-name>.ts.net`. If unsure of
the full form, check https://login.tailscale.com/admin/machines (click the
device; it shows the full MagicDNS name).

## 3. Register the new OAuth redirect URI

In [Google Cloud Console](https://console.cloud.google.com/), APIs & Services →
Credentials, open the same OAuth client already used for local dev, and under
**Authorized redirect URIs** add:

```
https://<device>.<tailnet>.ts.net/auth/callback
```

Leave the existing `http://localhost:3001/auth/callback` in place too, so local
dev keeps working unchanged.

## 4. Create `.env` on the home machine

At the repo root (`~/yo/.env`):

```bash
GOOGLE_CLIENT_ID=<same client ID as your dev .env>
GOOGLE_CLIENT_SECRET=<same client secret as your dev .env>
GOOGLE_REDIRECT_URI=https://<device>.<tailnet>.ts.net/auth/callback
SESSION_SECRET=<a new long random string, don't reuse the dev one>
PORT=3001
CLIENT_ORIGIN=https://<device>.<tailnet>.ts.net
```

Generate a `SESSION_SECRET` with `openssl rand -hex 32`.

## 5. Build and start the container

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

You should see `yo server listening on http://localhost:3001`. `Ctrl+C` stops
following the logs; the container keeps running. `restart: unless-stopped`
brings it back automatically after a reboot, as long as Docker's own systemd
service is enabled (it is by default on Debian).

The container binds only to `127.0.0.1:3001` on the host, so it isn't
reachable from the LAN or the internet. `tailscale serve` (next step) is the
only way in.

## 6. Point Tailscale Serve at it

Current Tailscale CLI syntax (this has changed across versions; if it changed
again by the time you read this, `tailscale serve --help` has the current
form):

```bash
sudo tailscale set --operator=<you>   # one-time: lets `tailscale` commands run without sudo
tailscale serve --bg http://127.0.0.1:3001
```

Verify with:

```bash
tailscale serve status
```

Tailscale provisions the HTTPS certificate for
`https://<device>.<tailnet>.ts.net` automatically via MagicDNS. No Caddy or
Let's Encrypt setup needed. The config is stored by `tailscaled` and
re-applied after a reboot.

## 7. Verify

From your phone or laptop (must be on the same tailnet), open
`https://<device>.<tailnet>.ts.net` and sign in with Google. You should land
on Yobox with your existing gatekeeper history already there (from step 1).

## Updating later

```bash
cd ~/yo
git pull
docker compose build
docker compose up -d
```

### One-time: the Gatekeeper/Receipts rebrand migration

The rename from the older vocabulary (Screener/Paper Trail) to
Gatekeeper/Receipts changed both the Gmail label names the app looks for and
the `bucket` values stored in the DB. Deploying the renamed build without the
migrations below leaves Receipts/Feed views and pending Gatekeeper entries
empty. The mail still exists in Gmail; it's just under labels the app no
longer reads. Nothing gets deleted from Gmail; the labels get renamed
properly.

Run on the home machine, in this order:

```bash
cd ~/yo

# 0. Safety snapshot of the live DB first (better-sqlite3 .backup(), safe on
#    a running WAL-mode DB). If anything below goes sideways, restore with:
#    docker compose down && cp server/data/yo.db.pre-rename-backup server/data/yo.db && docker compose up -d
docker compose exec yo node -e \
  "require('better-sqlite3')('server/data/yo.db').backup('/app/server/data/yo.db.pre-rename-backup').then(() => console.log('db backup ok'))"

# 1. Deploy the renamed build (DB bucket-value migration runs on startup)
git pull
docker compose build
docker compose up -d
docker compose logs -f   # confirm it boots clean, Ctrl+C

# 2. Move threads off the old Gmail labels onto the new ones.
#    Gmail labels are account-global, so this only needs to run ONCE from
#    wherever you have working OAuth tokens. The dev machine usually does
#    (see server/scripts/migrate-gmail-labels.mjs usage header). The container
#    route below is the fallback for when you'd rather run it here:
docker compose cp server/scripts/migrate-gmail-labels.mjs yo:/app/migrate.mjs
docker compose exec -w /app/server yo node /app/migrate.mjs
docker compose exec yo rm /app/migrate.mjs

# 3. Verify: sign in from your tailnet, check Yobox/Receipts/Feed and the
#    Gatekeeper all show their usual contents.
```

The script is safe to re-run; a second run does nothing. The DB snapshot
(`yo.db.pre-rename-backup`) can be deleted once you've verified everything.

## Troubleshooting

**Container won't start or crashes immediately**: check `docker compose logs`.
Most likely a missing or invalid `.env` value; the zod validation error is
printed clearly on startup.

**"Invalid id value" or stale screener entries**: unrelated to this deploy;
see the fix in `server/src/db/database.ts` (tests can no longer write into the
real DB).

**OAuth redirect mismatch error from Google**: the redirect URI registered in
step 3 must match `GOOGLE_REDIRECT_URI` in `.env` exactly, including
`https://` and with no trailing slash.

**File ownership**: the `server/data/` directory (and the SQLite file in it)
ends up owned by `root` on the host, since the container runs as root. That's
fine, it just means you'll need `sudo` to inspect or copy `yo.db` from the
host.

**"Failed to load: invalid_grant", mail stops loading**: the stored refresh
token is dead. The app's own `/auth/status` check only confirms a token row
exists, not that it still works, so the UI looks signed-in while every Gmail
call fails. Fix: visit `https://<device>.<tailnet>.ts.net/auth/google`
directly and sign in again — no container restart needed, the new token
overwrites the old one immediately.

The most common cause is the Google Cloud OAuth client still sitting in
**Testing** publishing status: refresh tokens issued in Testing mode expire
after 7 days no matter how often the app is used, so this recurs weekly until
fixed. In Google Cloud Console, go to **Google Auth Platform → Audience**
(the OAuth consent screen settings moved here) and click **Publish app** to
move it to **In production**. You don't need to complete Google's
verification flow for a single-user personal deployment. Once published,
tokens are only revoked if unused for 6 months or manually revoked at
https://myaccount.google.com/permissions.

## 8. Nightly offsite backup

The offsite copy is the primary safety net here. A home machine has no cloud
instance snapshots to fall back on, and gatekeeper decisions represent months
of real sorting work.

### 8a. S3 bucket setup

Use the same AWS account as your other projects (same billing, same `~/.aws`),
but with a **dedicated bucket**; never point the backup at a bucket shared
with other production data. S3 bucket names are globally unique, so pick
something like `yo-db-backups-<yourname>`.

Every command below can run from the Console or the CLI; the CLI versions are
shown because they're copy-pasteable. Run them from any machine with admin
credentials, in the region you prefer (`eu-west-1` in the examples):

```bash
# 1. Create the bucket
aws s3api create-bucket --bucket yo-db-backups \
    --region eu-west-1 --create-bucket-configuration LocationConstraint=eu-west-1

# 2. Lock it down. The Console blocks public access by default; the API does not.
aws s3api put-public-access-block --bucket yo-db-backups \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 3. Enable versioning. This is what gives point-in-time history for free:
#    every nightly upload is a new version, old ones are kept until a
#    lifecycle rule retires them (step 5).
aws s3api put-bucket-versioning --bucket yo-db-backups \
    --versioning-configuration Status=Enabled

# 4. Encryption. SSE-S3 is the default for new buckets; set it explicitly
#    so it's on record.
aws s3api put-bucket-encryption --bucket yo-db-backups \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# 5. Lifecycle rule. The DB is small so cost is trivial either way, but
#    without a rule noncurrent versions grow forever (one per day). 90 days
#    of noncurrent history is plenty for a personal mailbox DB.
aws s3api put-bucket-lifecycle-configuration --bucket yo-db-backups \
    --lifecycle-configuration '{"Rules":[{"ID":"expire-old-backups","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":90}}]}'

# 6. Verify
aws s3api get-bucket-versioning --bucket yo-db-backups     # -> Enabled
aws s3api get-public-access-block --bucket yo-db-backups
aws s3api get-bucket-lifecycle-configuration --bucket yo-db-backups
```

For Backblaze B2 via rclone instead: create a B2 bucket, `rclone config` a
remote for it, and enable keeping prior versions on the bucket.

### 8b. Scoped credentials

Don't run the cron job with your everyday admin credentials. It only needs to
put objects, and for restores, get and list them:

```bash
# Least-privilege policy. GetObject/ListBucket are only needed for restores;
# drop them if you'd rather restore from a machine with broader credentials.
cat > /tmp/yo-backup-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::yo-db-backups/*" },
    { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetObject"],
      "Resource": ["arn:aws:s3:::yo-db-backups", "arn:aws:s3:::yo-db-backups/*"] }
  ]
}
JSON

aws iam create-user --user-name yo-backup
aws iam put-user-policy --user-name yo-backup \
    --policy-name yo-backup-s3 --policy-document file:///tmp/yo-backup-policy.json

# Long-lived access key for the cron job. Fine for a personal script; an IAM
# role on the machine would be the keyless upgrade path.
aws iam create-access-key --user-name yo-backup
```

### 8c. Wire the credentials into the script

On the home machine, store the key from 8b under a named profile so it can't
collide with other credentials on the same box:

```bash
aws configure --profile yo-backup
# AWS Access Key ID:     <from create-access-key>
# AWS Secret Access Key: <from create-access-key>
# Default region name:   eu-west-1
```

Then in `deploy/backup.env` set:

```bash
export AWS_PROFILE=yo-backup
BACKUP_S3_BUCKET=yo-db-backups
BACKUP_S3_REGION=eu-west-1
```

The `export` matters. The script sources `backup.env`, and only exported
variables reach the `aws` subprocess. Verify the profile can reach the bucket
before wiring it into cron:

```bash
AWS_PROFILE=yo-backup aws s3 ls s3://yo-db-backups/
echo test | AWS_PROFILE=yo-backup aws s3 cp - s3://yo-db-backups/.write-test
AWS_PROFILE=yo-backup aws s3 rm s3://yo-db-backups/.write-test
```

### 8d. Test and schedule

```bash
# One manual run; you should see the snapshot size and the uploaded key
./backup-db.sh

# Then the cron job (nightly, logs to a file)
crontab -e
# add:
17 3 * * * /home/<you>/yo/deploy/backup-db.sh >> /home/<you>/yo/backup.log 2>&1
```

### 8e. Test the restore, at least once

```bash
# Pull a backup out of the bucket. List versions with
# `aws s3api list-object-versions --bucket yo-db-backups --prefix yo.db.backup-`
# to pick a certain point in time.
aws s3 cp s3://yo-db-backups/yo.db.backup-<stamp> ./yo.db.restored

# Stop the app, swap the DB in, start it again
cd ~/yo && docker compose down
sudo cp yo.db.restored ~/yo/server/data/yo.db
docker compose up -d
```

Then verify the app comes up with its history intact (`docker compose logs
-f`, then sign in and check Yobox and the Gatekeeper).
