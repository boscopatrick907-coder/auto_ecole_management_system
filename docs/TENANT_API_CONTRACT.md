# Multi-School Tenant API Contract (`2026-11-10.v1`)

**Entry Point:** `backend/src/tenant/worker.ts` (Hono on Cloudflare Workers)  
**Database Schemas:** `identity` (Better Auth global identity, `aem_identity_runtime`) + `school_app` (tenant-scoped domain & RLS, `aem_tenant_runtime`)  
**Timezone Boundary:** `Africa/Douala` (`UTC+01:00`)  
**Currency & Money Representation:** Integer FCFA (`1 .. 1,000,000,000` in request JSON; PostgreSQL `bigint`). No decimals or centimes.  
**Offline Lease Cryptography:** Asymmetric `EdDSA` (`Ed25519` / OKP JWK). Private key stays in `OFFLINE_PRIVATE_KEY_PEM` on the Worker; public key JWK is returned by `GET /api/schools/:slug/lease`.

---

## 1. Architecture, Authentication, Cookies & Roles

### 1.1 Global Identity vs. School-Scoped Membership
- Global login identities live in `identity."user"`, `identity.account`, `identity."session"`, `identity.verification`, and `identity."rateLimit"`.
- A single authenticated user can hold memberships in multiple schools via `school_app.school_members(school_id, user_id, role)`.
- Supported launch school roles: `"admin"` | `"student"`.
- Platform-level administration is gated separately via `school_app.platform_admins(user_id)` and audited in `school_app.platform_audit`.

### 1.2 Cookies, CSRF Origin Protection & Identity Binding
- Authentication uses **Better Auth HTTP-only cookies** (`credentials: "include"` on `fetch`).
- In `production`/`staging` (`ENVIRONMENT !== "development"`), `useSecureCookies: true` is enforced.
- Every state-changing request (`POST`, `PATCH`, `PUT`, `DELETE`) MUST send an `Origin` header matching `TRUSTED_ORIGINS`, otherwise the Worker immediately returns `403 { "error": "ORIGIN_FORBIDDEN" }`.
- Tenant requests from the Angular client may send `X-Expected-User: <userId>`. If the active session cookie belongs to a different user (e.g., another browser tab switched accounts) or is unauthenticated, the Worker immediately aborts with `403 { "error": "SESSION_IDENTITY_CHANGED" }` before running any tenant transaction.

---

## 2. Public & Authentication Endpoints

### 2.1 `GET /api/health`
- **Response `200 OK`:** `{ "ok": true }`

### 2.2 `GET /api/config`
Returns public runtime configuration and enabled onboarding/authentication capabilities so the frontend never displays unconfigured flows (such as fake phone OTP inputs).
- **Response `200 OK`:**
```json
{
  "turnstileSiteKey": "0x4AAAAAAA...",
  "contractVersion": "2026-11-10.v1",
  "authModes": {
    "emailPassword": true,
    "walkInInviteClaim": true,
    "selfEnroll": true,
    "phoneOtp": false,
    "passwordRecoveryEmail": true
  }
}
```
> **Pilot Onboarding Scope Decision (`E05`):** Tenant account creation uses **Email/Password + Cloudflare Turnstile** (`/api/auth/sign-up/email`), followed by either **Walk-in Invitation Claim** (`POST /api/schools/:slug/claim-invite`) or **Self-Enrollment** (`POST /api/schools/:slug/enroll`). Phone SMS/WhatsApp OTP signup is intentionally disabled (`phoneOtp: false`).

### 2.3 Better Auth Endpoints (`/api/auth/*`)
- **`POST /api/auth/sign-up/email`**
  - Requires header `X-Turnstile-Token: <token>`.
  - Rate-limited per IP via `SIGNUP_LIMITER` (`429 RATE_LIMITED`).
  - Verifies token against Cloudflare Turnstile `siteverify` AND records a 15-minute SHA-256 anti-replay digest in `identity.verification` so a Turnstile token can never be replayed (`403 TURNSTILE_REQUIRED` | `403 TURNSTILE_FAILED`).
  - Body: `{ "email": "string", "name": "string", "password": "string (min 12 chars)" }`
