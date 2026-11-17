import "@angular/compiler";
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatMoney, installmentLabel } from "../src/app/shared/money.pipe";
import {
  database,
  accountScope,
  nextOfflineReceipt,
} from "../src/app/core/database";
import {
  OutboxService,
  retryDelay,
  shouldBlock,
} from "../src/app/core/outbox.service";
import { ApiService, RequestError } from "../src/app/core/api.service";
import { AuthService } from "../src/app/core/auth.service";
import { DataService } from "../src/app/core/data.service";
import {
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { Router } from "@angular/router";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true },
  configurable: true,
});

Object.assign(globalThis, {
  window: new EventTarget(),
  localStorage: {
    getItem: (k: string) => storage.get(k) || null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  },
  CustomEvent: class extends Event {
    constructor(type: string) {
      super(type);
    }
  },
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await database.snapshots.clear();
  await database.outbox.clear();
  await database.files.clear();
});

afterEach(() => vi.useRealTimers());

describe("French finance display", () => {
  it("uses narrow non-breaking spaces and whole FCFA", () => {
    expect(formatMoney(50000)).toBe("50\u202f000 FCFA");
    expect(formatMoney(0)).toBe("0 FCFA");
    expect(formatMoney("150000")).toBe("150\u202f000 FCFA");
  });

  it("maps all server installment states without recomputing amounts", () => {
    for (const status of ["paid", "partial", "overdue", "upcoming"])
      expect(installmentLabel(status)).toBe(status);

    expect(installmentLabel("unknown")).toBe("upcoming");
  });
});

describe("durable scoped outbox", () => {
  const setup = () => {
    const auth = { scope: accountScope("school-a", "user-a") };

    const api = {
      online: signal(true),
      tenant: vi.fn().mockResolvedValue({ payment: { id: "confirmed" } }),
    };

    const injector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
      null as never,
    );

    const outbox = runInInjectionContext(injector, () => new OutboxService());

    return { auth, api, outbox, injector };
  };

  it("keeps idempotency keys, stores confirmation and deletes only successful actions", async () => {
    const { outbox, api, injector } = setup();

    await outbox.enqueue("payment", { amount: 50000 }, "stable-id");
    await outbox.flush();

    expect(api.tenant).toHaveBeenCalledWith("admin/payments", "POST", {
      amount: 50000,
      clientId: "stable-id",
    });

    expect(await database.outbox.count()).toBe(0);

    expect(
      await database.snapshots.get("school-a:user-a:result:stable-id"),
    ).toBeDefined();

    injector.destroy();
  });

  it("cannot flush another school or account queue", async () => {
    const { outbox, api, auth, injector } = setup();

    await outbox.enqueue("quiz", { quizId: "q" }, "other");

    auth.scope = accountScope("school-b", "user-a");

    await outbox.flush();

    expect(api.tenant).not.toHaveBeenCalled();
    expect(await database.outbox.count()).toBe(1);

    injector.destroy();
  });

  it("retains rejected payments for intervention and backs off transient failures", async () => {
    const { outbox, api, injector } = setup();

    await outbox.enqueue("payment", { amount: 50000 }, "conflict");

    api.tenant.mockRejectedValueOnce(new RequestError(409, "GROUP_FULL"));

    await outbox.flush();

    expect((await database.outbox.get("conflict"))?.state).toBe("blocked");

    await outbox.enqueue("quiz", { quizId: "q" }, "transient");

    api.tenant.mockRejectedValueOnce(new RequestError(503, "UNAVAILABLE"));

    await outbox.flush();

    const row = await database.outbox.get("transient");

    expect(row?.state).toBe("pending");
    expect(row?.nextAt).toBeGreaterThan(Date.now());
    expect(await database.outbox.count()).toBe(2);

    injector.destroy();
  });

  it("does not delete actions on authentication expiry", async () => {
    const { outbox, api, injector } = setup();

    await outbox.enqueue("payment", { amount: 1 }, "auth");

    api.tenant.mockRejectedValue(new RequestError(401, "AUTH_REQUIRED"));

    await outbox.flush();

    expect(await database.outbox.get("auth")).toBeDefined();

    injector.destroy();
  });

  it("bounds retry delays and treats rate limits as retryable", () => {
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(50)).toBeLessThanOrEqual(3600000);
    expect(shouldBlock(429)).toBe(false);
    expect(shouldBlock(400)).toBe(true);
  });
});

