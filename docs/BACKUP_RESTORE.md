# Database backups and restoration

Neon instant restore is not an independent backup. `.github/workflows/database-backup.yml` schedules a custom-format pg_dump daily at 01:30 UTC / 02:30 Africa/Douala and uploads it plus a SHA-256 checksum to a private R2 bucket. Configure the production-backups GitHub environment's secrets listed in the workflow. Use a dedicated read-only backup login that can read all tenant/identity rows; ordinary application RLS credentials are unsuitable for a complete backup. That credential is used only by backup jobs. Never give it to the Worker or browser.

Provision a separate private backup bucket and bucket-scoped write credentials. Set retention/lifecycle (recommended 30 daily backups plus separate monthly retention), restrict reads to restore operators and enable audit/alerting for failed jobs. Authentication/session data is sensitive. Match pg_dump major version to production (or newer); the generic runner install must be checked against the actual Neon version. The scheduled job is not proven until its first successful run and restore exercise.

## Restore drill
1. Create an empty disposable Neon branch/database with sufficient storage. Keep the source untouched and external messaging disabled.
2. Download both objects for a selected timestamp using operator R2 credentials. Compare `sha256sum database.dump` with database.sha256.
3. Set `RESTORE_DATABASE_URL` to the empty target and `RESTORE_CONFIRM=RESTORE_DISPOSABLE_DATABASE`, then run `bash scripts/restore-backup.sh database.dump`.
4. The archive excludes owner/ACL settings. Reapply `backend/migrations/001_multitenant.sql` as the target migration owner to recreate reviewed functions and grants. Recreate the two restricted LOGIN roles, then grant only their respective runtime roles. Never connect Worker user requests as the restored table owner.
5. Reconcile school/student/payment/audit row counts, per-school balances and receipt counters. Test Better Auth, both tenant boundaries, cancellation, quiz sync and R2 file authorization. Rotate all restored credentials and invalidate old sessions before a public cutover.
6. Record backup timestamp, checksum, database version, elapsed restore time, row reconciliation and test results. Delete the disposable branch after the drill.

Target RPO: up to 24 hours for daily backups; establish and measure RTO during the drill. R2 course files need their own retention/versioning/export policy; pg_dump contains file keys, not object bytes. No live backup or cloud restore was performed by writing this configuration.