- **`POST /api/auth/sign-in/email`**
  - Body: `{ "email": "string", "password": "string" }`
  - Supports both Better Auth native password hashes and migrated `legacy-scrypt:<salt>:<hex>` hashes transparently.
- **`POST /api/auth/sign-out`**
  - Revokes the current session cookie.
- **`POST /api/auth/request-password-reset` & `POST /api/auth/reset-password`**
  - Delivers password reset link via `AUTH_EMAIL_WEBHOOK` (`Bearer <AUTH_EMAIL_TOKEN>`). If unconfigured or webhook fails, returns `503 { "error": "EMAIL_DELIVERY_UNAVAILABLE" }`.
  - Reset tokens expire after **3,600 seconds (1 hour)**, are **single-use** (consumed immediately on reset), and **revoke all existing sessions** for that user (`revokeSessionsOnPasswordReset: true`). Reset URLs are never logged.

---

## 3. School Catalogue, Onboarding, Session & Offline Lease (`/api/schools/:slug/*`)

### 3.1 `GET /api/schools/:slug/catalogue` (Public)
- **Response `200 OK`:**
```json
{
  "school": {
    "id": "uuid",
    "name": "Auto-école La Marseillaise",
    "slug": "la-marseillaise",
    "logo": null,
    "colors": { "primary": "#1f4e8c", "accent": "#f5a623" },
    "trial_days": 14,
    "receipt_prefix": "LM",
    "address": "...",
    "phone": "+237...",
    "whatsapp": "+237...",
    "agrement_number": "...",
    "status": "active"
  },
  "categories": [
    { "id": "uuid", "school_id": "uuid", "code": "B", "name": "Permis B", "is_active": true }
  ],
  "groups": [
    {
      "id": "uuid",
      "school_id": "uuid",
      "licence_category_id": "uuid",
      "licence_name": "Permis B",
      "name": "Cohorte Matin",
      "schedule_text": "Lun-Ven 08h-10h",
      "start_date": "2026-11-15",
      "capacity": 25,
      "total_fee": 120000,
      "status": "open",
      "confirmed_seats": 4,
      "installments": [
        { "id": "uuid", "group_id": "uuid", "position": 1, "label": "Tranche 1", "amount": 60000, "due_date": "2026-11-20" }
      ]
    }
  ]
}
```

### 3.2 `POST /api/schools/:slug/enroll` (Authenticated User)
Self-enrolls the authenticated user into an open group, grants `"student"` membership in the school, and starts their 14-day trial (`activated_at`, `trial_ends_at`).
- **Request:** `{ "groupId": "uuid", "fullName": "string (2..150)", "phone": "+237[26]XXXXXXXX" }`
- **Response `201 Created`:** `{ "ok": true }`
- **Errors:** `401 AUTH_REQUIRED`, `400 INVALID_GROUP`, `400 INVALID_LICENCE`, `409 STUDENT_ALREADY_REGISTERED`, `409 PHONE_ALREADY_REGISTERED`

### 3.3 `POST /api/schools/:slug/claim-invite` (Authenticated User)
Claims a hashed 24-hex walk-in invitation code (`SHA-256` verified, single-use, 7-day expiry), links the authenticated user to the existing student dossier, grants `"student"` membership, and starts the 14-day trial if not already started.
- **Request:** `{ "inviteCode": "string (24 hex chars)", "phone": "+237[26]XXXXXXXX" }`
- **Response `201 Created`:** `{ "ok": true }`
- **Errors:** `401 AUTH_REQUIRED`, `400 INVALID_INVITE`, `409 STUDENT_ALREADY_REGISTERED`

### 3.4 `GET /api/schools/:slug/session` (School Member: `admin` | `student`)
- **Response `200 OK`:** `{ "user": { "id": "string", "name": "string", "email": "string" }, "role": "admin" | "student", "school": School }`
- **Errors:** `401 AUTH_REQUIRED`, `403 MEMBERSHIP_REQUIRED`, `403 SESSION_IDENTITY_CHANGED`, `404 SCHOOL_NOT_FOUND`

