import { Injectable, inject, signal } from "@angular/core";
import { SwPush } from "@angular/service-worker";
import { ApiService } from "./api.service";
import { FR } from "./fr";
import type { Installment, PaymentReminder, ReminderMilestone } from "./models";

const DAY = 86_400_000;
/** Africa/Douala is UTC+1 all year (no daylight saving). */
const DOUALA_OFFSET_MS = 60 * 60 * 1000;
export const REMINDER_WINDOW_DAYS = 7;
export const FIRED_STORAGE_KEY = "aem-payment-reminders-fired";

/** Calendar date (YYYY-MM-DD) in Douala for the given instant. */
export function formatDoualaYmd(now: Date): string {
  return new Date(now.getTime() + DOUALA_OFFSET_MS).toISOString().slice(0, 10);
}

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** Whole calendar days between today (Douala) and the due date. Negative when overdue. */
export function calendarDaysUntil(dueDateIso: string, now: Date = new Date()): number {
  if (!dueDateIso || !/^\d{4}-\d{2}-\d{2}/.test(dueDateIso)) return Number.NaN;
  const due = dueDateIso.length > 10 && dueDateIso.includes("T")
    ? formatDoualaYmd(new Date(dueDateIso))
    : dueDateIso.slice(0, 10);
  return Math.round((ymdToUtc(due) - ymdToUtc(formatDoualaYmd(now))) / DAY);
}

/** 7/3/1 → J-7/J-3/J-1, 0 → today, negative → overdue (-1), anything else → null. */
export function exactMilestone(daysRemaining: number): ReminderMilestone | null {
  if (!Number.isFinite(daysRemaining)) return null;
  if (daysRemaining < 0) return -1;
  if (daysRemaining === 0 || daysRemaining === 1 || daysRemaining === 3 || daysRemaining === 7)
    return daysRemaining as ReminderMilestone;
  return null;
}

/** Reminders for every unpaid installment due within 7 days or already overdue, most urgent first. */
export function computePaymentReminders(
  installments: Installment[] | null | undefined,
  now: Date = new Date(),
): PaymentReminder[] {
  return (installments || [])
    .filter((i) => i && i.status !== "paid")
    .map((i) => {
      const daysRemaining = calendarDaysUntil(i.due_date, now);
      const amount = Math.max(0, (i.amount || 0) - (i.paid_amount || 0));
      return {
        installmentId: i.id,
        label: i.label,
        amount,
        dueDate: i.due_date,
        daysRemaining,
        milestone: exactMilestone(daysRemaining),
        urgent: daysRemaining <= 1,
      } satisfies PaymentReminder;
    })
    .filter((r) => Number.isFinite(r.daysRemaining) && r.daysRemaining <= REMINDER_WINDOW_DAYS && r.amount > 0)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export function reminderText(r: PaymentReminder): string {
  if (r.daysRemaining < 0) return `${FR.reminderOverdue} : ${r.label}`;
  if (r.daysRemaining === 0) return `${FR.reminderToday} : ${r.label}`;
  return `${FR.reminderInDays} ${r.daysRemaining} ${r.daysRemaining > 1 ? FR.reminderDays : FR.reminderDay} : ${r.label}`;
}

type Perm = NotificationPermission | "unsupported";

function urlBase64ToUint8(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function bufToBase64Url(buf: ArrayBuffer | null) {
  if (!buf) return "";
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

@Injectable({ providedIn: "root" })
export class NotificationsService {
  private api = inject(ApiService);
  private swPush = inject(SwPush, { optional: true });
  readonly pushSupported = signal(
    typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator,
  );
  readonly permission = signal<Perm>(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );
  readonly subscribed = signal(false);
  readonly busy = signal(false);
  readonly message = signal("");

  private get pushEnabled() {
    return !!this.swPush?.isEnabled;
  }

  private toPayload(sub: PushSubscription) {
    const json = sub.toJSON?.() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
    return {
      endpoint: json?.endpoint || sub.endpoint,
      keys: {
        p256dh: json?.keys?.p256dh || bufToBase64Url(sub.getKey?.("p256dh") ?? null),
        auth: json?.keys?.auth || bufToBase64Url(sub.getKey?.("auth") ?? null),
      },
    };
  }

  private async currentSubscription(): Promise<PushSubscription | null> {
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      return (await reg?.pushManager?.getSubscription()) ?? null;
    } catch {
      return null;
    }
  }

  private async subscribe(): Promise<PushSubscription | null> {
    const existing = await this.currentSubscription();
    if (existing) return existing;
    const { vapidPublicKey } = await this.api.config();
    if (!vapidPublicKey) return null;
    if (this.pushEnabled) return this.swPush!.requestSubscription({ serverPublicKey: vapidPublicKey });
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (!reg?.pushManager) return null;
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8(vapidPublicKey) });
  }

  async enablePush(slug: string) {
    if (this.busy()) return;
    this.message.set("");
    if (!this.pushSupported()) {
      this.message.set(FR.pushUnsupported);
      return;
    }
    this.busy.set(true);
    try {
      const perm = await Notification.requestPermission();
      this.permission.set(perm);
      if (perm !== "granted") {
        this.message.set(FR.pushDenied);
        return;
      }
      const sub = await this.subscribe();
      if (sub) await this.api.savePushSubscription(slug, this.toPayload(sub));
      // Without a push subscription the in-app/local reminders still work.
      this.subscribed.set(true);
      this.message.set(FR.pushEnabled);
    } catch {
      this.message.set(FR.pushError);
    } finally {
      this.busy.set(false);
    }
  }

  async disablePush(slug: string) {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set("");
    try {
      const sub = await this.currentSubscription();
      if (sub) {
        await this.api.deletePushSubscription(slug, sub.endpoint).catch(() => {});
        if (this.pushEnabled) await this.swPush!.unsubscribe().catch(() => {});
        else await sub.unsubscribe().catch(() => false);
      }
      this.subscribed.set(false);
      this.message.set(FR.pushDisabled);
    } catch {
      this.message.set(FR.pushError);
    } finally {
      this.busy.set(false);
    }
  }

  /** Re-registers an existing subscription silently when permission is already granted. */
  async syncIfGranted(slug: string) {
    if (!this.pushSupported()) return;
    this.permission.set(Notification.permission);
    if (Notification.permission !== "granted") return;
    try {
      const sub = await this.currentSubscription();
      this.subscribed.set(!!sub);
      if (sub) await this.api.savePushSubscription(slug, this.toPayload(sub));
    } catch {
      /* best-effort */
    }
  }

  private fired(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(FIRED_STORAGE_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  /** Shows one local notification per (student, installment, milestone); returns how many were shown. */
  async fireLocalRemindersIfGranted(studentId: string, reminders: PaymentReminder[], slug: string) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return 0;
    const fired = this.fired();
    let count = 0;
    for (const r of reminders) {
      if (r.milestone === null) continue;
      const key = `${slug}:${studentId}:${r.installmentId}:${r.milestone}`;
      if (fired.includes(key)) continue;
      try {
        const options: NotificationOptions = { body: reminderText(r), tag: key, icon: "/icons/icon-192x192.png" };
        const reg = await navigator.serviceWorker?.getRegistration?.();
        if (reg?.showNotification) await reg.showNotification(FR.reminderTitle, options);
        else new Notification(FR.reminderTitle, options);
        fired.push(key);
        count++;
      } catch {
        /* ignore and retry next visit */
      }
    }
    try {
      localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(fired.slice(-200)));
    } catch {
      /* storage full or blocked */
    }
    return count;
  }
}
