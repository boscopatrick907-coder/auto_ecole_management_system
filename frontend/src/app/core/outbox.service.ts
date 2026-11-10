import { Injectable, inject, signal } from "@angular/core";
import { database, type QueueAction } from "./database";
import { ApiService, RequestError } from "./api.service";
import { AuthService } from "./auth.service";

export const retryDelay = (attempts: number) =>
  Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12));

export function shouldBlock(status: number) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

@Injectable({ providedIn: "root" })
export class OutboxService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly count = signal(0);
  readonly blocked = signal(0);
  readonly syncing = signal(false);

  constructor() {
    window.addEventListener("online", () => void this.flush());
    setInterval(() => void this.flush(), 15000);
  }

  async refresh() {
    const items = this.auth.scope
      ? await database.outbox.where("scope").equals(this.auth.scope).toArray()
      : [];

    this.count.set(items.length);
    this.blocked.set(items.filter((x) => x.state === "blocked").length);
  }

  async enqueue(
    kind: QueueAction["kind"],
    body: Record<string, unknown>,
    id: string = crypto.randomUUID(),
  ) {
    const scope = this.auth.scope;
    if (!scope) throw new Error("AUTH_REQUIRED");

    const existing = await database.outbox.get(id);

    if (existing) {
      if (existing.scope !== scope || existing.kind !== kind) {
        throw new Error("OUTBOX_OPERATION_CONFLICT");
      }

      await this.refresh();
      return id;
    }

    await database.outbox.put({
      id,
      scope,
      kind,
      body: { ...body, clientId: id },
      createdAt: Date.now(),
      attempts: 0,
      nextAt: 0,
      state: "pending",
    });

    await this.refresh();
    return id;
  }

  async pendingPayment(enrollmentId: string): Promise<QueueAction | null> {
    const scope = this.auth.scope;
    if (!scope) return null;

    const items = await database.outbox.where("scope").equals(scope).toArray();

    return (
      items
        .filter(
          (item) =>
            item.kind === "payment" &&
            item.body["enrollmentId"] === enrollmentId,
        )
        .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
    );
  }

  async savedResult<T>(id: string): Promise<T | null> {
    const scope = this.auth.scope;
    if (!scope) return null;

    const row = await database.snapshots.get(scope + ":result:" + id);

    if (row?.scope !== scope) return null;

    return (row.data as T | undefined) ?? null;
  }

  async rememberPayment(
    enrollmentId: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    const scope = this.auth.scope;
    if (!scope) throw new Error("AUTH_REQUIRED");

    await database.snapshots.put({
      key: scope + ":payment-operation:" + enrollmentId,
      scope,
      data: {
        id,
        enrollmentId,
        body,
        createdAt: Date.now(),
      },
      updatedAt: Date.now(),
    });
  }

  async recoverPayment(enrollmentId: string) {
    const scope = this.auth.scope;
    if (!scope) return null;

    const key = scope + ":payment-operation:" + enrollmentId;
    let row = await database.snapshots.get(key);

    if (row && row.scope !== scope) return null;

    if (!row) {
      const queued = await this.pendingPayment(enrollmentId);

      if (!queued) return null;

      await this.rememberPayment(enrollmentId, queued.id, queued.body);
      row = await database.snapshots.get(key);
    }

    if (!row) return null;

    const reference = row.data as {
      id: string;
      enrollmentId: string;
      body: Record<string, unknown>;
    };

    const queuedItem = await database.outbox.get(reference.id);
    const queued =
      queuedItem?.scope === scope && queuedItem.kind === "payment"
        ? queuedItem
        : null;

    const result = await this.savedResult<{
      payment?: import("./models").Payment;
    }>(reference.id);

    return {
      id: reference.id,
      body: reference.body,
      queued,
      payment: result?.payment ?? null,
    };
  }

  // Remove the active reference only for the specified operation.
  // This does not delete the saved server result or queued operation.
  async clearPaymentReference(enrollmentId: string, id: string) {
    const scope = this.auth.scope;
    if (!scope) throw new Error("AUTH_REQUIRED");

    const key = scope + ":payment-operation:" + enrollmentId;
    const row = await database.snapshots.get(key);

    if (!row || row.scope !== scope) return;

    const reference = row.data as { id?: string };

    if (reference.id === id) {
      await database.snapshots.delete(key);
    }
  }

  async flush() {
    if (this.syncing() || !this.api.online() || !this.auth.scope) return;

    this.syncing.set(true);
    const scope = this.auth.scope;

    const run = async () => {
      const items = await database.outbox
        .where("scope")
        .equals(scope)
        .toArray();

      for (const item of items) {
        if (this.auth.scope !== scope || !this.api.online()) break;
        if (item.state === "blocked" || item.nextAt > Date.now()) continue;

        try {
          const result = await this.api.tenant(
            item.kind === "payment" ? "admin/payments" : "quiz-attempts",
            "POST",
            item.body,
          );

          if (this.auth.scope !== scope) break;

          await database.transaction(
            "rw",
            database.snapshots,
            database.outbox,
            async () => {
              await database.snapshots.put({
                key: scope + ":result:" + item.id,
                scope,
                data: result,
                updatedAt: Date.now(),
              });

              await database.outbox.delete(item.id);
            },
          );

          window.dispatchEvent(new CustomEvent("school:sync"));
        } catch (e) {
          const status = e instanceof RequestError ? e.status : 0;

          if (status === 401) break;

          await database.outbox.update(item.id, {
            attempts: item.attempts + 1,
            nextAt: Date.now() + retryDelay(item.attempts + 1),
            state: shouldBlock(status) ? "blocked" : "pending",
            error: e instanceof Error ? e.message : "NETWORK",
          });
        }
      }
    };

    try {
      if (navigator.locks) {
        await navigator.locks.request(
          "school-outbox:" + scope,
          { ifAvailable: true },
          async (lock) => {
            if (lock) await run();
          },
        );
      } else {
        await run();
      }
    } finally {
      this.syncing.set(false);
      await this.refresh();
    }
  }

  async retryBlocked() {
    const scope = this.auth.scope;
    if (!scope) return;

    await database.outbox
      .where("scope")
      .equals(scope)
      .modify({ state: "pending", nextAt: 0 });

    await this.flush();
  }
}
