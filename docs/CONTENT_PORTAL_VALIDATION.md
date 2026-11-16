# Admin content portal — implementation and validation

Date: 16 November 2026. Base: `3d02357`. This is a local implementation report, not a deployment or production acceptance report.

## User-visible result

A school administrator can open **Contenus** in the bottom navigation (`/s/<school>/admin/contenus`) to add permit categories, create/edit courses and quizzes, filter by category, preview drafts, and publish/unpublish. Course files use the private R2 architecture; PDFs, PNG/JPEG/WebP images and MP4 videos are limited to 25 MiB per upload. A separate HTTPS-link option clearly indicates that external content is not private storage.

Quizzes support questions, 2–6 answers, a correct answer, explanation, optional HTTPS image, duration, duplication and publication. Existing question IDs are preserved on edit. After submissions exist, question edits return a clear conflict requiring duplication, preserving historical answers/results. Metadata/publication edits remain available.

No marketing pages, production data changes, external messages, merge or deployment are included.

## Validation commands

Run from the repository root with the configured Node 24 environment and disposable PostgreSQL on loopback port 55436:

```sh
npm run build --prefix backend
XDG_CONFIG_HOME=/workspace/.config npm run build:worker --prefix backend
DATABASE_URL=postgresql://postgres@127.0.0.1:55436/legacy_test npm test --prefix backend
npm run lint --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e --prefix frontend
```

The legacy tests use the separate `legacy_test` database; tenant tests select their own disposable local database. Test runners deliberately refuse remote tenant-test hosts. Do not use production data for any command above.

- Backend compilation/type checking and Worker **dry-run** bundling: passed.
- Backend suite: 71 tests passed across 12 files (40 legacy + 31 tenant/API/import/content tests).
- Fresh disposable tenant database: 31 tests passed; the suite reapplies the schema between files. The full 71-test run also passed against the existing local databases.
- Frontend strict TypeScript: passed.
- Frontend unit tests: 19 passed across two files.
- Angular production bundle: passed; existing third-party CommonJS warnings remain.
- Chromium browser scenarios: 11 passed, including private upload UI lifecycle, quiz create/edit/preview/duplication, upload failure/form preservation, and the student authoring guard.
- `git diff --check`: passed.

The new backend tests use real Better Auth sessions and restricted PostgreSQL runtime roles. They cover anonymous/student denial, cross-school resource/quiz/category IDs, draft visibility, publish/unpublish, invalid answers, atomic rollback, attempts protection, expired unpaid student access, server-side size/type/signature checks, upload-key traversal rejection and signed upload restrictions. R2 SDK calls are mocked; presigning uses synthetic credentials and does not contact a bucket. Browser scenarios intercept APIs and storage PUTs. These are distinct kinds of evidence, not a deployed end-to-end test.

## Required integration steps and remaining limitations

1. Apply the updated tenant migration to a disposable staging branch before question editing; retain backup/rollback and verify actual upgrade compatibility.
2. Supply private server-side R2 bindings and configure exact-origin CORS for PUT/GET/HEAD, `Content-Type` and `If-None-Match`. Confirm real object upload, immutable/create-only PUT behavior, metadata verification, draft preview and short-lived authorised downloads against deployed Worker/Neon.
3. Exercise physical Android/iPhone behavior and slow/interrupted uploads. Live provider/deployment behavior was not verified here.
4. Files are validated by metadata and initial magic bytes; there is no antivirus/deep media parser. Upload progress/resumption, per-school quotas and unused-object cleanup are documented follow-ups. Do not delete replaced files without reference checks.
5. Optional question illustrations currently use HTTPS links, not a new private question-image storage flow. Materials themselves support private image upload.
6. Already downloaded material cannot be remotely erased when unpublished; existing offline lease limitations still apply.

GitHub's API returned `Forbidden` during the read-only repository capability check, so a pull request could not be created in this session. The implementation remains reviewable in the local checkout. See [collaborator tasks](handoffs/CONTENT_PORTAL_AND_REMAINING_TASKS.md) for assigned priorities and acceptance criteria.


## Reproducibility follow-up

The local server's missing-key crash was reproduced and fixed. `developmentBindings` reports required setting names, validates PostgreSQL URL schemes and Ed25519 private keys, normalizes escaped PEM newlines, and detects partial R2 configuration. Explicit process variables override `.dev.vars` defaults. Five new targeted tests and backend compilation pass. The original 71-test suite and frontend/browser results above are the portal delivery results; they were not all rerun for this startup-only change.
