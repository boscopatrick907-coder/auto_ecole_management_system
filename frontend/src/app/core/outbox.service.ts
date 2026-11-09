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
    if (!this.auth.scope) throw new Error("AUTH_REQUIRED");
    await database.outbox.put({
      id,
      scope: this.auth.scope,
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
      if (navigator.locks)
        await navigator.locks.request(
          "school-outbox:" + scope,
          { ifAvailable: true },
          async (lock) => {
            if (lock) await run();
          },
        );
      else await run();
    } finally {
      this.syncing.set(false);
      await this.refresh();
    }
  }
  async retryBlocked() {
    await database.outbox
      .where("scope")
      .equals(this.auth.scope)
      .modify({ state: "pending", nextAt: 0 });
    await this.flush();
  }
}
