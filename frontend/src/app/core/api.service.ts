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
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
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
  ) => Promise<void>;

  setAuthorizationErrorHandler(
    handler: (error: RequestError, path: string) => Promise<void>,
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
  ): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30000);
    try {
      const r = await fetch(this.base + path, {
        method,
        credentials: "include",
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const error = new RequestError(r.status, data.error || "REQUEST_FAILED");
        const tenantPrefix = `/schools/${encodeURIComponent(this.slug)}/`;

        if (
          (r.status === 401 || r.status === 403) &&
          path.startsWith(tenantPrefix) &&
          this.authorizationErrorHandler
        ) {
          try {
            await this.authorizationErrorHandler(error, path);
          } catch (invalidationError) {
            console.error("Authorization cache invalidation failed", invalidationError);
          }
        }

        throw error;
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
  tenant<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    return this.request<T>(
      `/schools/${encodeURIComponent(this.slug)}/${path}`,
      method,
      body,
      this.expectedUserId ? { "X-Expected-User": this.expectedUserId } : {},
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
  resources() {
    return this.tenant<{ resources: Resource[] }>("resources");
  }
  quizzes() {
    return this.tenant<{ quizzes: Quiz[] }>("quizzes");
  }
}
