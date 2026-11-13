import "@angular/compiler";
import "fake-indexeddb/auto";
import { createEnvironmentInjector, runInInjectionContext, signal } from "@angular/core";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiService, RequestError } from "../src/app/core/api.service";
import { AuthService } from "../src/app/core/auth.service";
import { DataService } from "../src/app/core/data.service";
import { database } from "../src/app/core/database";

beforeEach(async () => {
  Object.assign(globalThis, { window: new EventTarget() });
  await database.snapshots.clear();
  await database.snapshots.put({ key: "school:user:dashboard", scope: "school:user", data: { students: 2 }, updatedAt: Date.now() });
});
function setup(allowed = true) {
  const auth = { scope: "school:user", offlineAllowed: vi.fn().mockResolvedValue(allowed) };
  const injector = createEnvironmentInjector([
    { provide: AuthService, useValue: auth },
    { provide: ApiService, useValue: { online: signal(true) } },
  ], null as never);
  return { auth, injector, store: runInInjectionContext(injector, () => new DataService()) };
}

it("renders a verified account's saved data while a fresh request is pending", async () => {
  const { store, injector } = setup();
  let resolve!: (value: { students: number }) => void;
  const pending = new Promise<{ students: number }>((done) => { resolve = done; });
  const preview = vi.fn();
  const read = store.read("dashboard", () => pending, preview);
  await vi.waitFor(() => expect(preview).toHaveBeenCalledWith({ students: 2 }));
  resolve({ students: 3 });
  expect(await read).toEqual({ students: 3 });
  expect((await database.snapshots.get("school:user:dashboard"))?.data).toEqual({ students: 3 });
  injector.destroy();
});

it("never previews cached data without a valid offline token", async () => {
  const { store, injector } = setup(false);
  const preview = vi.fn();
  expect(await store.read("dashboard", async () => ({ students: 4 }), preview)).toEqual({ students: 4 });
  expect(preview).not.toHaveBeenCalled();
  injector.destroy();
});

it("clears the preview and removes the snapshot after access is denied", async () => {
  const { store, injector } = setup();
  const preview = vi.fn();
  await expect(store.read("dashboard", async () => { throw new RequestError(403, "MEMBERSHIP_REQUIRED"); }, preview)).rejects.toThrow("MEMBERSHIP_REQUIRED");
  expect(preview.mock.calls).toEqual([[{ students: 2 }], [null]]);
  expect(await database.snapshots.get("school:user:dashboard")).toBeUndefined();
  injector.destroy();
});

it("does not show another account's data when identity changes during revalidation", async () => {
  const { auth, store, injector } = setup();
  let resolve!: (value: { students: number }) => void;
  const pending = new Promise<{ students: number }>((done) => { resolve = done; });
  const preview = vi.fn();
  const read = store.read("dashboard", () => pending, preview);
  await vi.waitFor(() => expect(preview).toHaveBeenCalledWith({ students: 2 }));
  auth.scope = "school:other";
  resolve({ students: 999 });
  expect(await read).toBeNull();
  expect(preview).toHaveBeenLastCalledWith(null);
  injector.destroy();
});
