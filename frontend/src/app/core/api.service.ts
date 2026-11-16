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
@Injectable({ providedIn: "root" })
export class ApiService {
  readonly base =
    (globalThis as typeof globalThis & { __SCHOOL_API__?: string })
      .__SCHOOL_API__ || "/api";
  readonly online = signal(navigator.onLine);
  slug = "";
  expectedUserId = "";
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
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new RequestError(r.status, data.error || "REQUEST_FAILED");
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
  students(search = "") {
    return this.tenant<{
      students: Array<
        Dossier["student"] & { balance: number; group_name: string }
      >;
    }>("admin/students?search=" + encodeURIComponent(search));
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