### 3.5 `GET /api/schools/:slug/lease` (School Member: `admin` | `student`)
Issues a 72-hour Ed25519-signed JWT offline lease (`iss: "school-api"`, `aud: "school-pwa"`) containing `{ schoolId, role, hasAccess, hasPaid, trialEndsAt, maxOfflineUntilMs, serverTimeMs }` and the public verification key.
- **Response `200 OK`:** `{ "token": "eyJhbG...", "publicKey": { "kty": "OKP", "crv": "Ed25519", "x": "..." } }`

---

## 4. Learner Dossier, Courses (R2) & Quizzes

### 4.1 Learning Access Business Rule (`E03`)
A student has learning access (`has_access = true`, `can_learn(licence_category_id) = true`) if and only if:
1. Their 14-day trial is still active (`trial_ends_at > now()`), **OR**
2. They have **at least one non-cancelled payment** (`payments.cancelled_at IS NULL`) recorded on any of their enrollments in the school (`student_has_paid(student_id) = true`).
- Enrollment status (`cancelled`) or an `overdue` installment does **not** revoke learning access for a student who has a non-cancelled payment.
- Cancelling the student's last valid payment after trial expiry **immediately revokes** `has_paid`, `has_access`, and `can_learn`.

### 4.2 `GET /api/schools/:slug/me` (Student) & `GET /api/schools/:slug/admin/students/:id` (Admin)
Returns the full student dossier. Enrollment selection is **deterministic** across both the dossier and `GET /admin/students`:
`ORDER BY (e.status <> 'cancelled') DESC, e.created_at DESC, e.id DESC LIMIT 1`.
- **Response `200 OK`:**
```json
{
  "student": {
    "id": "uuid",
    "school_id": "uuid",
    "user_id": "string | null",
    "student_number": 1001,
    "full_name": "Jean-Pierre Mbarga",
    "phone": "+237699000011",
    "licence_category_id": "uuid",
    "activated_at": "2026-11-10T10:00:00.000Z",
    "trial_ends_at": "2026-11-24T10:00:00.000Z",
    "registered_at": "2026-11-10T10:00:00.000Z",
    "has_paid": true,
    "has_access": true
  },
  "enrollment": {
    "id": "uuid",
    "enrollment_id": "uuid",
    "school_id": "uuid",
    "student_id": "uuid",
    "group_id": "uuid",
    "group_name": "Cohorte Matin",
    "total_fee": 100000,
    "paid": 50000,
    "balance": 50000,
    "status": "active",
    "created_at": "2026-11-10T10:00:00.000Z"
  },
  "installments": [
    {
      "id": "uuid",
      "enrollment_id": "uuid",
      "position": 1,
      "label": "Tranche 1",
      "amount": 50000,
      "due_date": "2026-11-20",
      "paid": 50000,
      "cumulative_due": 50000,
      "paid_amount": 50000,
      "status": "paid"
    }
  ],
  "payments": [
    {
      "id": "uuid",
      "school_id": "uuid",
      "enrollment_id": "uuid",
      "amount": 50000,
      "method": "cash",
      "reference": null,
      "receipt_number": "LM-2026-000001",
      "paid_at": "2026-11-10T10:05:00.000Z",
      "recorded_by": "user-id",
      "recorded_by_name": "Direction",
      "client_id": "uuid",
      "cancelled_at": null,
      "cancelled_by": null,
      "cancel_reason": null,
      "enrollment_total_fee": 100000,
      "balance_at_issuance": 50000,
      "current_balance": 50000,
      "receipt_status": "confirmed",
      "is_offline_provisional_number": false
    }
  ],
  "attempts": [
    { "id": "uuid", "quiz_id": "uuid", "score": 18, "total": 20, "taken_at": "2026-11-10T11:00:00.000Z" }
  ]
}
```

### 4.3 `GET /api/schools/:slug/resources` & `GET /api/schools/:slug/resources/:id/url`
- `GET /resources`: Returns published resources for which the caller passes RLS `content_read` (`is_admin() OR (is_published AND can_learn(licence_category_id))`).
  - **Response `200 OK`:** `{ "resources": [{ "id": "uuid", "licence_category_id": "uuid", "title": "string", "description": "string", "type": "pdf" | "video" | "link" | "image", "is_published": true }] }`
