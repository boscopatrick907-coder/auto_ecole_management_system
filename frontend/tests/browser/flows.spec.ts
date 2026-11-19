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
    hasPaid: role === "student" ? dossier.student.has_paid : false,
    ...(role === "student"
      ? { trialEndsAt: dossier.student.trial_ends_at }
      : {}),
    maxOfflineUntilMs: Date.now() + 72 * 3600000,
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject(user.id)
    .setIssuer("school-api")
    .setAudience("school-pwa")
    .setExpirationTime("3d")
    .sign(privateKey);
  const key = await exportJWK(publicKey);
  const contentCategories = [{ id: "cat-a", code: "B", name: "Permis B" }];
  const materials: any[] = [];
  const authorQuizzes: any[] = [];
  await page
    .context()
    .route("https://uploads.test/**", (route) =>
      route.fulfill({ status: 200, body: "" }),
    );
  await page.context().route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/admin/categories") && method === "POST") {
      const b = route.request().postDataJSON();
      const category = { id: crypto.randomUUID(), code: b.code, name: b.name };
      contentCategories.push(category);
      return route.fulfill({ status: 201, json: { category } });
    }

    if (path.includes("/admin/resources") || path.includes("/admin/quizzes")) {
      if (role !== "admin")
        return route.fulfill({
          status: 403,
          json: { error: "ADMIN_REQUIRED" },
        });
      if (path.endsWith("/upload-url"))
        return route.fulfill({
          status: 201,
          json: {
            uploadUrl: "https://uploads.test/private-file",
            storagePath: "school-a/resources/synthetic.pdf",
          },
        });
      const isQuiz = path.includes("/admin/quizzes");
      const list = isQuiz ? authorQuizzes : materials;
      if (method === "GET")
        return route.fulfill({
          json: isQuiz ? { quizzes: list } : { resources: list },
        });
      const b = route.request().postDataJSON();
      const id = path.split("/").at(-1);
      const current =
        method === "PATCH"
          ? list.find((x) => x.id === id)
          : { id: crypto.randomUUID() };
      if (!current)
        return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
      if (b.title !== undefined) current.title = b.title;
      if (b.licenceCategoryId !== undefined)
        current.licence_category_id = b.licenceCategoryId;
      if (b.isPublished !== undefined) current.is_published = b.isPublished;
      if (isQuiz) {
        if (b.durationMinutes !== undefined)
          current.duration_minutes = b.durationMinutes;
        if (b.questions !== undefined)
          current.questions = b.questions.map((q: any, i: number) => ({
            ...q,
            id: q.id || crypto.randomUUID(),
            correct_index: q.correctIndex,
            image_url: q.imageUrl,
            position: i + 1,
          }));
      } else {
        if (b.description !== undefined) current.description = b.description;
        if (b.type !== undefined) current.type = b.type;
        if (b.storagePath !== undefined) current.storage_path = b.storagePath;
        if (b.externalUrl !== undefined) current.external_url = b.externalUrl;
      }
      if (method === "POST") list.push(current);
      return route.fulfill({
        status: method === "POST" ? 201 : 200,
        json: isQuiz ? { quiz: current } : { resource: current },
      });
    }
    const data = path.endsWith("/catalogue")
      ? {
          school,
          categories: contentCategories,
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
                  ? (() => {
                      const offset = Number(
                        new URL(route.request().url()).searchParams.get(
                          "offset",
                        ) || 0,
                      );
                      const row = (id: string, name: string, number: number) =>
                        ({
                          ...dossier.student,
                          id,
                          full_name: name,
                          student_number: number,
                          balance: 150000,
                          group_name: "Session matin",
                        }) as const;
                      return {
                        students:
                          offset === 0
                            ? [row("student-a", "Alice Test", 1000)]
                            : [row("student-b", "Benoit Test", 1001)],
                        count: 2,
                        limit: 50,
                        offset,
                        hasMore: offset === 0,
                        nextOffset: offset === 0 ? 1 : 2,
                      };
                    })()
                  : path.endsWith("/resources")
                    ? { resources: [] }
                    : path.endsWith("/quizzes")
                      ? {
                          quizzes: [
                            {
                              id: "quiz-a",
                              content_version: 1,
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

test("admin lease opens cached dashboard offline without student entitlements", async ({
  page,
  context,
}) => {
  await fixtures(page, "admin");
  await page.goto("/s/horizon/admin");
  await expect(page.locator(".kpi-grid .card strong").first()).toHaveText("1");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator(".kpi-grid .card strong").first()).toHaveText("1");

  await context.setOffline(true);
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Tableau de bord" }),
  ).toBeVisible();
  await expect(page.locator(".kpi-grid .card strong").first()).toHaveText("1");
});

test("admin student list loads subsequent API pages", async ({ page }) => {
  await fixtures(page, "admin");
  await page.goto("/s/horizon/admin/eleves");
  await expect(page.getByText("Alice Test", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Continuer", exact: true }).click();

  await expect(page.getByText("Benoit Test", { exact: true })).toBeVisible();
  await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continuer", exact: true }),
  ).toHaveCount(0);
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

  // Load the student dossier route while online so the same client-side route
  // can be exercised after the payment is queued offline.
  await page.evaluate(() => {
    history.pushState({}, "", "/s/horizon/admin/eleves/student-a");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByRole("link", { name: "Enregistrer un paiement" }),
  ).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/s/horizon/admin/paiement/student-a");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("button", { name: "Confirmer", exact: true })).toBeVisible();

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
  await expect(page.getByText(/PDF g\u00e9n\u00e9r\u00e9/)).toBeVisible();

  await page.evaluate(() => {
    history.pushState({}, "", "/s/horizon/admin/eleves/student-a");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("heading", { name: "Alice Test" })).toBeVisible();
  await expect(page.getByText(/PDF g\u00e9n\u00e9r\u00e9/)).toHaveCount(0);

  await page.evaluate(() => {
    history.pushState({}, "", "/s/horizon/admin/paiement/student-a");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText(/^RC-[A-F0-9]{12}-000001$/)).toBeVisible();
  await expect(page.getByText(/PDF g\u00e9n\u00e9r\u00e9/)).toHaveCount(0);
  await expect(
    page.getByText("1 modifications en attente", { exact: true }),
  ).toBeVisible();
});

test("admin authors private courses, previews drafts, edits and changes publication", async ({
  page,
}, testInfo) => {
  await fixtures(page, "admin");
  await page.goto("/s/horizon/admin/contenus");
  await expect(
    page.getByRole("heading", { name: "Supports et quiz" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Aucun cours pour cette sélection" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Ajouter une catégorie de permis",
      exact: true,
    })
    .click();
  await page.getByLabel("Code du permis", { exact: true }).fill("A");
  await page
    .getByLabel("Nom de la catégorie", { exact: true })
    .fill("Permis moto");
  await page
    .getByRole("button", { name: "Enregistrer le permis", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Catégorie de permis ajoutée",
  );
  await page
    .getByLabel("Filtrer par permis")
    .selectOption({ label: "Permis moto" });
  await page
    .getByRole("button", { name: "Nouveau cours", exact: true })
    .click();
  await page.getByLabel("Titre", { exact: true }).fill("Les priorités");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Support synthétique de sécurité routière");
  await page.getByLabel("Fichier (25 Mo maximum)").setInputFiles({
    name: "cours.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 synthetic"),
  });
  await page
    .getByRole("button", { name: "Prévisualiser", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Aperçu du contenu" }),
  ).toContainText("Les priorités");
  const upload = page.waitForRequest("https://uploads.test/private-file");
  await page
    .getByRole("button", { name: "Enregistrer en brouillon", exact: true })
    .click();
  const uploadRequest = await upload;
  expect(uploadRequest.method()).toBe("PUT");
  expect(uploadRequest.headers()["if-none-match"]).toBe("*");
  expect(uploadRequest.headers()["content-type"]).toBe("application/pdf");
  await expect(page.getByRole("status")).toContainText("Brouillon enregistré");
  const article = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Les priorités", exact: true }),
  });
  await expect(article).toContainText("Brouillon");
  await article.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(article).toContainText("Publié");
  await article.getByRole("button", { name: "Modifier", exact: true }).click();
  await page
    .getByLabel("Titre", { exact: true })
    .fill("Priorités et intersections");
  await page
    .getByRole("button", { name: "Enregistrer et publier", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Priorités et intersections",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dépublier", exact: true }).click();
  await expect(page.locator("article")).toContainText("Brouillon");
  await page.screenshot({
    path: testInfo.outputPath("content-admin-mobile.png"),
    fullPage: true,
  });
});
test("admin creates, previews, edits and duplicates quizzes with correct answers", async ({
  page,
}) => {
  await fixtures(page, "admin");
  await page.goto("/s/horizon/admin/contenus");
  await page
    .getByRole("button", { name: "Quiz et examens", exact: true })
    .click();
  await page.getByRole("button", { name: "Nouveau quiz", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill("Signalisation");
  await page.getByLabel("Durée en minutes").fill("15");
  await page
    .getByLabel("Énoncé", { exact: true })
    .fill("Quel feu impose l’arrêt ?");
  await page
    .getByRole("textbox", { name: "Choix 1, question 1", exact: true })
    .fill("Rouge");
  await page
    .getByRole("textbox", { name: "Choix 2, question 1", exact: true })
    .fill("Vert");
  await page
    .getByLabel("Explication de la réponse")
    .fill("Le rouge impose l’arrêt.");
  await page
    .getByRole("button", { name: "Prévisualiser", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Aperçu du contenu" }),
  ).toContainText("Rouge — Bonne réponse");
  await page
    .getByRole("button", { name: "Enregistrer et publier", exact: true })
    .click();
  await expect(page.locator("article")).toContainText("Publié");
  await expect(page.locator("article")).toContainText("1 question(s) · 15 min");
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page
    .getByLabel("Énoncé", { exact: true })
    .fill("Que signifie le feu rouge ?");
  await page
    .getByRole("button", { name: "Enregistrer en brouillon", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Aperçu du quiz", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Aperçu du contenu" }),
  ).toContainText("Que signifie le feu rouge ?");
  await page
    .getByRole("button", { name: "Fermer sans enregistrer", exact: true })
    .click();
  await page.getByRole("button", { name: "Dupliquer", exact: true }).click();
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue(
    "Signalisation — copie",
  );
  await page
    .getByRole("button", { name: "Enregistrer en brouillon", exact: true })
    .click();
  await expect(page.locator("article")).toHaveCount(2);
});
test("material failures preserve the form and unsupported files are rejected", async ({
  page,
}) => {
  await fixtures(page, "admin");
  await page.goto("/s/horizon/admin/contenus");
  await page
    .getByRole("button", { name: "Nouveau cours", exact: true })
    .click();
  await page.getByLabel("Titre", { exact: true }).fill("Cours à reprendre");
  await page.getByLabel("Fichier (25 Mo maximum)").setInputFiles({
    name: "danger.html",
    mimeType: "text/html",
    buffer: Buffer.from("<html>no</html>"),
  });
  await expect(page.getByRole("alert")).toContainText("Format non autorisé");
  await page.getByLabel("Fichier (25 Mo maximum)").setInputFiles({
    name: "cours.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 test"),
  });
  await page
    .context()
    .route("**/admin/resources/upload-url", (route) =>
      route.fulfill({ status: 503, json: { error: "STORAGE_UNCONFIGURED" } }),
    );
  await page
    .getByRole("button", { name: "Enregistrer en brouillon", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "stockage privé n’est pas configuré",
  );
  await expect(page.getByLabel("Titre", { exact: true })).toHaveValue(
    "Cours à reprendre",
  );
  await expect(
    page.getByRole("button", { name: "Enregistrer en brouillon", exact: true }),
  ).toBeEnabled();
});
test("student cannot open admin content authoring", async ({ page }) => {
  await fixtures(page, "student");
  await page.goto("/s/horizon/admin/contenus");
  await expect(page).toHaveURL(/\/s\/horizon\/accueil$/);
  await expect(
    page.getByRole("button", { name: "Nouveau cours", exact: true }),
  ).toHaveCount(0);
});

test("quiz draft survives reload with its answers, flags and original deadline", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/s/horizon/quiz");
  await page.getByRole("button", { name: "Commencer", exact: true }).click();
  await page.getByRole("button", { name: "A Le piéton" }).click();
  await expect(page.getByRole("button", { name: "A Le piéton" })).toHaveClass(
    /selected/,
  );
  await page.getByRole("button", { name: /À revoir/ }).click();
  await expect(page.getByRole("button", { name: /À revoir/ })).toHaveClass(
    /flagged/,
  );
  // Read stored state through IndexedDB rather than relying on component memory.
  const draft = await page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const r = indexedDB.open("school-pwa-v2");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const q = db
            .transaction("snapshots")
            .objectStore("snapshots")
            .get("school-a:user-a:quiz-draft");
          q.onsuccess = () => {
            resolve(q.result.data);
            db.close();
          };
        };
      }),
  );
  expect(draft.answers).toEqual({ "question-a": "0" });
  await page.reload();
  await expect(page.getByRole("button", { name: "A Le piéton" })).toHaveClass(
    /selected/,
  );
  await expect(page.getByRole("button", { name: /À revoir/ })).toHaveClass(
    /flagged/,
  );
  await expect(page.getByRole("status")).toContainText("Brouillon restauré");
  const request = page.waitForRequest((r) =>
    r.url().endsWith("/quiz-attempts"),
  );
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.clientId).toBe(draft.attemptId);
  expect(body.quizVersion).toBe(1);
  await expect(page.getByText("1 / 1", { exact: true }).first()).toBeVisible();
});

test("offline quiz submission survives reopening and shows the delayed server result", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/s/horizon/quiz");
  await page.getByRole("button", { name: "Commencer", exact: true }).click();
  await page.getByRole("button", { name: "A Le piéton" }).click();
  await expect(page.getByRole("button", { name: "A Le piéton" })).toHaveClass(
    /selected/,
  );
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Enregistré sur cet appareil. Résultat après synchronisation.",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retour", exact: true }).click();
  await expect(
    page.getByText("En attente de synchronisation", { exact: true }),
  ).toBeVisible();
  const request = page.waitForRequest((r) =>
    r.url().endsWith("/quiz-attempts"),
  );
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await request;
  await expect(
    page.getByText("Corrigé par le serveur", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1 / 1", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Corrigé par le serveur", { exact: true }),
  ).toBeVisible();
});

