#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_DATABASE_URL:?}" "${R2_ACCOUNT_ID:?}" "${R2_BACKUP_BUCKET:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
backup_dir=$(mktemp -d)
trap 'rm -rf "$backup_dir"' EXIT
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$backup_dir/database.dump"
pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --no-owner --no-acl --file="$backup_file"
pg_restore --list "$backup_file" > "$backup_dir/contents.txt"
sha256sum "$backup_file" | cut -d ' ' -f1 > "$backup_dir/database.sha256"
aws --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" s3 cp "$backup_file" "s3://${R2_BACKUP_BUCKET}/postgres/${backup_stamp}/database.dump" --only-show-errors
aws --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" s3 cp "$backup_dir/database.sha256" "s3://${R2_BACKUP_BUCKET}/postgres/${backup_stamp}/database.sha256" --only-show-errors
printf 'Backup uploaded and archive catalog verified: %s\n' "$backup_stamp"