- `GET /resources/:id/url`: Verifies RLS entitlement (`403 RESOURCE_FORBIDDEN` if unpublished, wrong school, wrong permit category, or expired trial with no valid payment).
  - For R2-backed objects (`storage_path`), returns a **120-second presigned GET URL**: `{ "url": "https://...X-Amz-Expires=120...", "expiresIn": 120 }`.
  - For external HTTPS links (`external_url`), returns `{ "url": "https://...", "expiresIn": null }`.

### 4.4 `GET /api/schools/:slug/quizzes` & `POST /api/schools/:slug/quiz-attempts`
- `GET /quizzes`: Returns published quizzes for the learner's permit category with questions (`id, quiz_id, body, options, image_url, explanation, position`). `correct_index` is never exposed to learners.
- `POST /quiz-attempts`: Grades the submission on the server idempotently by `clientId`.
  - **Request:** `{ "quizId": "uuid", "clientId": "uuid", "answers": { "<questionId>": "0" }, "takenAt": "ISO-8601 datetime" }`
  - **Response `201 Created`:**
  ```json
  {
    "attempt": {
      "id": "uuid",
      "school_id": "uuid",
      "student_id": "uuid",
      "quiz_id": "uuid",
      "answers": { "<questionId>": "0" },
      "score": 1,
      "total": 1,
      "taken_at": "2026-11-10T12:00:00.000Z",
      "client_id": "uuid"
    },
    "explanations": {
      "<questionId>": "Explication pédagogique..."
    }
  }
  ```
  - **Errors:** `403 STUDENT_REQUIRED`, `403 QUIZ_FORBIDDEN`, `400 EMPTY_QUIZ`, `409 IDEMPOTENCY_CONFLICT`

---

## 5. School Administration Endpoints (`/api/schools/:slug/admin/*`)

All `/admin/*` endpoints require `role === "admin"` in the active school (`403 ADMIN_REQUIRED`).

### 5.1 `GET /api/schools/:slug/admin/dashboard`
- **Response `200 OK`:** `{ "students": 9, "collected": 450000, "owed": 350000, "overdue": 2, "recentPayments": Payment[] }`

### 5.2 `GET /api/schools/:slug/admin/students` (Paginated + Deterministic Enrollment)
- **Query Parameters:**
  - `search` (optional string, up to 100 chars, matches `full_name ILIKE` or `phone ILIKE`)
  - `limit` (optional integer `1..200`, default `50`)
  - `offset` (optional integer `0..500000`, default `0`)
- **Deterministic Enrollment Selection:** Uses the exact same lateral ordering as `dossier` (`ORDER BY (e.status <> 'cancelled') DESC, e.created_at DESC, e.id DESC LIMIT 1`).
- **Response `200 OK`:**
```json
{
  "students": [
    {
      "id": "uuid",
      "full_name": "Jean-Pierre Mbarga",
      "phone": "+237699000011",
      "student_number": 1001,
      "licence_category_id": "uuid",
      "trial_ends_at": "2026-11-24T10:00:00.000Z",
      "has_paid": true,
      "has_access": true,
      "enrollment_id": "uuid",
      "group_id": "uuid",
      "group_name": "Cohorte Matin",
      "balance": 50000,
      "paid": 50000,
      "total_fee": 100000,
      "enrollment_status": "active"
    }
  ],
  "count": 1,
  "limit": 50,
  "offset": 0,
  "hasMore": false,
  "nextOffset": 1
}
```

### 5.3 `POST /api/schools/:slug/admin/students` & `POST /api/schools/:slug/admin/students/:id/invite`
- `POST /admin/students`: Creates a walk-in student, enrolls them in `groupId`, and issues a 24-hex invitation code (`SHA-256` stored in `school_app.invites`).
  - **Request:** `{ "fullName": "string", "phone": "+237[26]XXXXXXXX", "groupId": "uuid" }`
  - **Response `201 Created`:** `{ ...Dossier, "inviteCode": "24-HEX-CHARS" }`
  - **Errors:** `400 INVALID_GROUP`, `409 PHONE_ALREADY_REGISTERED`