describe("signed offline access", () => {
  it("rejects a paid-user lease after its offline limit, wrong school and clock rollback", async () => {
    const api = { online: signal(false) };

    const injector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
      null as never,
    );

    const auth = runInInjectionContext(injector, () => new AuthService());

    auth.school.set({ id: "a" } as never);
    auth.user.set({ id: "u" } as never);
    auth.role.set("student");

    const { privateKey, publicKey } = await generateKeyPair("EdDSA");
    const jwk = await exportJWK(publicKey);
    const now = Date.now();

    const save = async (
      schoolId: string,
      max: number,
      highWater = now,
      signedRole: "admin" | "student" = "student",
      hasAccess = true,
      hasPaid = true,
      trialEndsAt?: string,
    ) => {
      const token = await new SignJWT({
        role: signedRole,
        schoolId,
        hasAccess,
        hasPaid,
        ...(trialEndsAt ? { trialEndsAt } : {}),
        maxOfflineUntilMs: max,
      })
        .setProtectedHeader({ alg: "EdDSA" })
        .setSubject("u")
        .setIssuer("school-api")
        .setAudience("school-pwa")
        .setExpirationTime(Math.floor(max / 1000))
        .sign(privateKey);

      await database.snapshots.put({
        key: "a:u:lease",
        scope: "a:u",
        data: { token, publicKey: jwk, highWater },
        updatedAt: now,
      });
    };

    await save("a", now + 60000);
    expect(await auth.offlineAllowed()).toBe(true);

    auth.role.set("admin");
    await save("a", now + 60000, now, "admin", true, false);
    expect(await auth.offlineAllowed()).toBe(true);

    await save("a", now + 60000, now, "admin", false, false);
    expect(await auth.offlineAllowed()).toBe(false);

    auth.role.set("student");

    await save("b", now + 60000);
    expect(await auth.offlineAllowed()).toBe(false);

    await save("a", now - 60000);
    expect(await auth.offlineAllowed()).toBe(false);

    await save("a", now + 60000, now + 600000);
    expect(await auth.offlineAllowed()).toBe(false);

    injector.destroy();
  });
});

