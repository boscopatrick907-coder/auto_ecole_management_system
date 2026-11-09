#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?}" "${RESTORE_CONFIRM:?Set to RESTORE_DISPOSABLE_DATABASE}"
[ "$RESTORE_CONFIRM" = RESTORE_DISPOSABLE_DATABASE ] || exit 1
[ -n "${BACKUP_DATABASE_URL:-}" ] && [ "$RESTORE_DATABASE_URL" = "$BACKUP_DATABASE_URL" ] && { echo 'Refusing source database restore.' >&2; exit 1; }
archive=${1:?Provide downloaded database.dump}
# Fresh target only. No --clean option: accidental existing schemas cause failure.
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DO \$\$BEGIN CREATE ROLE aem_tenant_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END\$\$; DO \$\$BEGIN CREATE ROLE aem_identity_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END\$\$;"
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl --exit-on-error --single-transaction "$archive"
echo 'Archive restored. Reapply reviewed role grants, rotate restored credentials and run isolation/API checks before any cutover.'
