import "@angular/compiler";
import "fake-indexeddb/auto";
import { createEnvironmentInjector, runInInjectionContext, signal } from "@angular/core";
import { beforeEach, expect, it, vi } from "vitest";
import { AuthService } from "../src/app/core/auth.service";
import { ApiService, RequestError } from "../src/app/core/api.service";
import { database } from "../src/app/core/database";
import { DataService } from "../src/app/core/data.service";
import { StudentListComponent } from "../src/app/pages/students";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const school = { id: "s", slug: "school", name: "School" };
const user = { id: "u", name: "User", email: "u@example.test" };
const setup = () => {
  const api = {
    online: signal(true), slug: "school", expectedUserId: "",
    catalogue: vi.fn().mockResolvedValue({ school, categories: [], groups: [] }),
    request: vi.fn().mockResolvedValue({ user }),
    tenant: vi.fn().mockImplementation((path) => path === "session"
      ? Promise.resolve({ role: "admin" })
      : Promise.resolve({ token: "token", publicKey: {} })),
  };
  const injector = createEnvironmentInjector([{ provide: ApiService, useValue: api }], null as never);
  const auth = runInInjectionContext(injector, () => new AuthService());
  Object.defineProperty(auth, "applyBrand", { value: () => {} });
  return { api, auth, injector };
};

beforeEach(async () => {
  Object.assign(globalThis, { localStorage: { getItem: () => null, removeItem: () => {} } });
  await database.snapshots.clear();
});

it("starts public catalogue and session together and coalesces repeated school opens", async () => {
  const { api, auth, injector } = setup();
  const catalogue = deferred<unknown>();
  api.catalogue.mockReturnValue(catalogue.promise);
  api.request.mockResolvedValue(null);
  const first = auth.openSchool("school");
  expect(api.request).toHaveBeenCalledWith("/auth/get-session");
  expect(auth.openSchool("school")).toBe(first);
  expect(api.catalogue).toHaveBeenCalledTimes(1);
  catalogue.resolve({ school, categories: [], groups: [] });
  await first;
  expect(auth.ready()).toBe(true);
  expect(auth.error()).toBe("");
  injector.destroy();
});

it("finishes online login without waiting for a lease and keeps identity on lease failure", async () => {
  const { api, auth, injector } = setup();
  const lease = deferred<never>();
  api.tenant.mockImplementation((path) => path === "session"
    ? Promise.resolve({ role: "admin" }) : lease.promise);
  await auth.openSchool("school");
  expect(auth.ready()).toBe(true);
  expect(auth.role()).toBe("admin");
  expect(await auth.offlineAllowed(false)).toBe(false);
  lease.resolve(undefined as never);
  await vi.waitFor(() => expect(auth.leaseError()).toBe(true));
  expect(auth.error()).toBe("");
  expect(auth.user()?.id).toBe("u");
  injector.destroy();
});

it("does not store a late lease under a different account", async () => {
  const { api, auth, injector } = setup();
  auth.school.set(school as never); auth.user.set(user); auth.role.set("admin");
  const lease = deferred<unknown>();
  api.tenant.mockReturnValue(lease.promise);
  const pending = auth.refreshLease();
  expect(auth.refreshLease()).toBe(pending);
  auth.user.set({ ...user, id: "other" });
  lease.resolve({ token: "old-account-token", publicKey: {} });
  await pending;
  expect(await database.snapshots.count()).toBe(0);
  injector.destroy();
});

it("ignores an older school's late response", async () => {
  const { api, auth, injector } = setup();
  const old = deferred<unknown>();
  api.catalogue.mockReturnValueOnce(old.promise);
  api.request.mockResolvedValue(null);
  const previous = auth.openSchool("old");
  await auth.openSchool("school");
  old.resolve({ school: { ...school, id: "old" } });
  await previous;
  expect(auth.school()?.id).toBe("s");
  expect(auth.ready()).toBe(true);
  injector.destroy();
});

it("distinguishes backend failures from an unknown school", async () => {
  const { api, auth, injector } = setup();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  api.catalogue.mockRejectedValueOnce(new RequestError(503, "REQUEST_FAILED"));
  await auth.openSchool("school");
  expect(auth.error()).toBe("loadFailed");
  api.catalogue.mockRejectedValueOnce(new RequestError(404, "SCHOOL_NOT_FOUND"));
  await auth.openSchool("missing");
  expect(auth.error()).toBe("noSchool");
  log.mockRestore(); injector.destroy();
});

it("keeps the newest student search when an older response arrives last", async () => {
  const old = deferred<unknown>(), recent = deferred<unknown>();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
  const injector = createEnvironmentInjector([
    { provide: ApiService, useValue: {} },
    { provide: DataService, useValue: { read } },
  ], null as never);
  const list = runInInjectionContext(injector, () => new StudentListComponent());
  list.query = "older";
  const first = list.load();
  list.query = "newer";
  const second = list.load();
  recent.resolve({ students: [{ id: "newer" }] });
  await second;
  old.resolve({ students: [] });
  await first;
  expect(list.students().map((student) => student.id)).toEqual(["newer"]);
  injector.destroy();
});
