# Auto-école La Marseillaise — Frozen Backend API Contract (v1.2.0)

**Status:** Frozen for Stitch *Clarté Routière* Angular 19 PWA Integration (`E10`)  
**Timezone Boundary:** `Africa/Douala` (`UTC+01:00`)  
**Currency & Money Representation:** Integer FCFA (`bigint` in PostgreSQL, safe integer `1 .. 1,000,000,000` in JSON). Never use floating-point numbers or sub-units (centimes).  
**Offline Lease Cryptography:** Asymmetric `EdDSA` (`Ed25519`, RFC 8032 / RFC 8037). The private key never leaves the backend; the PWA verifies `offlineLeaseToken` offline using only the public JWK returned by `GET /api/auth/lease-public-key` or embedded in `leasePublicKey`.

---

## 1. Canonical Identifier Naming Rules

To prevent drift between frontend forms and backend validators, the following canonical field names are mandatory across all JSON request payloads:

| Domain Concept | Canonical JSON Request Field | Database / Response Column | Prohibited Aliases |
| :--- | :--- | :--- | :--- |
| Permit Category UUID | `licenceCategoryId` | `licence_category_id` | ~~`categoryCode`~~, ~~`categoryId`~~, ~~`permitId`~~ |
| Cohort / Group UUID | `groupId` | `group_id` | ~~`cohortId`~~, ~~`sessionGroupId`~~ |
| Walk-in Invite Code | `inviteCode` | `inviteCode` | ~~`code`~~ (except URL query `?code=`) |
| Enrollment UUID | `enrollmentId` | `enrollment_id` | ~~`registrationId`~~ |
| Offline Idempotency UUID | `clientId` | `client_id` | ~~`idempotencyKey`~~, ~~`localId`~~ |
| Official Receipt Number | `receiptNumber` | `receipt_number` | ~~`receiptId`~~, ~~`numeroRecu`~~ |

---

## 2. Authentication, Sessions, Rate Limiting & CORS

### 2.1 Bearer Session Authentication
- Protected endpoints require `Authorization: Bearer <token>`.
- Raw 64-hex tokens are hashed with `SHA-256` before lookup in `public.sessions` (`expires_at = now() + interval '30 days'`).
- Every authenticated database operation executes inside `withUserContext(userId)`, which runs `SET LOCAL ROLE aem_app_runtime` (`NOBYPASSRLS`, `NOSUPERUSER`) and sets `app.current_user_id` for the transaction only.

### 2.2 Rate Limiting & Malformed JSON Protection (`E06`)
- All `POST /api/auth/*` endpoints validate that the request body is a valid JSON object (`{}`) **before** accessing any property or executing SQL queries.
- Malformed JSON syntax returns `400 INVALID_JSON`; arrays, primitives, or `null` bodies return `400 INVALID_PAYLOAD`.
- Brute-force protection enforces a sliding window of **20 requests / 10 minutes per IP+endpoint** (`429 TOO_MANY_REQUESTS` with `Retry-After` header).

---

## 3. Public & Authentication Endpoints (`/api/auth`)

### `GET /api/auth/lease-public-key` (`E11`)
Returns the asymmetric `Ed25519` public key JWK for offline lease verification.
- **Response `200 OK`:**
```json
{
  "kid": "aem-ed25519-...",
  "alg": "EdDSA",
  "issuer": "auto-ecole-la-marseillaise-api",
  "audience": "auto-ecole-la-marseillaise-pwa",
  "publicKeyJwk": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "...",
    "kid": "aem-ed25519-...",
    "alg": "EdDSA",
    "use": "sig"
  }
}
```

### `GET /api/auth/catalogue`
Returns active permit categories (`is_active = true`), open groups (`status = 'open'`) with confirmed seat counts (`confirmed_seats`), installment templates, and school settings.

### `POST /api/auth/request-otp`
- **Request:** `{ "phone": "+2376XXXXXXXX" }`
- **Response `200 OK`:** `{ "ok": true, "phone": "+2376XXXXXXXX", "isWalkInUnclaimed": false, "walkInName": null }`
- **Errors:** `400 INVALID_PHONE`, `400 INVALID_JSON`, `400 INVALID_PAYLOAD`, `429 TOO_MANY_REQUESTS`