describe("authorization cache invalidation", () => {
  const setup = () => {
    const api = {
      online: signal(true),
      slug: "horizon",
      expectedUserId: "user-a",
      setAuthorizationErrorHandler: vi.fn(),
    };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const authInjector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: router },
      ],
      null as never,
    );
    const auth = runInInjectionContext(authInjector, () => new AuthService());
    auth.school.set({ id: "school-a" } as never);
    auth.user.set({ id: "user-a" } as never);
    auth.role.set("admin");
    const injector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
      null as never,
    );
    const data = runInInjectionContext(injector, () => new DataService());
    const scope = auth.scope;

    return {
      api,
      auth,
      data,
      dispose: () => {
        injector.destroy();
        authInjector.destroy();
      },
      router,
      scope,
    };
  };

  const seedProtectedRecords = async (scope: string) => {
    await database.snapshots.bulkPut([
      {
        key: scope + ":dashboard",
        scope,
        data: { students: 4 },
        updatedAt: Date.now(),
      },
      {
        key: scope + ":resources",
        scope,
        data: { resources: [] },
        updatedAt: Date.now(),
      },
      {
        key: scope + ":quizzes",
        scope,
        data: { quizzes: [] },
        updatedAt: Date.now(),
      },
      {
        key: "identity:horizon",
        scope: "identity:horizon",
        data: { user: { id: "user-a" }, role: "admin" },
        updatedAt: Date.now(),
      },
    ]);
    await database.files.put({
      key: scope + ":resource-a",
      scope,
      blob: new Blob(["lesson"]),
    });
    await database.outbox.add({
      id: "queued-payment",
      scope,
      kind: "payment",
      body: { enrollmentId: "enrollment-a", clientId: "queued-payment" },
      createdAt: Date.now(),
      attempts: 0,
      nextAt: 0,
      state: "pending",
    });
  };

  it.each([
    { status: 401, code: "AUTH_REQUIRED" },
    { status: 403, code: "MEMBERSHIP_REQUIRED" },
    { status: 403, code: "SESSION_IDENTITY_CHANGED" },
  ])("clears account data on identity denial $status $code", async ({
    status,
    code,
  }) => {
    const { auth, data, dispose, router, scope } = setup();
    await seedProtectedRecords(scope);

    await expect(
      data.read("dashboard", () =>
        Promise.reject(new RequestError(status, code)),
      ),
    ).rejects.toThrow(code);

    expect(await database.snapshots.where("scope").equals(scope).count()).toBe(
      0,
    );
    expect(await database.snapshots.get("identity:horizon")).toBeUndefined();
    expect(await database.files.where("scope").equals(scope).count()).toBe(0);
    expect(await database.outbox.get("queued-payment")).toBeDefined();
    expect(auth.user()).toBeNull();
    expect(auth.role()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(
      ["/s", "horizon", "connexion"],
      { replaceUrl: true },
    );

    dispose();
  });

  it("clears learning caches after entitlement denial and preserves admin data and queue", async () => {
    const { auth, data, dispose, scope } = setup();
    await seedProtectedRecords(scope);

    await expect(
      data.read("resources", () =>
        Promise.reject(new RequestError(403, "ACCESS_EXPIRED")),
      ),
    ).rejects.toThrow("ACCESS_EXPIRED");

    expect(await database.snapshots.get(scope + ":resources")).toBeUndefined();
    expect(await database.snapshots.get(scope + ":quizzes")).toBeUndefined();
    expect(await database.snapshots.get(scope + ":dashboard")).toBeDefined();
    expect(await database.files.where("scope").equals(scope).count()).toBe(0);
    expect(await database.outbox.get("queued-payment")).toBeDefined();
    expect(auth.user()?.id).toBe("user-a");
    expect(auth.role()).toBe("admin");

    dispose();
  });
});

