import "@angular/compiler";
import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { database } from "../src/app/core/database";
import { ApiService, RequestError } from "../src/app/core/api.service";
import { AuthService } from "../src/app/core/auth.service";
import { OutboxService } from "../src/app/core/outbox.service";
import { syncError } from "../src/app/pages/synchronisation";
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true },
  configurable: true,
});
Object.assign(globalThis, { window: new EventTarget() });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await database.outbox.clear();
  await database.snapshots.clear();
});
afterEach(() => vi.useRealTimers());
function setup() {
  const auth = { scope: "school-a:user-a" };
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
}
it("retries exactly the selected scoped operation without changing body or ID", async () => {
  const { api, outbox, injector } = setup();
  const body = { clientId: "own-id", amount: 5000, enrollmentId: "enrollment" };
  await database.outbox.bulkAdd([
    {
      id: "own-id",
      scope: "school-a:user-a",
      kind: "payment",
      body,
      state: "blocked",
      attempts: 1,
      nextAt: 0,
      createdAt: 0,
      error: "EXCEEDS_BALANCE",
    },
    {
      id: "foreign-id",
      scope: "school-b:user-a",
      kind: "payment",
      body: { ...body, clientId: "foreign-id" },
      state: "blocked",
      attempts: 0,
      nextAt: 0,
      createdAt: 0,
    },
  ]);
  await expect(outbox.retry("foreign-id")).rejects.toThrow("AUTH_CHANGED");
  expect(api.tenant).not.toHaveBeenCalled();
  api.tenant.mockRejectedValueOnce(
    new RequestError(409, "IDEMPOTENCY_CONFLICT"),
  );
  await outbox.retry("own-id");
  expect(api.tenant).toHaveBeenCalledExactlyOnceWith(
    "admin/payments",
    "POST",
    body,
  );
  expect((await database.outbox.get("own-id"))?.body).toEqual(body);
  expect((await database.outbox.get("own-id"))?.state).toBe("blocked");
  expect((await database.outbox.get("foreign-id"))?.attempts).toBe(0);
  injector.destroy();
});
it("records authentication failure without deleting the pending evidence", async () => {
  const { api, outbox, injector } = setup();
  await outbox.enqueue("quiz", { quizId: "q", answers: {} }, "attempt-id");
  api.tenant.mockRejectedValueOnce(new RequestError(401, "AUTH_REQUIRED"));
  await outbox.flush();
  const row = await database.outbox.get("attempt-id");
  expect(row?.error).toBe("AUTH_REQUIRED");
  expect(row?.state).toBe("pending");
  expect(row?.attempts).toBe(1);
  expect(syncError(row?.error)).toContain("Reconnectez-vous");
  injector.destroy();
});
it("allows successive payments on the same enrollment once the previous payment flushes", async () => {
  const { api, outbox, injector } = setup();
  api.tenant.mockResolvedValue({ payment: { id: "p1", amount: 25000 } });
  await outbox.enqueuePayment("enr-1", { enrollmentId: "enr-1", amount: 25000, method: "cash" }, "id-1");
  await outbox.flush();
  // Even without manually clearing payment-operation, a subsequent payment succeeds once outbox is empty.
  api.tenant.mockResolvedValue({ payment: { id: "p2", amount: 25000 } });
  await outbox.enqueuePayment("enr-1", { enrollmentId: "enr-1", amount: 25000, method: "cash" }, "id-2");
  await outbox.flush();
  expect(api.tenant).toHaveBeenCalledTimes(2);
  const rec = await outbox.recoverPayment("enr-1");
  expect(rec?.id).toBe("id-2");
  expect(rec?.payment?.amount).toBe(25000);
  injector.destroy();
});
it("preserves uncertain payment recovery and discards blocked or orphaned locks", async () => {
  const { outbox, injector } = setup();
  await database.snapshots.put({
    key: "school-a:user-a:payment-operation:enr-2",
    scope: "school-a:user-a",
    data: { id: "ghost-id", enrollmentId: "enr-2", body: {} },
    updatedAt: Date.now(),
  });
  const orphan = await outbox.recoverPayment("enr-2");
  expect(orphan?.id).toBe("ghost-id");
  expect(orphan?.queued).toBeNull();
  expect(orphan?.payment).toBeNull();
  await outbox.discardBlockedPayment("enr-2", "ghost-id");
  expect(await outbox.recoverPayment("enr-2")).toBeNull();

  await database.outbox.add({
    id: "blk-1",
    scope: "school-a:user-a",
    kind: "payment",
    body: { enrollmentId: "enr-3", amount: 999999, clientId: "blk-1" },
    state: "blocked",
    attempts: 1,
    nextAt: 0,
    createdAt: 0,
    error: "EXCEEDS_BALANCE",
  });
  await database.snapshots.put({
    key: "school-a:user-a:payment-operation:enr-3",
    scope: "school-a:user-a",
    data: { id: "blk-1", enrollmentId: "enr-3", body: {} },
    updatedAt: Date.now(),
  });
  await outbox.discardBlockedPayment("enr-3", "blk-1");
  expect(await database.outbox.get("blk-1")).toBeUndefined();
  expect(await database.snapshots.get("school-a:user-a:payment-operation:enr-3")).toBeUndefined();
  injector.destroy();
});
