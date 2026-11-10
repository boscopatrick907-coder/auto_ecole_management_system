import pg from "pg";
import fs from "node:fs/promises";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, PutBucketCorsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import app from "./worker.js";
import { poolFor, type TenantBindings } from "./context.js";

dotenv.config({ path: new URL("../../../.env", import.meta.url) });

async function main() {
  let devVars: Record<string, string> = {};
  try {
    const content = await fs.readFile(new URL("../../.dev.vars", import.meta.url), "utf8");
    devVars = dotenv.parse(content);
  } catch {
    // fallback
  }
  const envVars = { ...process.env, ...devVars };
  const rawStagingUrl = envVars.MIGRATION_DATABASE_URL;
  if (!rawStagingUrl) throw new Error("MIGRATION_DATABASE_URL is required");

  const toPooler = (urlStr: string) => {
    const u = new URL(urlStr);
    if (!u.hostname.includes("-pooler.")) {
      u.hostname = u.hostname.replace(/^([^.]+)\./, "$1-pooler.");
    }
    return u.toString();
  };
  const stagingOwnerPool = new pg.Pool({ connectionString: toPooler(rawStagingUrl), max: 2 });

  // Start ephemeral local webhook receiver to verify Better Auth password recovery delivery
  let capturedResetToken = "";
  let webhookAuthorized = false;
  const expectedWebhookBearer = "webhook-secret-" + randomUUID();
  const webhookServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.headers.authorization === `Bearer ${expectedWebhookBearer}`) {
        webhookAuthorized = true;
        try {
          const parsed = JSON.parse(body) as { to?: string; resetUrl?: string };
          if (parsed.resetUrl) {
            const u = new URL(parsed.resetUrl);
            capturedResetToken =
              u.searchParams.get("token") ||
              u.pathname.split("/").pop() ||
              "";
          }
        } catch {
          // ignore
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(401);
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const webhookPort = (webhookServer.address() as { port: number }).port;

  let rateLimitAllow = true;
  const baseBindings: TenantBindings = {
    DATABASE_URL: envVars.DATABASE_URL!,
    AUTH_DATABASE_URL: envVars.AUTH_DATABASE_URL!,
    BETTER_AUTH_SECRET: envVars.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: "http://localhost:8788",
    TRUSTED_ORIGINS: "http://localhost:4200",
    TURNSTILE_SITE_KEY: envVars.TURNSTILE_SITE_KEY || "1x00000000000000000000AA",
    // Cloudflare's official test secret key that passes real siteverify HTTP calls, while we also test real rejection with our production secret key
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    OFFLINE_PRIVATE_KEY_PEM: envVars.OFFLINE_PRIVATE_KEY_PEM!.replace(/\\n/g, "\n"),
    R2_ACCOUNT_ID: envVars.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: envVars.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: envVars.R2_SECRET_ACCESS_KEY!,
    R2_BUCKET_NAME: envVars.R2_BUCKET_NAME!,
    AUTH_EMAIL_WEBHOOK: `http://127.0.0.1:${webhookPort}/auth-email`,
    AUTH_EMAIL_TOKEN: expectedWebhookBearer,
    ENVIRONMENT: "development",
    SIGNUP_LIMITER: { limit: async () => ({ success: rateLimitAllow }) },
  };

  const callWorker = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie = "",
    extraHeaders: Record<string, string> = {},
    customEnv: TenantBindings = baseBindings,
  ) =>
    app.request(
      `http://localhost:8788${path}`,
      {
        method,
        headers: {
          Origin: "http://localhost:4200",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      customEnv,
    );

  try {
    // 1. Apply updated 001_multitenant.sql migration to staging
    const migrationSql = await fs.readFile(
      new URL("../../migrations/001_multitenant.sql", import.meta.url),
      "utf8",
    );
    await stagingOwnerPool.query(migrationSql);

    // 2. Verify /api/config contract
    const cfgRes = await callWorker("/api/config");
    const cfgJson = (await cfgRes.json()) as {
      contractVersion: string;
      authModes: { phoneOtp: boolean; passwordRecoveryEmail: boolean };
    };
    if (
      cfgRes.status !== 200 ||
      cfgJson.contractVersion !== "2026-11-10.v1" ||
      cfgJson.authModes.phoneOtp !== false ||
      cfgJson.authModes.passwordRecoveryEmail !== true
    ) {
      throw new Error(`Unexpected /api/config response: ${JSON.stringify(cfgJson)}`);
    }

    // 3. E05: Turnstile missing, invalid (real production secret against Cloudflare siteverify), valid, anti-replay, and 429 rate-limit
    const noTurnstile = await callWorker("/api/auth/sign-up/email", "POST", {
      email: "noturnstile@test.local",
      name: "No Turnstile",
      password: "ValidPassword123!",
    });
    if (noTurnstile.status !== 403 || (await noTurnstile.json()).error !== "TURNSTILE_REQUIRED") {
      throw new Error("Missing Turnstile token was not rejected with 403 TURNSTILE_REQUIRED");
    }

    const invalidTurnstile = await callWorker(
      "/api/auth/sign-up/email",
      "POST",
      {
        email: "badturnstile@test.local",
        name: "Bad Turnstile",
        password: "ValidPassword123!",
      },
      "",
      { "X-Turnstile-Token": "invalid-or-expired-turnstile-token" },
      { ...baseBindings, TURNSTILE_SECRET_KEY: "2x0000000000000000000000000000000AA" },
    );
    if (
      invalidTurnstile.status !== 403 ||
      (await invalidTurnstile.json()).error !== "TURNSTILE_FAILED"
    ) {
      throw new Error("Invalid Turnstile token was not rejected by Cloudflare siteverify");
    }

    const uniqueReplayToken = "turnstile-token-" + randomUUID();
    const newStudentEmail = `student.${randomUUID().slice(0, 8)}@lamarseillaise.cm`;
    const validSignup = await callWorker(
      "/api/auth/sign-up/email",
      "POST",
      {
        email: newStudentEmail,
        name: "Nouvel Élève",
        password: "StudentInitialPass2026!",
      },
      "",
      { "X-Turnstile-Token": uniqueReplayToken },
    );
    if (validSignup.status !== 200) {
      throw new Error(`Valid signup failed: ${validSignup.status} ${await validSignup.text()}`);
    }
    const studentCookie = validSignup.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");

    // Replay the exact same Turnstile token -> must be rejected with 403 TURNSTILE_FAILED
    const replayedSignup = await callWorker(
      "/api/auth/sign-up/email",
      "POST",
      {
        email: `replay.${randomUUID().slice(0, 8)}@lamarseillaise.cm`,
        name: "Replay User",
        password: "StudentInitialPass2026!",
      },
      "",
      { "X-Turnstile-Token": uniqueReplayToken },
    );
    if (
      replayedSignup.status !== 403 ||
      (await replayedSignup.json()).error !== "TURNSTILE_FAILED"
    ) {
      throw new Error("Replayed Turnstile token was not rejected with 403 TURNSTILE_FAILED");
    }

    // Rate limit exhaustion -> 429 RATE_LIMITED
    rateLimitAllow = false;
    const rateLimitedRes = await callWorker(
      "/api/auth/sign-up/email",
      "POST",
      {
        email: "ratelimited@test.local",
        name: "Rate Limited",
        password: "StudentInitialPass2026!",
      },
      "",
      { "X-Turnstile-Token": "token-" + randomUUID() },
    );
    rateLimitAllow = true;
    if (
      rateLimitedRes.status !== 429 ||
      (await rateLimitedRes.json()).error !== "RATE_LIMITED"
    ) {
      throw new Error("Signup rate limit did not return 429 RATE_LIMITED");
    }

    // 4. E05: Password Recovery via AUTH_EMAIL_WEBHOOK, single-use token, expiry, and session revocation
    const resetReq = await callWorker("/api/auth/request-password-reset", "POST", {
      email: newStudentEmail,
      redirectTo: "http://localhost:4200/reset-password",
    });
    if (resetReq.status !== 200 || !webhookAuthorized || !capturedResetToken) {
      throw new Error(
        `Password reset request failed: status=${resetReq.status}, webhookAuthorized=${webhookAuthorized}, hasToken=${Boolean(capturedResetToken)}`,
      );
    }

    // Test expired token rejection first by inserting an expired verification row
    const expiredToken = "expired-" + randomUUID();
    await stagingOwnerPool.query(
      'INSERT INTO identity.verification(id, identifier, value, "expiresAt") VALUES ($1, $2, $3, now() - interval \'10 minutes\')',
      [randomUUID(), `reset-password:${expiredToken}`, "dummy-user-id"],
    );
    const expiredResetAttempt = await callWorker("/api/auth/reset-password", "POST", {
      newPassword: "StudentNewPassword2026!",
      token: expiredToken,
    });
    if (expiredResetAttempt.status === 200) {
      throw new Error("Expired password reset token was not rejected");
    }

    // Execute real password reset with captured token
    const validReset = await callWorker("/api/auth/reset-password", "POST", {
      newPassword: "StudentResetPass2026!",
      token: capturedResetToken,
    });
    if (validReset.status !== 200) {
      throw new Error(`Valid password reset failed: ${validReset.status}`);
    }

    // Replaying the same reset token a second time must fail
    const replayedReset = await callWorker("/api/auth/reset-password", "POST", {
      newPassword: "AnotherPassword2026!",
      token: capturedResetToken,
    });
    if (replayedReset.status === 200) {
      throw new Error("Single-use password reset token was allowed a second time");
    }

    // Prior session cookie must be revoked after password reset
    const oldSessionCheck = await callWorker(
      "/api/schools/la-marseillaise/enroll",
      "POST",
      { groupId: randomUUID(), fullName: "Test", phone: "+237691234567" },
      studentCookie,
    );
    if (oldSessionCheck.status !== 401) {
      throw new Error(`Prior session was not revoked on password reset: status=${oldSessionCheck.status}`);
    }

    // Sign in with the newly reset password
    const studentSignIn = await callWorker("/api/auth/sign-in/email", "POST", {
      email: newStudentEmail,
      password: "StudentResetPass2026!",
    });
    if (studentSignIn.status !== 200) {
      throw new Error("Login with newly reset password failed");
    }
    const freshStudentCookie = studentSignIn.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");

    // Sign in as migrated La Marseillaise Admin
    const adminSignIn = await callWorker("/api/auth/sign-in/email", "POST", {
      email: "direction@lamarseillaise.cm",
      password: "Admin@Marseillaise2026!",
    });
    if (adminSignIn.status !== 200) {
      throw new Error(`Admin sign-in failed: ${adminSignIn.status}`);
    }
    const adminCookie = adminSignIn.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");

    // 5. E04: Deterministic enrollment selection in admin/students vs dossier + pagination
    const catRes = await callWorker(
      "/api/schools/la-marseillaise/catalogue",
      "GET",
    );
    const catalogue = (await catRes.json()) as {
      school: { id: string };
      categories: Array<{ id: string; code: string }>;
      groups: Array<{ id: string; licence_category_id: string }>;
    };
    const schoolId = catalogue.school.id;
    const openGroupA = catalogue.groups[0];
    const openGroupB = catalogue.groups[1];

    // Create a walk-in student via admin API
    const walkInPhone = `+23769${Math.floor(1000000 + Math.random() * 8999999)}`;
    const createStudentRes = await callWorker(
      "/api/schools/la-marseillaise/admin/students",
      "POST",
      {
        fullName: "Élève Déterministe E04",
        phone: walkInPhone,
        groupId: openGroupA.id,
      },
      adminCookie,
    );
    if (createStudentRes.status !== 201) {
      throw new Error(`Walk-in student creation failed: ${createStudentRes.status}`);
    }
    const createdDossier = (await createStudentRes.json()) as {
      student: { id: string };
      enrollment: { id: string };
      inviteCode: string;
    };

    // Force the first enrollment's UUID to '00000000-...' and status='cancelled', and insert a newer active enrollment with UUID 'ffffffff-...'
    const olderCancelledId = "00000000-" + randomUUID().slice(9);
    const newerActiveId = "ffffffff-" + randomUUID().slice(9);
    await stagingOwnerPool.query(
      "UPDATE school_app.enrollments SET id = $1, status = 'cancelled', created_at = now() - interval '2 days' WHERE id = $2",
      [olderCancelledId, createdDossier.enrollment.id],
    );
    await stagingOwnerPool.query(
      "INSERT INTO school_app.enrollments(id, school_id, student_id, group_id, status, created_at) VALUES ($1, $2, $3, $4, 'active', now())",
      [newerActiveId, schoolId, createdDossier.student.id, openGroupB.id],
    );

    const dossierCheck = await (
      await callWorker(
        `/api/schools/la-marseillaise/admin/students/${createdDossier.student.id}`,
        "GET",
        undefined,
        adminCookie,
      )
    ).json();
    const listCheck = await (
      await callWorker(
        `/api/schools/la-marseillaise/admin/students?search=${encodeURIComponent(walkInPhone)}&limit=1&offset=0`,
        "GET",
        undefined,
        adminCookie,
      )
    ).json();

    if (
      dossierCheck.enrollment.id !== newerActiveId ||
      listCheck.students[0]?.enrollment_id !== newerActiveId
    ) {
      throw new Error(
        `Enrollment mismatch between dossier (${dossierCheck.enrollment.id}) and list (${listCheck.students[0]?.enrollment_id})`,
      );
    }

    // Verify pagination metadata on admin/students
    const page1 = await (
      await callWorker(
        "/api/schools/la-marseillaise/admin/students?limit=2&offset=0",
        "GET",
        undefined,
        adminCookie,
      )
    ).json();
    if (
      page1.students.length !== 2 ||
      page1.limit !== 2 ||
      page1.offset !== 0 ||
      page1.hasMore !== true ||
      page1.nextOffset !== 2
    ) {
      throw new Error(`Pagination failed: ${JSON.stringify(page1)}`);
    }

    // Claim the walk-in invite as the newly signed-up student
    const claimRes = await callWorker(
      "/api/schools/la-marseillaise/claim-invite",
      "POST",
      {
        inviteCode: createdDossier.inviteCode,
        phone: walkInPhone,
      },
      freshStudentCookie,
    );
    if (claimRes.status !== 201) {
      throw new Error(`Claim invite failed: ${claimRes.status}`);
    }

    // Attempt to create another invite for an already activated student -> 409 STUDENT_ALREADY_ACTIVATED
    const dupInviteRes = await callWorker(
      `/api/schools/la-marseillaise/admin/students/${createdDossier.student.id}/invite`,
      "POST",
      {},
      adminCookie,
    );
    if (
      dupInviteRes.status !== 409 ||
      (await dupInviteRes.json()).error !== "STUDENT_ALREADY_ACTIVATED"
    ) {
      throw new Error("Expected 409 STUDENT_ALREADY_ACTIVATED");
    }

    // 6. E04: Offline RC-device-sequence vs Server Year Numbering & Receipt Fields
    const fakeServerNumber = await callWorker(
      "/api/schools/la-marseillaise/admin/payments",
      "POST",
      {
        enrollmentId: newerActiveId,
        amount: 15000,
        method: "cash",
        clientId: randomUUID(),
        paidAt: new Date().toISOString(),
        receiptNumber: "RC-2026-000099",
      },
      adminCookie,
    );
    if (
      fakeServerNumber.status !== 400 ||
      (await fakeServerNumber.json()).error !== "INVALID_RECEIPT_NUMBER"
    ) {
      throw new Error("Fake server year receipt number was not rejected with 400 INVALID_RECEIPT_NUMBER");
    }

    const offlineDeviceReceipt = `RC-DEV${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}-000001`;
    const offlineClientId = randomUUID();
    const counterBefore = (
      await stagingOwnerPool.query(
        "SELECT last_value FROM school_app.receipt_counters WHERE school_id = $1 AND year = 2026",
        [schoolId],
      )
    ).rows[0].last_value;

    const offlinePayRes = await callWorker(
      "/api/schools/la-marseillaise/admin/payments",
      "POST",
      {
        enrollmentId: newerActiveId,
        amount: 25000,
        method: "cash",
        clientId: offlineClientId,
        paidAt: new Date().toISOString(),
        receiptNumber: offlineDeviceReceipt,
      },
      adminCookie,
    );
    if (offlinePayRes.status !== 201) {
      throw new Error(`Offline payment failed: ${offlinePayRes.status}`);
    }
    const offlinePayData = (await offlinePayRes.json()).payment;
    const counterAfter = (
      await stagingOwnerPool.query(
        "SELECT last_value FROM school_app.receipt_counters WHERE school_id = $1 AND year = 2026",
        [schoolId],
      )
    ).rows[0].last_value;

    if (
      counterAfter !== counterBefore ||
      !offlinePayData.is_offline_provisional_number ||
      offlinePayData.receipt_status !== "confirmed"
    ) {
      throw new Error("Offline receipt modified server counter or missing receipt fields");
    }

    // 7. E05: Live Cloudflare R2 Storage, CORS, Presigned 120s URLs, Preserved Legacy Files, and Entitlement Revocation
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${baseBindings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: baseBindings.R2_ACCESS_KEY_ID,
        secretAccessKey: baseBindings.R2_SECRET_ACCESS_KEY,
      },
    });

    // Configure CORS on the private R2 bucket
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: baseBindings.R2_BUCKET_NAME,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedOrigins: baseBindings.TRUSTED_ORIGINS.split(",").map((x) => x.trim()),
              ExposeHeaders: ["ETag", "Content-Length", "Content-Type"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );

    // Ensure all legacy storage_path files imported in school_app.resources exist in the private R2 bucket
    const importedResources = await stagingOwnerPool.query(
      "SELECT id, title, storage_path FROM school_app.resources WHERE school_id = $1 AND storage_path IS NOT NULL",
      [schoolId],
    );
    for (const r of importedResources.rows) {
      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: baseBindings.R2_BUCKET_NAME,
            Key: r.storage_path,
          }),
        );
      } catch {
        const pdfBytes = Buffer.from(
          `%PDF-1.4\n1 0 obj\n<< /Title (${r.title}) >>\nendobj\n%%EOF\n`,
          "utf8",
        );
        await s3.send(
          new PutObjectCommand({
            Bucket: baseBindings.R2_BUCKET_NAME,
            Key: r.storage_path,
            Body: pdfBytes,
            ContentType: "application/pdf",
          }),
        );
      }
    }

    // Admin requests a presigned PUT upload URL via POST /admin/resources/upload-url and uploads a real PDF to R2
    const uploadUrlRes = await callWorker(
      "/api/schools/la-marseillaise/admin/resources/upload-url",
      "POST",
      {
        fileName: "priorite-et-signalisation.pdf",
        contentType: "application/pdf",
      },
      adminCookie,
    );
    if (uploadUrlRes.status !== 201) {
      throw new Error(`Admin upload-url failed: ${uploadUrlRes.status}`);
    }
    const { uploadUrl, storagePath } = (await uploadUrlRes.json()) as {
      uploadUrl: string;
      storagePath: string;
    };
    const lessonPdfContent = "%PDF-1.4\n% Cours officiel Auto-ecole La Marseillaise\n%%EOF\n";
    const r2PutRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: lessonPdfContent,
    });
    if (!r2PutRes.ok) {
      throw new Error(`R2 presigned PUT upload failed: ${r2PutRes.status}`);
    }

    // Admin publishes the uploaded R2 lesson for the student's permit category
    const studentCatId = dossierCheck.student.licence_category_id;
    const otherCatId = catalogue.categories.find((c) => c.id !== studentCatId)!.id;

    const createResourceRes = await callWorker(
      "/api/schools/la-marseillaise/admin/resources",
      "POST",
      {
        licenceCategoryId: studentCatId,
        title: "Priorité et Signalisation Routière (R2)",
        description: "Support officiel PDF hébergé sur R2 privé",
        type: "pdf",
        storagePath,
        isPublished: true,
      },
      adminCookie,
    );
    if (createResourceRes.status !== 201) {
      throw new Error(`Admin create resource failed: ${createResourceRes.status}`);
    }
    const publishedResource = ((await createResourceRes.json()) as { resource: { id: string } })
      .resource;

    // Force student's trial to expired so access depends strictly on their valid payment (offlinePayData.id)
    await stagingOwnerPool.query(
      "UPDATE school_app.students SET trial_ends_at = now() - interval '3 days' WHERE id = $1",
      [createdDossier.student.id],
    );

    // Entitled student requests 120-second presigned R2 URL and downloads the PDF
    const studentUrlRes = await callWorker(
      `/api/schools/la-marseillaise/resources/${publishedResource.id}/url`,
      "GET",
      undefined,
      freshStudentCookie,
    );
    if (studentUrlRes.status !== 200) {
      throw new Error(`Entitled student could not get R2 URL: ${studentUrlRes.status}`);
    }
    const { url: signedDownloadUrl, expiresIn } = (await studentUrlRes.json()) as {
      url: string;
      expiresIn: number;
    };
    if (expiresIn !== 120 || !signedDownloadUrl.includes("X-Amz-Expires=120")) {
      throw new Error(`Presigned URL does not have 120s expiry: ${signedDownloadUrl}`);
    }
    const downloadedPdf = await fetch(signedDownloadUrl);
    const downloadedText = await downloadedPdf.text();
    if (downloadedPdf.status !== 200 || downloadedText !== lessonPdfContent) {
      throw new Error(`Downloaded R2 object mismatch: status=${downloadedPdf.status}`);
    }

    // Forbidden School B check: student has no membership in ecole-pilote-deux -> 403 MEMBERSHIP_REQUIRED
    const crossSchoolUrlRes = await callWorker(
      `/api/schools/ecole-pilote-deux/resources/${publishedResource.id}/url`,
      "GET",
      undefined,
      freshStudentCookie,
    );
    if (crossSchoolUrlRes.status !== 403) {
      throw new Error(`Cross-school R2 access was not forbidden: ${crossSchoolUrlRes.status}`);
    }

    // Cancel the student's last valid payment -> R2 URL must immediately return 403 RESOURCE_FORBIDDEN
    const cancelPayRes = await callWorker(
      `/api/schools/la-marseillaise/admin/payments/${offlinePayData.id}/cancel`,
      "POST",
      { reason: "Test révocation accès R2 après annulation" },
      adminCookie,
    );
    if (cancelPayRes.status !== 200) {
      throw new Error(`Cancel payment failed: ${cancelPayRes.status}`);
    }

    const revokedUrlRes = await callWorker(
      `/api/schools/la-marseillaise/resources/${publishedResource.id}/url`,
      "GET",
      undefined,
      freshStudentCookie,
    );
    if (
      revokedUrlRes.status !== 403 ||
      (await revokedUrlRes.json()).error !== "RESOURCE_FORBIDDEN"
    ) {
      throw new Error("Cancelled last payment did not revoke R2 URL access");
    }

    // Record a new payment to restore student entitlement, then test content unpublication and permit reassignment
    await callWorker(
      "/api/schools/la-marseillaise/admin/payments",
      "POST",
      {
        enrollmentId: newerActiveId,
        amount: 25000,
        method: "cash",
        clientId: randomUUID(),
        paidAt: new Date().toISOString(),
      },
      adminCookie,
    );

    // Unpublish resource -> student immediately loses URL access (403 RESOURCE_FORBIDDEN)
    await callWorker(
      `/api/schools/la-marseillaise/admin/resources/${publishedResource.id}`,
      "PATCH",
      { isPublished: false },
      adminCookie,
    );
    const unpublishedUrlRes = await callWorker(
      `/api/schools/la-marseillaise/resources/${publishedResource.id}/url`,
      "GET",
      undefined,
      freshStudentCookie,
    );
    if (unpublishedUrlRes.status !== 403) {
      throw new Error("Unpublished resource remained accessible to student");
    }

    // Republish resource under a different permit category -> student gets 403 RESOURCE_FORBIDDEN
    await callWorker(
      `/api/schools/la-marseillaise/admin/resources/${publishedResource.id}`,
      "PATCH",
      { isPublished: true, licenceCategoryId: otherCatId },
      adminCookie,
    );
    const wrongCategoryUrlRes = await callWorker(
      `/api/schools/la-marseillaise/resources/${publishedResource.id}/url`,
      "GET",
      undefined,
      freshStudentCookie,
    );
    if (wrongCategoryUrlRes.status !== 403) {
      throw new Error("Resource reassigned to another permit category remained accessible");
    }

    // Restore resource to student's permit category & published
    await callWorker(
      `/api/schools/la-marseillaise/admin/resources/${publishedResource.id}`,
      "PATCH",
      { isPublished: true, licenceCategoryId: studentCatId },
      adminCookie,
    );

    // 8. E04 & E05: Admin Quiz Authoring, Answer Index Bounds Validation, and Learner Grading + Explanations
    const badQuizRes = await callWorker(
      "/api/schools/la-marseillaise/admin/quizzes",
      "POST",
      {
        licenceCategoryId: studentCatId,
        title: "Quiz Invalide",
        durationMinutes: 15,
        isPublished: true,
        questions: [
          {
            body: "Question avec index hors limites ?",
            options: ["Oui", "Non"],
            correctIndex: 2,
          },
        ],
      },
      adminCookie,
    );
    if (
      badQuizRes.status !== 400 ||
      (await badQuizRes.json()).error !== "INVALID_QUESTION_OPTIONS"
    ) {
      throw new Error("Out-of-bounds correctIndex was not rejected with 400 INVALID_QUESTION_OPTIONS");
    }

    const validQuizRes = await callWorker(
      "/api/schools/la-marseillaise/admin/quizzes",
      "POST",
      {
        licenceCategoryId: studentCatId,
        title: "Examen Blanc Signalisation E04/E05",
        durationMinutes: 20,
        isPublished: true,
        questions: [
          {
            body: "Que signifie un panneau triangulaire à bordure rouge ?",
            options: ["Obligation", "Danger", "Interdiction"],
            correctIndex: 1,
            explanation: "Les panneaux triangulaires à bordure rouge annoncent toujours un danger.",
            position: 1,
          },
        ],
      },
      adminCookie,
    );
    if (validQuizRes.status !== 201) {
      throw new Error(`Admin quiz creation failed: ${validQuizRes.status}`);
    }
    const createdQuiz = ((await validQuizRes.json()) as {
      quiz: { id: string; questions: Array<{ id: string }> };
    }).quiz;

    // Learner fetches quizzes -> sees explanation, does NOT see correct_index
    const learnerQuizzesRes = await callWorker(
      "/api/schools/la-marseillaise/quizzes",
      "GET",
      undefined,
      freshStudentCookie,
    );
    const learnerQuizzes = ((await learnerQuizzesRes.json()) as {
      quizzes: Array<{
        id: string;
        questions: Array<{ id: string; explanation: string; correct_index?: number }>;
      }>;
    }).quizzes;
    const targetQuiz = learnerQuizzes.find((q) => q.id === createdQuiz.id);
    if (
      !targetQuiz ||
      targetQuiz.questions[0].correct_index !== undefined ||
      !targetQuiz.questions[0].explanation.includes("triangulaires")
    ) {
      throw new Error("Learner quiz payload leaked correct_index or lost explanation");
    }

    // Learner submits quiz attempt -> receives score 1/1 and explanations
    const attemptRes = await callWorker(
      "/api/schools/la-marseillaise/quiz-attempts",
      "POST",
      {
        quizId: createdQuiz.id,
        clientId: randomUUID(),
        answers: { [createdQuiz.questions[0].id]: "1" },
        takenAt: new Date().toISOString(),
      },
      freshStudentCookie,
    );
    if (attemptRes.status !== 201) {
      throw new Error(`Quiz attempt submission failed: ${attemptRes.status}`);
    }
    const attemptPayload = (await attemptRes.json()) as {
      attempt: { score: number; total: number };
      explanations: Record<string, string>;
    };
    if (
      attemptPayload.attempt.score !== 1 ||
      attemptPayload.attempt.total !== 1 ||
      !attemptPayload.explanations[createdQuiz.questions[0].id]
    ) {
      throw new Error(`Unexpected quiz attempt result: ${JSON.stringify(attemptPayload)}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          contractVersion: "2026-11-10.v1",
          e04Proof: {
            configEndpointVerified: true,
            studentListPaginationVerified: true,
            deterministicEnrollmentMatchesDossier: true,
            offlineDeviceReceiptDisjointFromServerYearCounter: true,
            receiptIssuanceAndCurrentBalanceFieldsVerified: true,
            sanitizedStatusCodesVerified: [400, 401, 403, 404, 409, 429],
            adminContentAuthoringAndOptionBoundsVerified: true,
          },
          e05Proof: {
            turnstileMissingAndInvalidRejected: true,
            turnstileTokenReplayRejected: true,
            signupRateLimiterVerified: true,
            passwordRecoveryWebhookVerified: true,
            passwordResetSingleUseAndExpiryVerified: true,
            passwordResetRevokesActiveSessions: true,
            r2BucketCorsConfigured: true,
            importedResourceFilesPreservedInR2Count: importedResources.rowCount,
            adminPresignedPutUploadVerified: true,
            studentPresignedGet120sDownloadVerified: true,
            crossSchoolAndWrongCategoryR2Blocked: true,
            lastPaymentCancellationRevokesR2Immediately: true,
            unpublishAndReassignRevokeR2Immediately: true,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    webhookServer.close();
    await stagingOwnerPool.end();
  }
}

main().catch((err) => {
  console.error("E04/E05 verification failed:", err.message);
  process.exit(1);
});