- `POST /admin/students/:id/invite`: Rotates and returns a fresh 24-hex invitation code for an unactivated student.
  - **Response `200 OK`:** `{ "inviteCode": "24-HEX-CHARS" }`
  - **Errors:** `404 STUDENT_NOT_FOUND`, `409 STUDENT_ALREADY_ACTIVATED`

### 5.4 Payments, Offline Reconciliation & Receipt Policy (`POST /admin/payments`, `GET /admin/payments`, `POST /admin/payments/:id/cancel`)

#### Receipt Numbering & Policy (`E04`)
1. **Server-Issued Official Receipts (`receiptNumber` omitted):**
   - Format: `<SCHOOL_RECEIPT_PREFIX>-<YYYY>-<6_DIGIT_SEQ>` in `Africa/Douala` time (e.g. `LM-2026-000011`), allocated transactionally from `school_app.receipt_counters(school_id, year)`.
2. **Offline Device Reconciliation Receipts (`receiptNumber` provided):**
   - Format: `^RC-(?![0-9]{4}-)[A-Z0-9]{4,32}-[0-9]{1,12}$` (e.g. `RC-DEV9A8B7C6D5-000001`, generated by `nextOfflineReceipt(schoolId)` in Angular).
   - **Disjoint Namespace Guarantee:** The `<device>` segment MUST be 4–32 uppercase alphanumeric characters and **cannot** be a 4-digit year (`^[0-9]{4}$`). Supplying `RC-2026-000001` is rejected with `400 INVALID_RECEIPT_NUMBER`.
   - Offline receipts do **not** touch `school_app.receipt_counters`.
   - If a different `clientId` attempts to reuse an existing `receiptNumber` in the same school, the API returns `409 RECEIPT_NUMBER_CONFLICT`.
3. **Receipt Balance & Snapshot Fields:**
   - Every payment returned by `POST /admin/payments`, `GET /admin/payments`, `GET /me`, and `GET /admin/students/:id` includes:
     - `enrollment_total_fee`: Total fee of the enrollment's group.
     - `balance_at_issuance`: Remaining balance immediately after this payment was recorded (`null` if cancelled).
     - `current_balance`: Current live balance of the enrollment.
     - `receipt_status`: `"confirmed"` | `"cancelled"` (while unsynced client outbox items are `"provisional"`).
     - `is_offline_provisional_number`: `boolean` (`true` when reconciled from an `RC-<device>-<sequence>` number).
     - `recorded_by_name`: Display name of the admin who recorded the payment.
   - `school_app.audit_log` stores an immutable `school_snapshot` (`name`, `address`, `phone`, `whatsapp`, `agrement_number`, `receipt_prefix`) and `balance_snapshot` on every payment insert/cancel.

- **`POST /api/schools/:slug/admin/payments`**
  - **Request:**
  ```json
  {
    "enrollmentId": "uuid",
    "amount": 50000,
    "method": "cash" | "mtn_momo" | "orange_money" | "bank",
    "reference": "optional string | null",
    "clientId": "uuid",
    "paidAt": "ISO-8601 datetime",
    "receiptNumber": "optional RC-<DEVICE>-<SEQ>"
  }
  ```
  - **Response `201 Created`:** `{ "payment": Payment }`
  - **Errors:** `400 INVALID_PAYMENT`, `400 INVALID_RECEIPT_NUMBER`, `400 EXCEEDS_BALANCE`, `404 ENROLLMENT_NOT_FOUND`, `409 IDEMPOTENCY_CONFLICT`, `409 RECEIPT_NUMBER_CONFLICT`, `409 GROUP_FULL`
- **`POST /api/schools/:slug/admin/payments/:id/cancel`**
  - **Request:** `{ "reason": "string (3..500 chars)" }`
  - **Response `200 OK`:** `{ "ok": true }`
  - **Errors:** `400 REASON_REQUIRED`, `404 PAYMENT_NOT_FOUND`, `409 PAYMENT_ALREADY_CANCELLED`
- **`GET /api/schools/:slug/admin/payments?date=YYYY-MM[-DD]&offset=0`**
  - **Response `200 OK`:** `{ "payments": Payment[], "count": 7, "collected": 450000, "hasMore": false, "nextOffset": 7 }`

