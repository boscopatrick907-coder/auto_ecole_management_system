# Frontend milestones — 9 November 2026

Every checkpoint below was production-built, type-checked and unit-tested before its commit. Intermediate route placeholders are replaced in subsequent checkpoints; publish/deploy the final tree only.

## 1. add restricted school schema, Better Auth and guarded Angular shell

Validation: production build, strict TypeScript check and 8 frontend unit tests passed.

## 2. port Stitch tokens and accessible shared controls

Validation: production build, strict TypeScript check and 8 frontend unit tests passed.

## 3. add account dashboard, expiry and payment history

Validation: production build, strict TypeScript check and 8 frontend unit tests passed.

## 4. add payment capture, dashboard and printable receipts

Validation: production build, strict TypeScript check and 8 frontend unit tests passed.

## 5. add student dossiers, invitations and group management

Validation: production build, strict TypeScript check and 8 frontend unit tests passed.

## 6. add courses and server-graded timed quizzes

Validation: production build, strict TypeScript check and 8 frontend unit tests passed.

## 7. wire durable synchronization and installable PWA shell

Validation: production build, strict TypeScript check and 8 frontend unit tests passed.

## 8. add paginated finance reports and release operations

Validation: production build, strict TypeScript check and 8 frontend unit tests passed.

## Final regression correction

Offline receipt device identity and sequence now survive logout together. Database eviction rotates both. Added concurrent allocation and provisional-payment/PDF browser regressions. Final validation: production build, strict TypeScript check, 9 frontend unit tests, 7 Chromium scenarios, 21 tenant/API/import tests, and the original 40 backend tests passed. Worker dry-run bundle and production-only dependency scans passed.
