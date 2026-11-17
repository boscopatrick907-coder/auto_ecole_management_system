import { Injectable, inject, signal } from "@angular/core";
import {
  ApiService,
  RequestError,
  authorizationDenial,
  type TenantRequestContext,
} from "./api.service";
import { AuthService } from "./auth.service";
import { database } from "./database";

interface ScopedAccountContext {
  scope: string;
  userId: string;
  request: TenantRequestContext;
}

@Injectable({ providedIn: "root" })
export class DataService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly revision = signal(0);

  constructor() {
    this.api.setAuthorizationErrorHandler((error, path, context) =>
      this.handleApiDenial(error, path, context),
    );
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
        if (e instanceof RequestError && (e.status === 401 || e.status === 403)) {
          await this.invalidateDeniedData(e, key, scope);
        }

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
    const context = this.captureAccountContext();
    const { scope, request } = context;

    if (this.api.online()) {
      try {
        await this.auth.refreshLease();
      } catch (e) {
        if (e instanceof RequestError && (e.status === 401 || e.status === 403)) {
          await this.invalidateDeniedData(
            e,
            "resource-file:" + id,
            scope,
            id,
            request,
          );
        }
        if (!this.isCurrentAccountContext(context) && this.auth.scope) {
          throw new Error("AUTH_CHANGED");
        }
        throw e;
      }
      this.assertCurrentAccountContext(context);
    }

    let allowed: boolean;
    try {
      allowed = await this.auth.offlineAllowed();
    } catch (e) {
      this.assertCurrentAccountContext(context);
      throw e;
    }
    this.assertCurrentAccountContext(context);

    if (!allowed) {
      throw new Error("ACCESS_EXPIRED");
    }

    const key = scope + ":" + id;
    const cached = await database.files.get(key);
    this.assertCurrentAccountContext(context);

    if (cached) return URL.createObjectURL(cached.blob);

    if (!this.api.online()) {
      throw new Error("OFFLINE_FILE_UNAVAILABLE");
    }

    let url: string;
    try {
      ({ url } = await this.api.tenant<{ url: string }>(
        "resources/" + encodeURIComponent(id) + "/url",
      ));
    } catch (e) {
      if (e instanceof RequestError && (e.status === 401 || e.status === 403)) {
        await this.invalidateDeniedData(
          e,
          "resource-file:" + id,
          scope,
          id,
          request,
        );
      }
      if (!this.isCurrentAccountContext(context) && this.auth.scope) {
        throw new Error("AUTH_CHANGED");
      }
      throw e;
    }
    this.assertCurrentAccountContext(context);

    const r = await fetch(url);
    this.assertCurrentAccountContext(context);

    if (!r.ok) throw new Error("DOWNLOAD_FAILED");

    const blob = await r.blob();
    this.assertCurrentAccountContext(context);

    if (download) {
      await database.files.put({ key, scope, blob });
      this.assertCurrentAccountContext(context);
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

  private async invalidateDeniedData(
    error: RequestError,
    key: string,
    scope: string,
    fileId?: string,
    request?: TenantRequestContext,
  ) {
    const isCurrent = () =>
      this.auth.scope === scope &&
      (!request || this.isCurrentTenantRequest(request));

    if (!isCurrent()) return;

    if (authorizationDenial(error) === "identity") {
      const slug = request?.schoolSlug ?? this.api.slug;
      await this.auth.invalidateAccountData(scope, slug, true);
      return;
    }

    const keys = new Set([scope + ":" + key]);
    if (error.code === "ACCESS_EXPIRED") {
      keys.add(scope + ":resources");
      keys.add(scope + ":quizzes");
    } else if (error.code === "RESOURCE_FORBIDDEN") {
      keys.add(scope + ":resources");
    } else if (error.code === "QUIZ_FORBIDDEN") {
      keys.add(scope + ":quizzes");
    }

    const clearFiles =
      error.code === "ACCESS_EXPIRED" ||
      error.code === "RESOURCE_FORBIDDEN";

    await database.transaction(
      "rw",
      database.snapshots,
      database.files,
      async () => {
        if (!isCurrent()) return;

        await database.snapshots.bulkDelete([...keys]);

        if (!isCurrent()) return;
        if (fileId) await database.files.delete(scope + ":" + fileId);
        if (clearFiles && isCurrent()) {
          await database.files.where("scope").equals(scope).delete();
        }
      },
    );
  }

  private handleApiDenial(
    error: RequestError,
    path: string,
    request: TenantRequestContext,
  ) {
    if (!this.isCurrentTenantRequest(request)) return Promise.resolve();

    const scope = this.auth.scope;
    if (!scope) return Promise.resolve();

    const url = new URL(path, "https://school.invalid");
    const tenantPath = url.pathname.replace(/^\/schools\/[^/]+\/?/, "");
    const segments = tenantPath.split("/").filter(Boolean);
    let key = "api:" + tenantPath;
    let fileId: string | undefined;

    if (tenantPath === "admin/dashboard") {
      key = "dashboard";
    } else if (
      tenantPath === "admin/groups" ||
      tenantPath.startsWith("admin/groups/")
    ) {
      key = "groups";
    } else if (tenantPath === "admin/students") {
      const search = url.searchParams.get("search") || "";
      const offset = Number(url.searchParams.get("offset") || 0);
      key =
        offset > 0
          ? `students:${search}:offset:${offset}`
          : `students:${search}`;
    } else if (segments[0] === "admin" && segments[1] === "students") {
      key = "dossier:" + (segments[2] || "");
    } else if (tenantPath === "me") {
      key = "me";
    } else if (tenantPath === "resources") {
      key = "resources";
    } else if (tenantPath === "quizzes") {
      key = "quizzes";
    } else if (
      segments[0] === "resources" &&
      segments[2] === "url" &&
      segments[1]
    ) {
      fileId = segments[1];
      key = "resource-file:" + fileId;
    }

    return this.invalidateDeniedData(error, key, scope, fileId, request);
  }

  private isCurrentTenantRequest(request: TenantRequestContext) {
    return (
      this.api.slug === request.schoolSlug &&
      this.api.expectedUserId === request.expectedUserId &&
      (this.auth.user()?.id ?? "") === request.expectedUserId
    );
  }

  private captureAccountContext(): ScopedAccountContext {
    const scope = this.auth.scope;
    const userId = this.auth.user()?.id ?? "";

    if (!scope || !userId) throw new Error("AUTH_REQUIRED");

    const context: ScopedAccountContext = {
      scope,
      userId,
      request: {
        schoolSlug: this.api.slug,
        expectedUserId: userId,
      },
    };
    this.assertCurrentAccountContext(context);
    return context;
  }

  private isCurrentAccountContext(context: ScopedAccountContext) {
    return (
      this.auth.scope === context.scope &&
      this.auth.user()?.id === context.userId &&
      this.api.slug === context.request.schoolSlug &&
      this.api.expectedUserId === context.request.expectedUserId
    );
  }

  private assertCurrentAccountContext(context: ScopedAccountContext) {
    if (!this.isCurrentAccountContext(context)) {
      throw new Error("AUTH_CHANGED");
    }
  }
}
