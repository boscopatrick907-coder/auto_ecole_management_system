import { Injectable, signal } from "@angular/core";
import type {
  Catalogue,
  Dossier,
  Group,
  Dashboard,
  Payment,
  Quiz,
  Resource,
} from "./models";
import type { AdminResource, AdminQuiz, MaterialKind } from "./content";
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export interface TenantRequestContext {
  readonly schoolSlug: string;
  readonly expectedUserId: string;
}

const identityDenialCodes = new Set([
  "AUTH_REQUIRED",
  "MEMBERSHIP_REQUIRED",
  "SESSION_IDENTITY_CHANGED",
  "ADMIN_REQUIRED",
  "STUDENT_REQUIRED",
]);

const entitlementDenialCodes = new Set([
  "ACCESS_EXPIRED",
  "RESOURCE_FORBIDDEN",
  "QUIZ_FORBIDDEN",
]);

export function authorizationDenial(
  error: unknown,
): "identity" | "entitlement" | null {
  if (!(error instanceof RequestError)) return null;

  if (error.status === 401 || identityDenialCodes.has(error.code)) {
    return "identity";
  }

  if (error.status === 403 && entitlementDenialCodes.has(error.code)) {
    return "entitlement";
  }

  return null;
}
@Injectable({ providedIn: "root" })
export class ApiService {
  readonly base =
    (globalThis as typeof globalThis & { __SCHOOL_API__?: string })
      .__SCHOOL_API__ || "/api";
  readonly online = signal(navigator.onLine);
  slug = "";
  expectedUserId = "";
  private authorizationErrorHandler?: (
    error: RequestError,
    path: string,
    context: TenantRequestContext,
  ) => Promise<void>;

  setAuthorizationErrorHandler(
    handler: (
      error: RequestError,
      path: string,
      context: TenantRequestContext,
    ) => Promise<void>,
  ) {
    this.authorizationErrorHandler = handler;
  }

  constructor() {
    window.addEventListener("online", () => this.online.set(true));
    window.addEventListener("offline", () => this.online.set(false));
  }
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
    context?: TenantRequestContext,
  ): Promise<T> {
    const requestContext = Object.freeze({
      schoolSlug: context?.schoolSlug ?? this.slug,
      expectedUserId:
        context?.expectedUserId ??
        headers["X-Expected-User"] ??
        this.expectedUserId,
    });
    const maxAttempts = method === "GET" ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 45000);
      try {
        const r = await fetch(this.base + path, {
          method,
          credentials: "include",
          headers: {
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: abort.signal,
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (attempt < maxAttempts && (r.status === 502 || r.status === 503 || r.status === 504)) {
            await new Promise((res) => setTimeout(res, 600));
            continue;
          }
          const error = new RequestError(r.status, data.error || "REQUEST_FAILED");
          const tenantPrefix = `/schools/${encodeURIComponent(requestContext.schoolSlug)}/`;

          if (
            (r.status === 401 || r.status === 403) &&
            path.startsWith(tenantPrefix) &&
            this.isCurrentTenantContext(requestContext) &&
            this.authorizationErrorHandler
          ) {
            try {
              await this.authorizationErrorHandler(error, path, requestContext);
            } catch (invalidationError) {
              console.error("Authorization cache invalidation failed", invalidationError);
            }
          }

          throw error;
        }
        return data as T;
      } catch (e) {
        if (e instanceof RequestError) throw e;
        if (attempt < maxAttempts) {
          await new Promise((res) => setTimeout(res, 600));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("REQUEST_FAILED");
  }
  tenant<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const schoolSlug = this.slug;
    const expectedUserId = this.expectedUserId;
    return this.request<T>(
      `/schools/${encodeURIComponent(schoolSlug)}/${path}`,
      method,
      body,
      expectedUserId ? { "X-Expected-User": expectedUserId } : {},
      Object.freeze({ schoolSlug, expectedUserId }),
    );
  }

  private isCurrentTenantContext(context: TenantRequestContext) {
    return (
      this.slug === context.schoolSlug &&
      this.expectedUserId === context.expectedUserId
    );
  }
  catalogue() {
    return this.tenant<Catalogue>("catalogue");
  }
  me() {
    return this.tenant<Dossier>("me");
  }
  dossier(id: string) {
    return this.tenant<Dossier>("admin/students/" + encodeURIComponent(id));
  }
  dashboard() {
    return this.tenant<Dashboard>("admin/dashboard");
  }
  students(search = "", offset = 0, limit = 50) {
    return this.tenant<{
      students: Array<
        Dossier["student"] & { balance: number; group_name: string }
      >;
      count: number;
      limit: number;
      offset: number;
      hasMore: boolean;
      nextOffset: number;
    }>(
      "admin/students?search=" +
        encodeURIComponent(search) +
        "&limit=" +
        limit +
        "&offset=" +
        offset,
    );
  }
  groups() {
    return this.tenant<{ groups: Group[] }>("admin/groups");
  }
  payments(date: string, offset = 0) {
    return this.tenant<{
      payments: Payment[];
      count: number;
      collected: number;
      hasMore: boolean;
      nextOffset: number;
    }>("admin/payments?date=" + encodeURIComponent(date) + "&offset=" + offset);
  }
  adminResources() {
    return this.tenant<{ resources: AdminResource[] }>("admin/resources");
  }
  adminQuizzes() {
    return this.tenant<{ quizzes: AdminQuiz[] }>("admin/quizzes");
  }
  async uploadMaterial(file: File, _kind: MaterialKind) {
    const slug = this.slug,
      user = this.expectedUserId;
    const name =
      file.name
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(-120) || "material";
    const data = await this.tenant<{ uploadUrl: string; storagePath: string }>(
      "admin/resources/upload-url",
      "POST",
      { fileName: name, contentType: file.type, size: file.size },
    );
    if (this.slug !== slug || this.expectedUserId !== user)
      throw new RequestError(403, "SESSION_IDENTITY_CHANGED");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 120000);
    try {
      const result = await fetch(data.uploadUrl, {
        method: "PUT",
        credentials: "omit",
        headers: { "Content-Type": file.type, "If-None-Match": "*" },
        body: file,
        signal: abort.signal,
      });
      if (!result.ok) throw new RequestError(result.status, "UPLOAD_FAILED");
      if (this.slug !== slug || this.expectedUserId !== user)
        throw new RequestError(403, "SESSION_IDENTITY_CHANGED");
      return data.storagePath;
    } finally {
      clearTimeout(timer);
    }
  }
  resources() {
    return this.tenant<{ resources: Resource[] }>("resources");
  }
  quizzes() {
    return this.tenant<{ quizzes: Quiz[] }>("quizzes");
  }
}