describe("student list pagination contract", () => {
  it("requests the requested search and offset with the API page size", async () => {
    const api = new ApiService();
    api.slug = "horizon";
    const result = {
      students: [],
      count: 100,
      limit: 50,
      offset: 50,
      hasMore: true,
      nextOffset: 100,
    };
    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => result,
    });
    vi.stubGlobal("fetch", fetchStub);

    try {
      await expect(api.students("Jean Mbarga", 50)).resolves.toEqual(result);
      expect(fetchStub.mock.calls[0][0]).toBe(
        "/api/schools/horizon/admin/students?search=Jean%20Mbarga&limit=50&offset=50",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("awaits cache invalidation before rejecting a tenant authorization error", async () => {
    const api = new ApiService();
    api.slug = "horizon";
    api.expectedUserId = "user-a";
    let invalidated = false;
    const handler = vi.fn(async () => {
      await Promise.resolve();
      invalidated = true;
    });
    api.setAuthorizationErrorHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "MEMBERSHIP_REQUIRED" }),
      }),
    );

    try {
      await expect(api.tenant("admin/groups")).rejects.toThrow(
        "MEMBERSHIP_REQUIRED",
      );
      expect(invalidated).toBe(true);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403, code: "MEMBERSHIP_REQUIRED" }),
        "/schools/horizon/admin/groups",
        { schoolSlug: "horizon", expectedUserId: "user-a" },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("account-switch race protection", () => {
  it("does not invalidate the replacement account after a late denial", async () => {
    const api = new ApiService();
    api.slug = "horizon";
    api.expectedUserId = "user-a";

    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const authInjector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: router },
      ],
      null as never,
    );
    const auth = runInInjectionContext(
      authInjector,
      () => new AuthService(),
    );
    auth.school.set({ id: "school-a", slug: "horizon" } as never);
    auth.user.set({ id: "user-a" } as never);
    auth.role.set("admin");

    const dataInjector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
      null as never,
    );
    runInInjectionContext(dataInjector, () => new DataService());

    const replacementScope = accountScope("school-a", "user-b");
    await database.snapshots.put({
      key: replacementScope + ":dashboard",
      scope: replacementScope,
      data: { marker: "user-b-dashboard" },
      updatedAt: Date.now(),
    });
    await database.snapshots.put({
      key: "identity:horizon",
      scope: "identity:horizon",
      data: { user: { id: "user-b" }, role: "admin" },
      updatedAt: Date.now(),
    });
    await database.outbox.add({
      id: "user-b-queued-payment",
      scope: replacementScope,
      kind: "payment",
      body: { enrollmentId: "enrollment-b", clientId: "user-b-queued-payment" },
      createdAt: Date.now(),
      attempts: 0,
      nextAt: 0,
      state: "pending",
    });

    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );

    const request = api.me();
    auth.user.set({ id: "user-b" } as never);
    api.expectedUserId = "user-b";
    finish(
      new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), {
        status: 401,
      }),
    );

    await expect(request).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
    });
    expect(auth.user()?.id).toBe("user-b");
    expect(
      await database.snapshots.get(replacementScope + ":dashboard"),
    ).toMatchObject({ data: { marker: "user-b-dashboard" } });
    expect(await database.snapshots.get("identity:horizon")).toMatchObject({
      data: { user: { id: "user-b" } },
    });
    expect(await database.outbox.get("user-b-queued-payment")).toBeDefined();
    expect(router.navigate).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    dataInjector.destroy();
    authInjector.destroy();
  });

  it("rejects a cached file when identity changes during lease refresh", async () => {
    let userId = "user-a";
    let finishRefresh!: () => void;
    const auth = {
      scope: accountScope("school-a", userId),
      user: () => ({ id: userId }),
      refreshLease: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishRefresh = resolve;
          }),
      ),
      offlineAllowed: vi.fn().mockResolvedValue(true),
    };
    const api = {
      online: signal(true),
      slug: "horizon",
      expectedUserId: userId,
      setAuthorizationErrorHandler: vi.fn(),
    };
    const injector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
      null as never,
    );
    const data = runInInjectionContext(injector, () => new DataService());
    const oldScope = accountScope("school-a", "user-a");
    await database.files.put({
      key: oldScope + ":resource-a",
      scope: oldScope,
      blob: new Blob(["synthetic private material"]),
    });

    const file = data.file("resource-a");
    userId = "user-b";
    auth.scope = accountScope("school-a", userId);
    api.expectedUserId = userId;
    finishRefresh();

    await expect(file).rejects.toThrow("AUTH_CHANGED");
    expect(auth.offlineAllowed).not.toHaveBeenCalled();
    expect(
      await database.files.get(oldScope + ":resource-a"),
    ).toBeDefined();
    expect(
      await database.files.get(accountScope("school-a", "user-b") + ":resource-a"),
    ).toBeUndefined();
    injector.destroy();
  });

  it("does not persist a successful late lease under the replacement account", async () => {
    let finishLease!: (lease: { token: string; publicKey: never }) => void;
    const api = {
      slug: "horizon",
      expectedUserId: "user-a",
      tenant: vi.fn(
        () =>
          new Promise<{ token: string; publicKey: never }>((resolve) => {
            finishLease = resolve;
          }),
      ),
    };
    const injector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
      null as never,
    );
    const auth = runInInjectionContext(
      injector,
      () => new AuthService(),
    );
    auth.school.set({ id: "school-a", slug: "horizon" } as never);
    auth.user.set({ id: "user-a" } as never);
    auth.role.set("student");

    const oldScope = auth.scope;
    const replacementScope = accountScope("school-a", "user-b");
    await database.snapshots.put({
      key: replacementScope + ":lease",
      scope: replacementScope,
      data: { token: "existing-user-b-lease", publicKey: {} },
      updatedAt: Date.now(),
    });

    const refresh = auth.refreshLease();
    auth.user.set({ id: "user-b" } as never);
    api.expectedUserId = "user-b";
    finishLease({ token: "synthetic-user-a-lease", publicKey: {} as never });

    await expect(refresh).rejects.toThrow("AUTH_CHANGED");
    expect(await database.snapshots.get(oldScope + ":lease")).toBeUndefined();
    expect(await database.snapshots.get(replacementScope + ":lease")).toMatchObject({
      data: { token: "existing-user-b-lease" },
    });
    injector.destroy();
  });

  it("does not invalidate a replacement account after a late lease denial", async () => {
    let rejectLease!: (error: RequestError) => void;
    const api = {
      slug: "horizon",
      expectedUserId: "user-a",
      tenant: vi.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectLease = reject;
          }),
      ),
    };
    const router = { navigate: vi.fn() };
    const injector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: router },
      ],
      null as never,
    );
    const auth = runInInjectionContext(
      injector,
      () => new AuthService(),
    );
    auth.school.set({ id: "school-a", slug: "horizon" } as never);
    auth.user.set({ id: "user-a" } as never);
    auth.role.set("admin");
    const invalidate = vi.spyOn(auth, "invalidateAccountData");

    const replacementScope = accountScope("school-a", "user-b");
    await database.snapshots.put({
      key: replacementScope + ":dashboard",
      scope: replacementScope,
      data: { marker: "user-b-dashboard" },
      updatedAt: Date.now(),
    });
    await database.outbox.add({
      id: "user-b-payment-after-late-denial",
      scope: replacementScope,
      kind: "payment",
      body: { enrollmentId: "enrollment-b", clientId: "user-b-payment-after-late-denial" },
      createdAt: Date.now(),
      attempts: 0,
      nextAt: 0,
      state: "pending",
    });

    const refresh = auth.refreshLease();
    auth.user.set({ id: "user-b" } as never);
    api.expectedUserId = "user-b";
    rejectLease(new RequestError(401, "AUTH_REQUIRED"));

    await expect(refresh).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(auth.user()?.id).toBe("user-b");
    expect(
      await database.snapshots.get(replacementScope + ":dashboard"),
    ).toMatchObject({ data: { marker: "user-b-dashboard" } });
    expect(
      await database.outbox.get("user-b-payment-after-late-denial"),
    ).toBeDefined();
    expect(router.navigate).not.toHaveBeenCalled();
    injector.destroy();
  });
});

