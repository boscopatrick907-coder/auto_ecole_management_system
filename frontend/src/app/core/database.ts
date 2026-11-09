import Dexie, { type Table } from "dexie";
export interface Snapshot {
  key: string;
  scope: string;
  data: unknown;
  updatedAt: number;
}
export interface QueueAction {
  id: string;
  scope: string;
  kind: "payment" | "quiz";
  body: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  nextAt: number;
  state: "pending" | "blocked";
  error?: string;
  result?: unknown;
}
export interface OfflineFile {
  key: string;
  scope: string;
  blob: Blob;
}
export class OfflineDatabase extends Dexie {
  snapshots!: Table<Snapshot, string>;
  outbox!: Table<QueueAction, string>;
  files!: Table<OfflineFile, string>;
  constructor(name = "school-pwa-v2") {
    super(name);
    this.version(1).stores({
      snapshots: "key,scope",
      outbox: "id,scope,state,nextAt",
      files: "key,scope",
    });
  }
}
export const database = new OfflineDatabase();
export function accountScope(school: string, user: string): string {
  return `${school}:${user}`;
}

/** Counter and device identity survive account logout together; database eviction rotates both. */
export async function nextOfflineReceipt(schoolId: string): Promise<string> {
  return database.transaction("rw", database.snapshots, async () => {
    const key = "receipt-device:" + schoolId;
    const old = (await database.snapshots.get(key))?.data as
      { device: string; seq: number } | undefined;
    const device =
      old?.device ||
      crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    const seq = (old?.seq || 0) + 1;
    await database.snapshots.put({
      key,
      scope: "device-receipts",
      data: { device, seq },
      updatedAt: Date.now(),
    });
    return `RC-${device}-${String(seq).padStart(6, "0")}`;
  });
}
