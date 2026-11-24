import "@angular/compiler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvironmentInjector, runInInjectionContext } from "@angular/core";
import { ApiService } from "../src/app/core/api.service";
import {
  FIRED_STORAGE_KEY,
  NotificationsService,
  calendarDaysUntil,
  computePaymentReminders,
  exactMilestone,
  formatDoualaYmd,
} from "../src/app/core/notifications.service";
import type { Installment } from "../src/app/core/models";

const inst = (id: string, due: string, status: Installment["status"] = "upcoming", amount = 10000, paid = 0): Installment => ({
  id, position: 1, label: "Tranche " + id, amount, due_date: due, status, paid_amount: paid,
});

describe("formatDoualaYmd", () => {
  it("uses UTC+1 so late-evening UTC is already the next day in Douala", () => {
    expect(formatDoualaYmd(new Date("2026-03-10T22:59:00Z"))).toBe("2026-03-10");
    expect(formatDoualaYmd(new Date("2026-03-10T23:00:00Z"))).toBe("2026-03-11");
  });
});

describe("calendarDaysUntil", () => {
  const now = new Date("2026-03-10T08:00:00Z");
  it("counts whole calendar days", () => {
    expect(calendarDaysUntil("2026-03-17", now)).toBe(7);
    expect(calendarDaysUntil("2026-03-10", now)).toBe(0);
    expect(calendarDaysUntil("2026-03-09", now)).toBe(-1);
  });
  it("crosses month boundaries", () => {
    expect(calendarDaysUntil("2026-04-01", new Date("2026-03-29T12:00:00Z"))).toBe(3);
  });
  it("returns NaN for invalid input", () => {
    expect(calendarDaysUntil("", now)).toBeNaN();
  });
});

describe("exactMilestone", () => {
  it("maps J-7, J-3, J-1, today and overdue", () => {
    expect(exactMilestone(7)).toBe(7);
    expect(exactMilestone(3)).toBe(3);
    expect(exactMilestone(1)).toBe(1);
    expect(exactMilestone(0)).toBe(0);
    expect(exactMilestone(-4)).toBe(-1);
    expect(exactMilestone(5)).toBeNull();
    expect(exactMilestone(Number.NaN)).toBeNull();
  });
});

describe("computePaymentReminders", () => {
  const now = new Date("2026-03-10T08:00:00Z");
  it("keeps unpaid installments within 7 days or overdue, most urgent first", () => {
    const r = computePaymentReminders([
      inst("a", "2026-03-17"),
      inst("b", "2026-03-20"),
      inst("c", "2026-03-05", "overdue"),
      inst("d", "2026-03-11", "paid"),
      inst("e", "2026-03-11", "partial", 10000, 4000),
    ], now);
    expect(r.map((x) => x.installmentId)).toEqual(["c", "e", "a"]);
    expect(r[0]).toMatchObject({ milestone: -1, urgent: true });
    expect(r[1]).toMatchObject({ milestone: 1, amount: 6000, urgent: true });
    expect(r[2]).toMatchObject({ milestone: 7, urgent: false });
  });
  it("tolerates empty input", () => {
    expect(computePaymentReminders(undefined, now)).toEqual([]);
  });
});

describe("NotificationsService.fireLocalRemindersIfGranted", () => {
  let shown: string[];
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map<string, string>();
    const fakeLocalStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    };
    vi.stubGlobal("localStorage", fakeLocalStorage);
    shown = [];
    class FakeNotification {
      static permission = "granted";
      constructor(title: string, opts: NotificationOptions) { shown.push(String(opts.tag)); void title; }
    }
    vi.stubGlobal("Notification", FakeNotification);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fires once per (student, installment, milestone)", async () => {
    const injector = createEnvironmentInjector([{ provide: ApiService, useValue: {} }], null as never);
    const svc = runInInjectionContext(injector, () => new NotificationsService());
    const reminders = computePaymentReminders(
      [inst("a", "2026-03-17"), inst("b", "2026-03-15")],
      new Date("2026-03-10T08:00:00Z"),
    );
    expect(await svc.fireLocalRemindersIfGranted("s1", reminders, "ecole")).toBe(1);
    expect(await svc.fireLocalRemindersIfGranted("s1", reminders, "ecole")).toBe(0);
    expect(await svc.fireLocalRemindersIfGranted("s2", reminders, "ecole")).toBe(1);
    expect(shown).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(FIRED_STORAGE_KEY)!)).toHaveLength(2);
    injector.destroy();
  });

  it("does nothing without permission", async () => {
    (Notification as unknown as { permission: string }).permission = "default";
    const injector = createEnvironmentInjector([{ provide: ApiService, useValue: {} }], null as never);
    const svc = runInInjectionContext(injector, () => new NotificationsService());
    const reminders = computePaymentReminders([inst("a", "2026-03-11")], new Date("2026-03-10T08:00:00Z"));
    expect(await svc.fireLocalRemindersIfGranted("s1", reminders, "ecole")).toBe(0);
    expect(shown).toHaveLength(0);
    injector.destroy();
  });
});
