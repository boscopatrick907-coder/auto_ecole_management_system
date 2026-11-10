import { Injectable, inject, signal } from "@angular/core";
import { ApiService, RequestError } from "./api.service";
import { AuthService } from "./auth.service";
import { database } from "./database";

@Injectable({ providedIn: "root" })
export class DataService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly revision = signal(0);

  constructor() {
    window.addEventListener("school:sync", () =>
      this.revision.update((x) => x + 1),
    );
  }

  async read<T>(
    key: string,
    load: () => Promise<T>,
    onCached?: (value: T) => void,
  ): Promise<T | null> {
    const scope = this.auth.scope;

    if (!scope) throw new Error("AUTH_REQUIRED");

    const cached = await database.snapshots.get(scope + ":" + key);

    if (this.auth.scope !== scope) return null;

    if (this.api.online()) {
      try {
        const data = await load();

        if (this.auth.scope !== scope) return null;

        await database.snapshots.put({
          key: scope + ":" + key,
          scope,
          data,
          updatedAt: Date.now(),
        });

        return data;
      } catch (e) {
        // Never use cached data after an authorization
        // or other client error from the server.
        if (e instanceof RequestError && e.status >= 400 && e.status < 500) {
          throw e;
        }

        // Only use cached data after a network/server failure.
        if (!cached) throw e;

        // Cached protected data requires a valid offline lease.
        if (!(await this.auth.offlineAllowed())) {
          throw new Error("ACCESS_EXPIRED");
        }

        // Ensure the authenticated account has not changed.
        if (this.auth.scope !== scope) return null;

        onCached?.(cached.data as T);
        return cached.data as T;
      }
    }

    // Offline access requires a valid signed lease.
    if (!(await this.auth.offlineAllowed())) {
      throw new Error("ACCESS_EXPIRED");
    }

    if (this.auth.scope !== scope) return null;

    if (cached) {
      onCached?.(cached.data as T);
      return cached.data as T;
    }

    return null;
  }

  async file(id: string, download = false): Promise<string> {
    if (this.api.online()) await this.auth.refreshLease();

    if (!(await this.auth.offlineAllowed())) {
      throw new Error("ACCESS_EXPIRED");
    }

    const scope = this.auth.scope;
    if (!scope) throw new Error("AUTH_REQUIRED");

    const key = scope + ":" + id;
    const cached = await database.files.get(key);

    if (cached) return URL.createObjectURL(cached.blob);

    if (!this.api.online()) {
      throw new Error("OFFLINE_FILE_UNAVAILABLE");
    }

    const { url } = await this.api.tenant<{ url: string }>(
      "resources/" + encodeURIComponent(id) + "/url",
    );

    const r = await fetch(url);

    if (!r.ok) throw new Error("DOWNLOAD_FAILED");

    const blob = await r.blob();

    if (download && this.auth.scope === scope) {
      await database.files.put({ key, scope, blob });
    }

    return URL.createObjectURL(blob);
  }

  async saved(id: string) {
    const scope = this.auth.scope;
    if (!scope) return false;

    return !!(await database.files.get(scope + ":" + id));
  }

  async remove(id: string) {
    const scope = this.auth.scope;
    if (!scope) return;

    await database.files.delete(scope + ":" + id);
  }
}