test("changed quiz content blocks a recovered draft without losing its answers", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/s/horizon/quiz");
  await page.getByRole("button", { name: "Commencer", exact: true }).click();
  await page.getByRole("button", { name: "A Le piéton" }).click();
  await expect(page.getByRole("button", { name: "A Le piéton" })).toHaveClass(
    /selected/,
  );
  await page
    .context()
    .route("**/quizzes", (r) =>
      r.fulfill({
        json: {
          quizzes: [
            {
              id: "quiz-a",
              content_version: 2,
              title: "Priorités",
              duration_minutes: 5,
              questions: [
                {
                  id: "question-a",
                  body: "Question modifiée",
                  options: ["Autre réponse", "Non"],
                  image_url: null,
                },
              ],
            },
          ],
        },
      }),
    );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Brouillon à vérifier" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Supprimer ce brouillon et revenir aux quiz" })
    .click();
  await expect(
    page.getByRole("button", { name: "Commencer", exact: true }),
  ).toBeEnabled();
});

test("admin pagination reaches learner 201 and resets correctly for a new search", async ({
  page,
}) => {
  await fixtures(page, "admin");
  await page.context().route("**/admin/students?**", (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset"));
    const search = url.searchParams.get("search");
    const rows = search
      ? [
          {
            ...dossier.student,
            id: "search-result",
            full_name: "Résultat unique",
            balance: 0,
            group_name: "Matin",
          },
        ]
      : Array.from({ length: Math.min(50, 201 - offset) }, (_, i) => ({
          ...dossier.student,
          id: `student-${offset + i + 1}`,
          full_name: `Élève ${offset + i + 1}`,
          balance: 0,
          group_name: "Matin",
        }));
    return route.fulfill({
      json: {
        students: rows,
        count: search ? 1 : 201,
        hasMore: !search && offset + rows.length < 201,
        nextOffset: offset + rows.length,
      },
    });
  });
  await page.goto("/s/horizon/admin/eleves");
  for (let i = 0; i < 4; i++)
    await page
      .getByRole("button", { name: "Continuer", exact: true })
      .click();
  await expect(page.getByText("Élève 201", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continuer", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Rechercher un élève" })
    .fill("unique");
  await page.getByRole("button", { name: "Rechercher un élève" }).click();
  await expect(
    page.getByText("Résultat unique", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Élève 201", { exact: true })).toHaveCount(0);
});

test("pending payment review preserves rejected evidence and excludes other schools", async ({
  page,
}) => {
  await fixtures(page, "admin");
  await page.goto("/s/horizon/admin");
  await expect(
    page.getByRole("heading", { name: "Tableau de bord" }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("school-pwa-v2");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("outbox", "readwrite"),
            store = tx.objectStore("outbox");
          const body = {
            clientId: "stable-payment-id",
            enrollmentId: "enrollment-a",
            amount: 50000,
            method: "cash",
            paidAt: new Date().toISOString(),
            receiptNumber: "RC-LOCALTEST-000001",
          };
          store.put({
            id: "stable-payment-id",
            scope: "school-a:user-a",
            kind: "payment",
            body,
            context: { studentId: "student-a", studentName: "Alice Test" },
            state: "blocked",
            attempts: 1,
            createdAt: Date.now(),
            nextAt: 0,
            error: "EXCEEDS_BALANCE",
          });
          store.put({
            id: "foreign-payment-id",
            scope: "school-b:user-other",
            kind: "payment",
            body: { ...body, clientId: "foreign-payment-id" },
            context: { studentName: "Foreign private learner" },
            state: "blocked",
            attempts: 0,
            createdAt: Date.now(),
            nextAt: 0,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.goto("/s/horizon/synchronisation");
  await expect(
    page.getByText("Montant supérieur au solde.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Foreign private learner", { exact: true }),
  ).toHaveCount(0);
  await page
    .context()
    .route("**/admin/payments", (r) =>
      r.fulfill({ status: 409, json: { error: "IDEMPOTENCY_CONFLICT" } }),
    );
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/admin/payments") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Réessayer cet envoi", exact: true })
    .click();
  const body = (await sent).postDataJSON();
  expect(body.clientId).toBe("stable-payment-id");
  expect(body.amount).toBe(50000);
  await expect(
    page.getByText("Cette référence correspond à une autre opération.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("RC-LOCALTEST-000001", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Ouvrir le dossier et le reçu", exact: true })
    .click();
  await expect(
    page.getByText("RC-LOCALTEST-000001", { exact: true }),
  ).toBeVisible();
});
