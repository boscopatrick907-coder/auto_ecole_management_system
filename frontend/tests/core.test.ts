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
import {
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
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
      [{ provide: ApiService, useValue: api }],
      null as never,
    );
    const auth = runInInjectionContext(injector, () => new AuthService());
    auth.school.set({ id: "a" } as never);
    auth.user.set({ id: "u" } as never);
    const { privateKey, publicKey } = await generateKeyPair("EdDSA");
    const jwk = await exportJWK(publicKey);
    const now = Date.now();
    const save = async (schoolId: string, max: number, highWater = now) => {
      const token = await new SignJWT({
        schoolId,
        hasAccess: true,
        hasPaid: true,
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
    await save("b", now + 60000);
    expect(await auth.offlineAllowed()).toBe(false);
    await save("a", now - 60000);
    expect(await auth.offlineAllowed()).toBe(false);
    await save("a", now + 60000, now + 600000);
    expect(await auth.offlineAllowed()).toBe(false);
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
