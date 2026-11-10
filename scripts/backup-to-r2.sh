#!/usr/bin/env bash
set -euo pipefail

# Normalize Neon pooler to direct endpoint for pg_dump snapshot compatibility
BACKUP_DATABASE_URL="${BACKUP_DATABASE_URL//-pooler./.}"

# Validate mandatory secrets with clear operational error messaging
for var in BACKUP_DATABASE_URL R2_ACCOUNT_ID R2_BACKUP_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  if [ -z "${!var:-}" ]; then
    printf 'Error: %s is not set. Configure it in GitHub repository secrets.\n' "$var" >&2
    exit 1
  fi
done

backup_dir=$(mktemp -d)
trap 'rm -rf "$backup_dir"' EXIT

backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$backup_dir/database.dump"
endpoint_url="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

printf 'Starting pg_dump for %s at %s...\n' "$R2_BACKUP_BUCKET" "$backup_stamp"

# Perform compressed custom-format pg_dump using restricted non-owner backup role
pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --no-owner --no-acl --file="$backup_file"

# Verify table of contents and compute SHA-256 checksum
pg_restore --list "$backup_file" > "$backup_dir/contents.txt"
sha256=$(sha256sum "$backup_file" | cut -d ' ' -f1)
printf '%s  database.dump\n' "$sha256" > "$backup_dir/database.sha256"

printf 'Uploading backup and checksum to Cloudflare R2 (SHA256: %s)...\n' "$sha256"

# Upload database dump and sha256 checksum to private R2 bucket
aws --endpoint-url "$endpoint_url" s3 cp "$backup_file" "s3://${R2_BACKUP_BUCKET}/postgres/${backup_stamp}/database.dump" --only-show-errors
aws --endpoint-url "$endpoint_url" s3 cp "$backup_dir/database.sha256" "s3://${R2_BACKUP_BUCKET}/postgres/${backup_stamp}/database.sha256" --only-show-errors

# Prune backups older than 30 days to enforce storage lifecycle policy
cutoff_stamp=$(date -u -d '30 days ago' +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -v-30d +%Y%m%dT%H%M%SZ 2>/dev/null || true)
if [ -n "$cutoff_stamp" ]; then
  printf 'Checking for backups older than 30 days (before %s)...\n' "$cutoff_stamp"
  aws --endpoint-url "$endpoint_url" s3 ls "s3://${R2_BACKUP_BUCKET}/postgres/" | while read -r line; do
    folder=$(echo "$line" | awk '{print $NF}' | tr -d '/')
    if [[ "$folder" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [[ "$folder" < "$cutoff_stamp" ]]; then
      printf 'Pruning expired backup: %s\n' "$folder"
      aws --endpoint-url "$endpoint_url" s3 rm "s3://${R2_BACKUP_BUCKET}/postgres/${folder}/" --recursive --only-show-errors
    fi
  done
fi

printf 'Backup successfully uploaded, verified, and lifecycle enforced: %s\n' "$backup_stamp"

# Trigger verification run