### `POST /api/auth/register` (`E03`, `E04`)
Executes inside a single atomic database transaction (`users` + `verifications` + `register_student` + `enrollments`). Both `licenceCategoryId` (must be `is_active = true`) and `groupId` (must be `status = 'open'` and belong to `licenceCategoryId`) are mandatory. Any validation or constraint failure rolls back the entire transaction so no orphaned `users` row is left behind and the OTP remains unconsumed.
- **Request:**
```json
{
  "fullName": "Jean-Pierre Mbarga",
  "phone": "+237677112233",
  "email": "jp@exemple.cm",
  "password": "Password123!",
  "otpCode": "123456",
  "licenceCategoryId": "uuid",
  "groupId": "uuid"
}
```
- **Response `201 Created`:** `{ "token", "user", "studentId", "student", "offlineLeaseToken", "leasePublicKey", "accessState" }`
- **Errors:** `400 VALIDATION_ERROR`, `400 INVALID_OTP`, `400 INACTIVE_LICENCE_CATEGORY`, `400 GROUP_REQUIRED`, `400 INVALID_GROUP`, `409 PHONE_EXISTS`, `409 PHONE_EXISTS_USE_INVITE`

### `POST /api/auth/claim-invite`
Activates a walk-in student account created by the school and starts the 14-day free trial at activation time (`activated_at = now()`, `trial_ends_at = now() + interval '14 days'`).
- **Request:** `{ "inviteCode": "AEM-XXXX-XXXX", "phone": "+2376XXXXXXXX", "password": "...", "email": "..." }`
- **Errors:** `400 INVALID_OR_EXPIRED_CODE`, `400 PHONE_MISMATCH`, `409 ALREADY_CLAIMED`

### `POST /api/auth/login`
- **Request:** `{ "identifier": "+2376XXXXXXXX | email", "password": "..." }`
- **Response `200 OK`:** `{ "token", "user", "student", "offlineLeaseToken", "leasePublicKey", "accessState" }`
- **Errors:** `401 INVALID_CREDENTIALS`, `429 TOO_MANY_REQUESTS`

### `GET /api/auth/session` & `POST /api/auth/logout`
Refreshes the student's `offlineLeaseToken` (`EdDSA`) or revokes the current Bearer session.

---

## 4. Student Endpoints (`/api/student`)

### `GET /api/student/me`
Accessible even when the 14-day free trial has expired (Rule 11: expired students retain read access to their profile, balance, installment schedule, receipts, and school contact details).
- **Response `200 OK`:** `{ "settings", "student", "enrollment", "installments", "nextInstallment", "payments", "quizAttempts" }`

### `GET /api/student/resources` & `GET /api/student/resources/file/:key`
Strictly gated by `public.student_has_access(student_id)` (active 14-day trial OR at least 1 valid non-cancelled payment) AND `licence_category_id = student.licence_category_id`.
- **Errors:** `403 ACCESS_EXPIRED`, `403 FORBIDDEN_RESOURCE`

### `GET /api/student/quizzes`
Strictly gated by `public.student_has_access(student_id)` AND `licence_category_id = student.licence_category_id`.
- **Errors:** `403 ACCESS_EXPIRED`

### `POST /api/student/quiz-attempts` (`E05`)
Accepts a single attempt or `{ "attempts": [...] }` batch (up to 100 items) for offline sync. Allowed even if the student's trial expired while offline.
- **Idempotency & Ownership Contract:**
  - Re-submitting the exact same `clientId` for the **same student and same `quizId`** is idempotent (`201 Created`).
  - Reusing a `clientId` that belongs to **another student** or **another `quizId`** (including inside the same batch) rolls back the entire transaction and returns `409 IDEMPOTENCY_CONFLICT`.

---

## 5. Administration & Cashier Endpoints (`/api/admin`)

All `/api/admin/*` routes require an authenticated `admin` profile (`403 FORBIDDEN_ADMIN_ONLY` otherwise) and validate UUID path parameters (`400 INVALID_UUID`).

### `GET /api/admin/dashboard`
Returns executive KPIs (`students_total`, `without_app_account`, `in_free_trial`, `trial_ended_unpaid`, `collected_this_month`, `collected_total`, `still_owed`, `students_overdue`), action lists (`overdueInstallments`, `expiringTrials`, `unclaimedStudents`), and recent payments.

### `GET /api/admin/students`, `GET /api/admin/students/:id`, `POST /api/admin/students`, `POST /api/admin/students/:id/invite`
- `POST /api/admin/students` creates a walk-in student, enrolls them in `groupId` (rejecting closed groups with `400 INVALID_GROUP` and inactive permit categories with `400 INACTIVE_LICENCE_CATEGORY`), generates a 7-day invite code, and persists a durable `student_invite` notification in `public.notification_outbox`.

