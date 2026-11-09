import { test, expect, type Page } from "@playwright/test";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
const school = {
  id: "school-a",
  name: "École Horizon",
  slug: "horizon",
  logo: null,
  colors: { primary: "#1f4e8c", accent: "#f5a623" },
  trial_days: 14,
  receipt_prefix: "RC",
  address: "Douala centre",
  phone: "+237699000001",
  whatsapp: "+237699000001",
  agrement_number: "AG-123",
  status: "active",
};
const user = { id: "user-a", name: "Alice Test", email: "alice@test.local" };
const dossier = {
  student: {
    id: "student-a",
    user_id: user.id,
    full_name: user.name,
    phone: "+237699000002",
    student_number: 1000,
    licence_category_id: "cat-a",
    trial_ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    has_access: true,
    has_paid: false,
  },
  enrollment: {
    id: "enrollment-a",
    group_id: "group-a",
    group_name: "Session matin",
    total_fee: 150000,
    paid: 0,
    balance: 150000,
  },
  installments: [
    {
      id: "inst-a",
      position: 1,
      label: "Première tranche",
      amount: 50000,
      paid_amount: 0,
      due_date: "2026-12-01",
      status: "upcoming",
    },
  ],
  payments: [],
  attempts: [],
};
async function fixtures(
  page: Page,
  role: "admin" | "student" | null = "student",
) {
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(msg.text());
  });
  page.on("pageerror", (err) => console.log(err.message));
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const token = await new SignJWT({
    schoolId: school.id,
    role,
    hasAccess: true,
    hasPaid: false,
    trialEndsAt: dossier.student.trial_ends_at,
    maxOfflineUntilMs: Date.now() + 72 * 3600000,
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject(user.id)
    .setIssuer("school-api")
    .setAudience("school-pwa")
    .setExpirationTime("3d")
    .sign(privateKey);
  const key = await exportJWK(publicKey);
  await page.context().route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/catalogue")
      ? {
          school,
          categories: [{ id: "cat-a", code: "B", name: "Permis B" }],
          groups: [],
        }
      : path.endsWith("/get-session")
        ? role
          ? { user }
          : null
        : path.endsWith("/session")
          ? { user, role, school }
          : path.endsWith("/lease")
            ? { token, publicKey: key }
            : path.endsWith("/me") || path.includes("/students/student-a")
              ? dossier
              : path.endsWith("/dashboard")
                ? {
                    students: 1,
                    collected: 50000,
                    owed: 100000,
                    overdue: 0,
                    recentPayments: [],
                  }
                : path.endsWith("/students")
                  ? {
                      students: [
                        {
                          ...dossier.student,
                          balance: 150000,
                          group_name: "Session matin",
                        },
                      ],
                    }
                  : path.endsWith("/resources")
                    ? { resources: [] }
                    : path.endsWith("/quizzes")
                      ? {
                          quizzes: [
                            {
                              id: "quiz-a",
                              title: "Priorités",
                              duration_minutes: 5,
                              questions: [
                                {
                                  id: "question-a",
                                  body: "Qui passe en premier ?",
                                  options: ["Le piéton", "La voiture"],
                                  image_url: null,
                                },
                              ],
                            },
                          ],
                        }
                      : path.endsWith("/quiz-attempts")
                        ? {
                            attempt: {
                              id: "attempt-a",
                              quiz_id: "quiz-a",
                              score: 1,
                              total: 1,
                              taken_at: new Date().toISOString(),
                            },
                          }
                        : path.endsWith("/admin/payments")
                          ? {
                              payment: {
                                id: "p-a",
                                enrollment_id: "enrollment-a",
                                amount: 50000,
                                method: "cash",
                                receipt_number: "RC-2026-000001",
                                paid_at: new Date().toISOString(),
                                cancelled_at: null,
                              },
                            }
                          : {};
    await route.fulfill({ json: data });
  });
}
test("school selection and unauthenticated guard", async ({ page }) => {
  await fixtures(page, null);
  await page.goto("/");
  await page.getByRole("textbox").fill("horizon");
  await page.getByRole("button", { name: "Ouvrir mon école" }).click();
  await expect(
    page.getByRole("heading", { name: "Connexion", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("École Horizon").first()).toBeVisible();
  await page.goto("/s/horizon/admin");
  await expect(page).toHaveURL(/connexion/);
  await expect(
    page.getByRole("heading", { name: "Tableau de bord" }),
  ).toHaveCount(0);
});
test("student dashboard follows design and has no merchant checkout", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/s/horizon/accueil");
  await expect(
    page.getByRole("heading", { name: "Bonjour, Alice" }),
  ).toBeVisible();
  await expect(page.getByText("#LM-1000")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cours", exact: true }),
  ).toBeVisible();
  expect(
    await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/student-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Paiements", exact: true }).click();
  await expect(page.getByText("Première tranche")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /MoMo|Orange Money/ }),
  ).toHaveCount(0);
});
test("student cannot navigate into admin", async ({ page }) => {
  await fixtures(page);
  await page.goto("/s/horizon/admin");
  await expect(
    page.getByRole("heading", { name: "Bonjour, Alice", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Tableau de bord" }),
  ).toHaveCount(0);
});
test("quiz submits real answers and displays server grading", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/s/horizon/quiz");
  await page.getByRole("button", { name: "Commencer", exact: true }).click();
  await page.getByRole("button", { name: "A Le piéton" }).click();
  const request = page.waitForRequest((r) =>
    r.url().endsWith("/quiz-attempts"),
  );
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  expect((await request).postDataJSON().answers).toEqual({ "question-a": "0" });
  await expect(page.getByText("1 / 1", { exact: true })).toBeVisible();
});
test("admin payment and receipt screens use actual dossier, no demo name", async ({
  page,
}) => {
  await fixtures(page, "admin");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/s/horizon/admin");
  await expect(
    page.getByRole("heading", { name: "Tableau de bord" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/admin-desktop.png",
    fullPage: true,
  });
  await page.goto("/s/horizon/admin/paiement/student-a");
  await expect(page.getByRole("heading", { name: "Alice Test" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmer", exact: true }).click();
  await expect(page.getByText("RC-2026-000001", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Télécharger le PDF" }),
  ).toBeVisible();
});
test("downloaded school shell and cached profile reopen offline", async ({
  page,
  context,
}) => {
  await fixtures(page);
  await page.goto("/s/horizon/accueil");
  await expect(
    page.getByRole("heading", { name: "Bonjour, Alice" }),
  ).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Bonjour, Alice" }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Bonjour, Alice" }),
  ).toBeVisible();
  await expect(
    page.getByText("Mode hors ligne — Synchronisation au retour du réseau."),
  ).toBeVisible();
});

test("offline admin payment stays provisional and visible in the queue", async ({
  page,
  context,
}) => {
  await fixtures(page, "admin");
  await page.goto("/s/horizon/admin/paiement/student-a");
  await expect(page.getByRole("heading", { name: "Alice Test" })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Confirmer", exact: true }).click();
  await expect(
    page.getByText("Provisoire — paiement en attente de synchronisation"),
  ).toBeVisible();
  await expect(
    page.getByText("1 modifications en attente", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^RC-[A-F0-9]{12}-000001$/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger le PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/^RC-.*\.pdf$/);
});
