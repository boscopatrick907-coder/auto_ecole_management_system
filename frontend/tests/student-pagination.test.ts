import "@angular/compiler";
import { it, expect, vi } from "vitest";
import {
  createEnvironmentInjector,
  runInInjectionContext,
} from "@angular/core";
import { ApiService } from "../src/app/core/api.service";
import { DataService } from "../src/app/core/data.service";
import { StudentListComponent } from "../src/app/pages/students";
const row = (id: string) => ({
  id,
  full_name: id,
  student_number: 1,
  phone: "+237699123456",
  balance: 100,
  group_name: "B",
});
const page = (ids: string[], hasMore = false, nextOffset = ids.length) => ({
  students: ids.map(row),
  count: 201,
  hasMore,
  nextOffset,
});
function setup(api: { students: ReturnType<typeof vi.fn> }) {
  const injector = createEnvironmentInjector(
    [
      {
        provide: ApiService,
        useValue: { slug: "school", expectedUserId: "user", ...api },
      },
      {
        provide: DataService,
        useValue: { read: (_key: string, load: () => unknown) => load() },
      },
    ],
    null as never,
  );
  return {
    component: runInInjectionContext(
      injector,
      () => new StudentListComponent(),
    ),
    injector,
  };
}
it("loads subsequent pages and retains the submitted search independently of edited text", async () => {
  const api = {
    students: vi
      .fn()
      .mockResolvedValueOnce(page(["student-1"], true, 200))
      .mockResolvedValueOnce(page(["student-201"], false, 201)),
  };
  const { component: c, injector } = setup(api);
  c.query = "Alice";
  await c.load();
  c.query = "Not yet submitted";
  await c.load(false);
  expect(api.students).toHaveBeenLastCalledWith("Alice", 200);
  expect(c.students().map((x) => x.id)).toEqual(["student-1", "student-201"]);
  expect(c.hasMore()).toBe(false);
  injector.destroy();
});
it("ignores delayed results from an earlier search", async () => {
  let resolve!: (value: unknown) => void;
  const api = {
    students: vi
      .fn()
      .mockReturnValueOnce(
        new Promise((r) => {
          resolve = r;
        }),
      )
      .mockResolvedValueOnce(page(["new-result"])),
  };
  const { component: c, injector } = setup(api);
  c.query = "old";
  const old = c.load();
  c.query = "new";
  await c.load();
  resolve(page(["stale"]));
  await old;
  expect(c.students().map((x) => x.id)).toEqual(["new-result"]);
  expect(c.loading()).toBe(false);
  injector.destroy();
});