### 5.5 Groups & Settings (`GET/POST /admin/groups`, `PATCH /admin/groups/:id`, `PATCH /admin/settings`)
- `GET /admin/groups`: Returns all groups in the school with `confirmed_seats` and `installments`.
- `POST /admin/groups`: Creates a group and its installment schedule (`sum(installments.amount) === totalFee`, non-decreasing `dueDate`).
- `PATCH /admin/groups/:id`: `{ "status": "open" | "closed" | "finished" }` (`404 GROUP_NOT_FOUND` if missing).
- `PATCH /admin/settings`: Updates school `name`, `address`, `phone`, `whatsapp`, `agrement_number`, and `colors` (`primary`, `accent`).

### 5.6 Trusted Staff Content Authoring (`/admin/categories`, `/admin/resources`, `/admin/quizzes`)
All content mutations execute through audited `SECURITY DEFINER` functions in `school_app`:
- **`GET /admin/categories`**, **`POST /admin/categories`**, **`PATCH /admin/categories/:id`**
  - Body: `{ "code": "B", "name": "Permis B", "isActive": true }` (`409 CATEGORY_CODE_CONFLICT` on duplicate code).
- **`GET /admin/resources`**, **`POST /admin/resources`**, **`PATCH /admin/resources/:id`**
  - Body: `{ "licenceCategoryId": "uuid", "title": "string", "description": "string", "type": "pdf" | "video" | "link" | "image", "storagePath": "<schoolId>/resources/...", "externalUrl": "https://...", "isPublished": boolean }`
  - `storagePath` for new R2 objects must begin with `<schoolId>/` (`403 RESOURCE_FORBIDDEN` otherwise).
- **`POST /admin/resources/upload-url`**
  - Body: `{ "fileName": "code-de-la-route.pdf", "contentType": "application/pdf" | "video/mp4" | "image/png" | "image/jpeg" | "image/webp" }`
  - Returns `201 Created`: `{ "uploadUrl": "https://...", "storagePath": "<schoolId>/resources/<uuid>-code-de-la-route.pdf", "expiresIn": 300 }`.
- **`GET /admin/quizzes`**, **`POST /admin/quizzes`**, **`PATCH /admin/quizzes/:id`**, **`POST /admin/quizzes/:id/questions`**
  - `POST /admin/quizzes`: `{ "licenceCategoryId": "uuid", "title": "string", "durationMinutes": 20, "isPublished": true, "questions": [{ "body": "string", "options": ["A", "B"], "correctIndex": 0, "imageUrl": null, "explanation": "string", "position": 1 }] }`
  - Validates `options.length >= 2` and `0 <= correctIndex < options.length` (`400 INVALID_QUESTION_OPTIONS`), and refuses publishing a quiz with 0 questions (`400 EMPTY_QUIZ`).

---

## 6. Audited Platform Actions (`POST /api/platform/schools`)
Requires the caller's `user_id` to be present in `school_app.platform_admins` (`403 PLATFORM_ADMIN_REQUIRED`).
- **Request:**
```json
{
  "action": "create_school" | "suspend_school" | "activate_school",
  "schoolId": "uuid | null",
  "reason": "string (5..500 chars)",
  "data": {
    "name": "Auto-école Pilote",
    "slug": "auto-ecole-pilote",
    "address": "...",
    "phone": "+237...",
    "whatsapp": "+237...",
    "agrement_number": "...",
    "adminUserId": "optional existing identity user id"
  }
}
```
- **Response `200 OK`:** `{ "school": School }`

---

## 7. Complete Sanitized Error Matrix

