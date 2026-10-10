#!/usr/bin/env bash
#
# Nightly backup of the SQLite database.
#
# Takes a consistent snapshot of the live DB using better-sqlite3's .backup()
# API, NOT a raw `cp` (unsafe on a live WAL-mode database). It verifies
# the copy with `PRAGMA integrity_check`, then uploads it offsite.
#
# Runs on the host (mini PC) via cron, but executes the snapshot *inside* the
# running container, which already has better-sqlite3 installed. The snapshot
# is written into the mounted data volume so the host can pick it up.
#
# Offsite target: AWS S3 (preferred) or any rclone remote (e.g. Backblaze
# B2) if avoiding AWS. The bucket/remote should have
# versioning enabled. That gives point-in-time history with no extra
# retention logic here.
#
# Configuration: source an optional `deploy/backup.env` (gitignored) so the
# cron entry itself can stay generic. Available settings:
#
#   YO_DIR              repo root (default: parent of this script's dir)
#   YO_SERVICE          docker compose service name (default: yo)
#   YO_DB_FILENAME      DB filename inside server/data (default: yo.db)
#   BACKUP_DIR          local staging dir (default: /tmp/yo-backups)
#   BACKUP_S3_BUCKET    S3 bucket name, e.g. yo-db-backups. Required unless
#                       BACKUP_RCLONE_REMOTE is set
#   BACKUP_S3_REGION    optional, e.g. eu-west-1 (else uses aws CLI default)
#   BACKUP_RCLONE_REMOTE rclone remote:path, e.g. b2:yo-db-backups
#                       (used only if BACKUP_S3_BUCKET is unset)
#
# Cron example (nightly 03:17, logs to a file):
#   17 3 * * * /home/<you>/yo/deploy/backup-db.sh >> /home/<you>/yo/backup.log 2>&1
#
# Restore: see deploy/self-host.md §"Restore from backup".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YO_DIR="${YO_DIR:-$(dirname "$SCRIPT_DIR")}"

# Optional config (gitignored) to keep the cron entry generic.
# shellcheck disable=SC1091
if [ -f "$YO_DIR/deploy/backup.env" ]; then . "$YO_DIR/deploy/backup.env"; fi

YO_SERVICE="${YO_SERVICE:-yo}"
YO_DB_FILENAME="${YO_DB_FILENAME:-yo.db}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/yo-backups}"
STAMP="$(date +%Y-%m-%d-%H%M%S)"

cd "$YO_DIR"

fail() { echo "[backup-db] ERROR: $*" >&2; exit 1; }

# --- Preflight -------------------------------------------------------------

command -v docker >/dev/null 2>&1 || fail "docker not found on PATH"
docker compose ps --status running --services 2>/dev/null | grep -qx "$YO_SERVICE" ||
  fail "container '$YO_SERVICE' is not running (cd $YO_DIR && docker compose up -d)"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  command -v aws >/dev/null 2>&1 || fail "BACKUP_S3_BUCKET is set but 'aws' CLI not found on PATH"
  UPLOAD_TARGET="s3"
elif [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  command -v rclone >/dev/null 2>&1 || fail "BACKUP_RCLONE_REMOTE is set but 'rclone' not found on PATH"
  UPLOAD_TARGET="rclone"
else
  fail "no offsite target configured. Set BACKUP_S3_BUCKET (or BACKUP_RCLONE_REMOTE) in deploy/backup.env"
fi

mkdir -p "$BACKUP_DIR"

# Avoid overlapping runs (e.g. a long upload still going at the next tick).
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || fail "another backup run is already in progress"

# --- Snapshot (inside the container, into the mounted data volume) ---------

# The snapshot is written to the server/data volume (mounted at
# /app/server/data in the container), so the host can access it directly.
SNAPSHOT_HOST_PATH="$YO_DIR/server/data/$YO_DB_FILENAME.backup-$STAMP"
echo "[backup-db] $(date '+%F %T') snapshotting $YO_DB_FILENAME (inside container)"

docker compose exec -T "$YO_SERVICE" node -e '
  const Database = require("better-sqlite3");
  const fs = require("fs");
  const [src, dest] = process.argv.slice(1);
  if (!fs.existsSync(src)) { console.error(`missing source DB: ${src}`); process.exit(1); }
  fs.closeSync(fs.openSync(dest, "w"));
  const db = new Database(src, { readonly: true });
  try {
    db.backup(dest)  // consistent point-in-time copy of the live WAL-mode DB
      .then(() => {
        const check = db.pragma("integrity_check", { simple: true });
        if (check !== "ok") { console.error(`integrity_check failed: ${check}`); process.exit(1); }
        console.log(`snapshot ok: ${fs.statSync(dest).size} bytes, integrity ok`);
      })
      .then(() => db.close())
      .catch((err) => { console.error(err); process.exit(1); });
  } catch (err) { console.error(err); process.exit(1); }
' "/app/server/data/$YO_DB_FILENAME" "/app/server/data/$YO_DB_FILENAME.backup-$STAMP"

mv "$SNAPSHOT_HOST_PATH" "$BACKUP_DIR/$YO_DB_FILENAME.backup-$STAMP"
SNAPSHOT_HOST_PATH="$BACKUP_DIR/$YO_DB_FILENAME.backup-$STAMP"

# --- Upload offsite --------------------------------------------------------

REMOTE_PATH="yo.db.backup-$STAMP"
echo "[backup-db] uploading to offsite target"

case "$UPLOAD_TARGET" in
  s3)
    REGION_ARGS=()
    [ -n "${BACKUP_S3_REGION:-}" ] && REGION_ARGS=(--region "$BACKUP_S3_REGION")
    aws s3 cp "$SNAPSHOT_HOST_PATH" "s3://${BACKUP_S3_BUCKET}/${REMOTE_PATH}" "${REGION_ARGS[@]+"${REGION_ARGS[@]}"}"
    ;;
  rclone)
    rclone copyto "$SNAPSHOT_HOST_PATH" "${BACKUP_RCLONE_REMOTE}/${REMOTE_PATH}"
    ;;
esac

rm -f "$SNAPSHOT_HOST_PATH"
echo "[backup-db] done: ${BACKUP_S3_BUCKET:-$BACKUP_RCLONE_REMOTE}/$REMOTE_PATH"