it("offline receipt identity/counter survives logout and allocates unique concurrent numbers", async () => {
  const first = await nextOfflineReceipt("school-a");

  await database.snapshots.put({
    key: "profile",
    scope: "school-a:user-a",
    data: {},
    updatedAt: Date.now(),
  });

  await database.snapshots.where("scope").equals("school-a:user-a").delete();

  const next = await nextOfflineReceipt("school-a");

  expect(next.slice(0, -6)).toBe(first.slice(0, -6));
  expect(next).toMatch(/000002$/);

  const concurrent = await Promise.all(
    Array.from({ length: 20 }, () => nextOfflineReceipt("school-a")),
  );

  expect(new Set(concurrent).size).toBe(20);

  await database.snapshots.clear();

  const recreated = await nextOfflineReceipt("school-a");

  expect(recreated.slice(0, -6)).not.toBe(first.slice(0, -6));
});

describe("payment recovery", () => {
  const setup = () => {
    const auth = {
      scope: accountScope("school-a", "user-a"),
    };

    const api = {
      online: signal(true),
      tenant: vi.fn().mockResolvedValue({
        payment: {
          id: "confirmed-payment",
          enrollment_id: "enrollment-1",
          amount: 50000,
          receipt_number: "RC-001",
        },
      }),
    };

    const injector = createEnvironmentInjector(
      [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
      null as never,
    );

    const outbox = runInInjectionContext(injector, () => new OutboxService());

    return { auth, api, outbox, injector };
  };

  it("atomically queues a payment and saves its recovery reference", async () => {
    const { outbox, injector } = setup();

    const body = {
      enrollmentId: "enrollment-1",
      amount: 50000,
      method: "cash",
      paidAt: new Date().toISOString(),
    };

    await outbox.enqueuePayment("enrollment-1", body, "atomic-payment");

    const queued = await database.outbox.get("atomic-payment");

    const reference = await database.snapshots.get(
      "school-a:user-a:payment-operation:enrollment-1",
    );

    expect(queued).toBeDefined();
    expect(queued?.kind).toBe("payment");
    expect(queued?.body["clientId"]).toBe("atomic-payment");

    expect(reference).toBeDefined();
    expect((reference?.data as { id: string }).id).toBe("atomic-payment");

    injector.destroy();
  });

  it("prevents a second active payment for the same enrollment", async () => {
    const { outbox, injector } = setup();

    const body = {
      enrollmentId: "enrollment-1",
      amount: 50000,
      method: "cash",
    };

    await outbox.enqueuePayment("enrollment-1", body, "payment-first");

    await expect(
      outbox.enqueuePayment("enrollment-1", body, "payment-second"),
    ).rejects.toThrow("PAYMENT_OPERATION_IN_PROGRESS");

    expect(await database.outbox.count()).toBe(1);
    expect(await database.outbox.get("payment-first")).toBeDefined();
    expect(await database.outbox.get("payment-second")).toBeUndefined();

    injector.destroy();
  });

  it("does not create duplicate entries when the same payment is retried", async () => {
    const { outbox, injector } = setup();

    const body = {
      enrollmentId: "enrollment-1",
      amount: 50000,
      method: "cash",
    };

    await outbox.enqueuePayment("enrollment-1", body, "payment-retry");
    await outbox.enqueuePayment("enrollment-1", body, "payment-retry");

    expect(await database.outbox.count()).toBe(1);

    const recovered = await outbox.recoverPayment("enrollment-1");

    expect(recovered?.id).toBe("payment-retry");
    expect(recovered?.queued?.id).toBe("payment-retry");

    injector.destroy();
  });

  it("rejects reuse of a payment ID with a different payload", async () => {
    const { outbox, injector } = setup();

    await outbox.enqueuePayment(
      "enrollment-1",
      {
        enrollmentId: "enrollment-1",
        amount: 50000,
        method: "cash",
      },
      "payment-conflict",
    );

    await expect(
      outbox.enqueuePayment(
        "enrollment-1",
        {
          enrollmentId: "enrollment-1",
          amount: 100000,
          method: "bank",
        },
        "payment-conflict",
      ),
    ).rejects.toThrow("OUTBOX_OPERATION_CONFLICT");

    expect(await database.outbox.count()).toBe(1);

    injector.destroy();
  });

  it("recovers a pending payment after page reload", async () => {
    const { outbox, injector } = setup();

    const body = {
      enrollmentId: "enrollment-1",
      amount: 50000,
      method: "cash",
      paidAt: new Date().toISOString(),
    };

    await outbox.rememberPayment("enrollment-1", "payment-1", body);
    await outbox.enqueue("payment", body, "payment-1");

    const recovered = await outbox.recoverPayment("enrollment-1");

    expect(recovered?.id).toBe("payment-1");
    expect(recovered?.queued?.id).toBe("payment-1");
    expect(recovered?.payment).toBeNull();

    injector.destroy();
  });

  it("recovers a confirmed payment after synchronization", async () => {
    const { outbox, injector } = setup();

    const body = {
      enrollmentId: "enrollment-1",
      amount: 50000,
      method: "cash",
    };

    await outbox.rememberPayment("enrollment-1", "payment-2", body);
    await outbox.enqueue("payment", body, "payment-2");
    await outbox.flush();

    const recovered = await outbox.recoverPayment("enrollment-1");

    expect(recovered?.id).toBe("payment-2");
    expect(recovered?.queued).toBeNull();
    expect(recovered?.payment?.id).toBe("confirmed-payment");

    injector.destroy();
  });

  it("does not expose another account's payment", async () => {
    const { auth, outbox, injector } = setup();

    await outbox.rememberPayment("enrollment-1", "private-payment", {
      enrollmentId: "enrollment-1",
    });

    auth.scope = accountScope("school-a", "user-b");

    const recovered = await outbox.recoverPayment("enrollment-1");

    expect(recovered).toBeNull();

    injector.destroy();
  });

  it("does not mistake a missing operation for a failed payment", async () => {
    const { outbox, injector } = setup();

    await outbox.rememberPayment("enrollment-1", "uncertain-payment", {
      enrollmentId: "enrollment-1",
    });

    const recovered = await outbox.recoverPayment("enrollment-1");

    expect(recovered?.id).toBe("uncertain-payment");
    expect(recovered?.queued).toBeNull();
    expect(recovered?.payment).toBeNull();

    injector.destroy();
  });
});