| Error Code | HTTP Status | When Returned |
| :--- | :---: | :--- |
| `AUTH_REQUIRED` | `401` | Missing or expired Better Auth session cookie |
| `ORIGIN_FORBIDDEN` | `403` | Missing or untrusted `Origin` header on state-changing request |
| `TURNSTILE_REQUIRED` | `403` | Missing `X-Turnstile-Token` header on `/api/auth/sign-up/email` |
| `TURNSTILE_FAILED` | `403` | Invalid, expired, or replayed Cloudflare Turnstile token |
| `SESSION_IDENTITY_CHANGED` | `403` | `X-Expected-User` header does not match active cookie session user |
| `MEMBERSHIP_REQUIRED` | `403` | Authenticated user is not a member of `:slug` school |
| `ADMIN_REQUIRED` | `403` | Learner attempted a school admin operation |
| `PLATFORM_ADMIN_REQUIRED` | `403` | Caller is not in `school_app.platform_admins` |
| `STUDENT_REQUIRED` | `403` | Non-student attempted to submit a quiz attempt |
| `RESOURCE_FORBIDDEN` | `403` | Resource unpublished, wrong school/permit category, or learner has no active trial/payment |
| `QUIZ_FORBIDDEN` | `403` | Quiz unpublished, wrong school/permit category, or learner has no active trial/payment |
| `SCHOOL_NOT_FOUND` | `404` | Unknown or suspended school `:slug` |
| `STUDENT_NOT_FOUND` | `404` | Student UUID or `me` dossier not found in school |
| `ENROLLMENT_NOT_FOUND` | `404` | Enrollment UUID not found or cancelled when recording payment |
| `PAYMENT_NOT_FOUND` | `404` | Payment UUID not found in school |
| `GROUP_NOT_FOUND` | `404` | Group UUID not found in school |
| `RESOURCE_NOT_FOUND` | `404` | Resource UUID not found in school |
| `QUIZ_NOT_FOUND` | `404` | Quiz UUID not found in school |
| `NOT_FOUND` | `404` | Unknown route under `/api/schools/:slug/*` |
| `IDEMPOTENCY_CONFLICT` | `409` | Same `clientId` reused with different payment or quiz parameters |
| `RECEIPT_NUMBER_CONFLICT` | `409` | Offline `RC-<device>-<seq>` number already used by another payment |
| `PHONE_ALREADY_REGISTERED` | `409` | Student phone number already exists in the school |
| `STUDENT_ALREADY_REGISTERED` | `409` | User identity is already linked to a student in the school |
| `STUDENT_ALREADY_ACTIVATED` | `409` | Cannot create a walk-in invite for an already activated student |
| `PAYMENT_ALREADY_CANCELLED` | `409` | Payment was already cancelled |
| `GROUP_FULL` | `409` | First payment would exceed group `capacity` of confirmed seats |
| `SCHOOL_SLUG_CONFLICT` | `409` | School slug already exists |
| `CATEGORY_CODE_CONFLICT` | `409` | Permit category code already exists in the school |
| `RATE_LIMITED` | `429` | Signup rate limit exceeded for caller IP |
| `STORAGE_UNCONFIGURED` | `503` | R2 credentials not configured on Worker |
| `EMAIL_DELIVERY_UNAVAILABLE` | `503` | Recovery email webhook unconfigured or unreachable |
| `VALIDATION_ERROR` | `400` | Request payload failed Zod schema validation |
| `INVALID_GROUP` | `400` | Group does not exist, is not `open`, or its permit category is inactive |
| `INVALID_LICENCE` | `400` | Permit category does not exist or is inactive in school |
| `INVALID_INSTALLMENTS` | `400` | Installment amounts do not sum to `totalFee` or dates are out of order |
| `INVALID_INVITE` | `400` | Walk-in invite code is invalid, expired, used, or phone does not match |
| `INVALID_PAYMENT` | `400` | Payment amount out of range (`<= 0` or `> 1,000,000,000`) |
| `INVALID_RECEIPT_NUMBER` | `400` | Custom `receiptNumber` does not match `^RC-(?![0-9]{4}-)[A-Z0-9]{4,32}-[0-9]{1,12}$` |
| `EXCEEDS_BALANCE` | `400` | Payment amount exceeds remaining enrollment balance |
| `REASON_REQUIRED` | `400` | Cancellation or platform audit reason is too short |
| `EMPTY_QUIZ` | `400` | Cannot publish or grade a quiz with 0 questions |
| `INVALID_QUESTION_OPTIONS` | `400` | Question has `< 2` options or `correctIndex` is out of bounds |