### `GET /api/admin/groups`, `POST /api/admin/groups`, `PATCH /api/admin/groups/:id` (`E03`, `E07`)
- `POST /api/admin/groups` enforces:
  1. Active `licenceCategoryId` (`400 INACTIVE_LICENCE_CATEGORY` if inactive).
  2. Real ISO calendar dates (`YYYY-MM-DD`, rejecting impossible dates like `2026-02-30` or `2026-04-31` with `400 VALIDATION_ERROR`).
  3. Safe integer FCFA bounds (`1 .. 1,000,000,000`).
  4. Contiguous 1-based installment positions (`1 .. N`) in non-decreasing chronological order (`dueDate[i] <= dueDate[i+1]`).
  5. Exact sum of installment amounts equal to `totalFee` (`400 INSTALLMENTS_SUM_MISMATCH` otherwise).

### `POST /api/admin/payments` & `POST /api/admin/payments/:id/cancel` (`E02`, `E05`, `E12`)
- `POST /api/admin/payments` calls `public.record_payment`, which acquires a `FOR UPDATE` row lock on `public.groups` and `public.enrollments`:
  - **Idempotency:** Same `clientId` for the same `enrollmentId` and `amount` returns the existing payment (`201`). Reusing `clientId` for a different `enrollmentId` or `amount` returns `409 IDEMPOTENCY_CONFLICT`.
  - **Serialized Seat Capacity:** If the student does not yet have a confirmed seat (`not public.student_has_paid(student_id)`) and `confirmed_seats >= capacity`, returns `409 GROUP_FULL`. Subsequent installments for an already-seated student are always allowed up to the remaining balance.
  - **Overpayment Guard:** If `amount > balance`, returns `400 EXCEEDS_BALANCE`.
  - **Durable Outbox (`E12`):** Commits the payment and records a deduplicated `payment_confirmed:<paymentId>` row in `public.notification_outbox`.
- `POST /api/admin/payments/:id/cancel` requires a non-empty `reason` (`400 REASON_REQUIRED`), marks `cancelled_at` / `cancel_reason`, writes an immutable `audit_log` entry, and dynamically recalculates balances and student access.

### `GET /api/admin/notifications/outbox` & `POST /api/admin/notifications/run-reminders` (`E12`)
- `POST /api/admin/notifications/run-reminders` evaluates reminders in `Africa/Douala` timezone (Trial Days 7, 12, 14; upcoming/overdue installments; weekly direction summary) and enqueues them into `public.notification_outbox` with deterministic `dedup_key`s (`ON CONFLICT (dedup_key) DO NOTHING`).
- Automated test runs (`VITEST` / `NODE_ENV=test` / `dryRunExternal: true`) never trigger live external messages to generated phone numbers.
- SMS fallback is explicitly flagged as `"smsFallbackStatus": "unavailable_pending_provider"` until an SMS gateway is contracted by the school.

### `GET /api/admin/settings`, `PATCH /api/admin/settings`, `PATCH /api/admin/licence-categories/:id`
Allows the school direction to update school metadata, toggle permit category activation (`is_active`), and manage group statuses (`open`, `closed`, `completed`).

---

## 6. Standardized Error Code Catalogue

| HTTP Status | Error Code | Trigger Condition |
| :--- | :--- | :--- |
| `400` | `INVALID_JSON` | Malformed JSON request body |
| `400` | `INVALID_PAYLOAD` | JSON body is not a plain object (`[]`, `null`, primitive) |
| `400` | `INVALID_UUID` | Malformed UUID in path parameter (`:id`) |
| `400` | `VALIDATION_ERROR` | Schema, safe-integer money, calendar date, or contiguous position failure |
| `400` | `INACTIVE_LICENCE_CATEGORY` | Permit category is inactive (`is_active = false`) or nonexistent |
| `400` | `GROUP_REQUIRED` | Registration attempted without `groupId` |
| `400` | `INVALID_GROUP` | Group is closed/completed or belongs to a different permit category |
| `400` | `INSTALLMENTS_SUM_MISMATCH` | Sum of installment amounts does not equal `totalFee` |
| `400` | `EXCEEDS_BALANCE` | Payment amount exceeds the enrollment's remaining balance |
| `401` | `UNAUTHORIZED` / `SESSION_EXPIRED` | Missing, invalid, or expired Bearer token |
| `403` | `FORBIDDEN_ADMIN_ONLY` | Non-admin user attempting to access `/api/admin/*` |
| `403` | `ACCESS_EXPIRED` | Unpaid student whose 14-day trial has ended requesting courses/quizzes |
| `404` | `NOT_FOUND` / `ENROLLMENT_NOT_FOUND` | Valid UUID that does not match an existing record |
| `409` | `GROUP_FULL` | Unseated student attempting first payment into a group at full confirmed capacity |
| `409` | `IDEMPOTENCY_CONFLICT` | `clientId` reused across different students, enrollments, quizzes, or amounts |
| `409` | `PHONE_EXISTS` | Phone number already registered |
| `429` | `TOO_MANY_REQUESTS` | Auth/OTP rate limit exceeded |
