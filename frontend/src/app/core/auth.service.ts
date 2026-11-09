import { Injectable, inject, signal } from "@angular/core";
import { ApiService, RequestError } from "./api.service";
import { database, accountScope } from "./database";
import type { School, User, Role, Catalogue } from "./models";
import { importJWK, jwtVerify, type JWK } from "jose";
@Injectable({ providedIn: "root" })
export class AuthService {
  readonly api = inject(ApiService);
  readonly school = signal<School | null>(null);
  readonly user = signal<User | null>(null);
  readonly role = signal<Role | null>(null);
  readonly ready = signal(false);
  readonly error = signal("");
  get scope() {
    return this.school() && this.user()
      ? accountScope(this.school()!.id, this.user()!.id)
      : "";
  }
  async openSchool(slug: string) {
    this.ready.set(false);
    this.user.set(null);
    this.role.set(null);
    this.school.set(null);
    this.api.slug = slug;
    this.api.expectedUserId = "";
    try {
      let cat: Catalogue;
      if (this.api.online()) {
        cat = await this.api.catalogue();
        await database.snapshots.put({
          key: "school:" + slug,
          scope: "public",
          data: cat,
          updatedAt: Date.now(),
        });
      } else {
        const cached = await database.snapshots.get("school:" + slug);
        if (!cached) throw new Error("SCHOOL_NOT_FOUND");
        cat = cached.data as Catalogue;
      }
      this.school.set(cat.school);
      this.applyBrand(cat.school);
      if (this.api.online()) {
        if (localStorage.getItem("school-pending-signout")) {
          await this.api.request("/auth/sign-out", "POST", {});
          localStorage.removeItem("school-pending-signout");
        }
        const s = await this.api.request<{ user: User } | null>(
          "/auth/get-session",
        );
        this.user.set(s?.user || null);
        this.api.expectedUserId = s?.user.id || "";
        if (s?.user) {
          try {
            const m = await this.api.tenant<{ role: Role }>("session");
            this.role.set(m.role);
            await this.refreshLease();
          } catch (e) {
            if (!(e instanceof RequestError && e.status === 403)) throw e;
          }
        }
        await database.snapshots.put({
          key: "identity:" + slug,
          scope: "identity:" + slug,
          data: { user: this.user(), role: this.role() },
          updatedAt: Date.now(),
        });
      } else {
        const cached = await database.snapshots.get("identity:" + slug);
        const identity = cached?.data as
          { user: User | null; role: Role | null } | undefined;
        if (identity) {
          this.user.set(identity.user);
          this.role.set(identity.role);
          if (!(await this.offlineAllowed(false))) this.user.set(null);
        }
      }
      this.error.set("");
    } catch (e) {
      console.error("School initialization failed", e);
      this.error.set("noSchool");
    } finally {
      this.ready.set(true);
    }
  }
  private applyBrand(s: School) {
    for (const [k, v] of Object.entries({
      primary: s.colors.primary,
      accent: s.colors.accent,
    })) {
      if (/^#[0-9a-f]{6}$/i.test(v))
        document.documentElement.style.setProperty("--" + k, v);
    }
    document.title = s.name;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", s.colors.primary);
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    );
    if (link) {
      if (link.href.startsWith("blob:")) URL.revokeObjectURL(link.href);
      link.href = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify({
              id: "/s/" + s.slug,
              name: s.name,
              short_name: s.name.slice(0, 20),
              start_url: "/s/" + s.slug + "/connexion",
              scope: "/",
              display: "standalone",
              theme_color: s.colors.primary,
              background_color: "#f7f9ff",
              icons: [
                {
                  src: location.origin + "/aem-icon.svg",
                  sizes: "any",
                  type: "image/svg+xml",
                  purpose: "any maskable",
                },
              ],
            }),
          ],
          { type: "application/manifest+json" },
        ),
      );
    }
  }
  async login(email: string, password: string) {
    await this.api.request("/auth/sign-in/email", "POST", { email, password });
    await this.openSchool(this.api.slug);
  }
  async signup(
    name: string,
    email: string,
    password: string,
    turnstile: string,
  ) {
    return this.api.request(
      "/auth/sign-up/email",
      "POST",
      { name, email, password },
      { "X-Turnstile-Token": turnstile },
    );
  }
  async refreshLease() {
    const lease = await this.api.tenant<{ token: string; publicKey: JWK }>(
      "lease",
    );
    const now = Date.now();
    await database.snapshots.put({
      key: this.scope + ":lease",
      scope: this.scope,
      data: { ...lease, highWater: now },
      updatedAt: now,
    });
  }
  async offlineAllowed(learning = true): Promise<boolean> {
    if (!this.scope) return false;
    const row = await database.snapshots.get(this.scope + ":lease");
    if (!row) return false;
    const data = row.data as {
      token: string;
      publicKey: JWK;
      highWater: number;
    };
    const now = Date.now();
    if (now + 300000 < data.highWater) return false;
    try {
      const key = await importJWK(data.publicKey, "EdDSA");
      const { payload } = await jwtVerify(data.token, key, {
        algorithms: ["EdDSA"],
        issuer: "school-api",
        audience: "school-pwa",
      });
      if (
        payload.sub !== this.user()?.id ||
        payload["schoolId"] !== this.school()?.id ||
        Number(payload["maxOfflineUntilMs"]) < now
      )
        return false;
      await database.snapshots.update(row.key, {
        data: { ...data, highWater: Math.max(now, data.highWater) },
      });
      return (
        !learning ||
        (payload["hasAccess"] === true &&
          (payload["hasPaid"] === true ||
            Date.parse(String(payload["trialEndsAt"])) > now))
      );
    } catch {
      return false;
    }
  }
  async logout() {
    const scope = this.scope;
    try {
      if (this.api.online()) {
        await this.api.request("/auth/sign-out", "POST", {});
      } else localStorage.setItem("school-pending-signout", "true");
    } finally {
      await database.snapshots.delete("identity:" + this.api.slug);
      if (scope) {
        await database.snapshots.where("scope").equals(scope).delete();
        await database.files.where("scope").equals(scope).delete();
      }
      this.user.set(null);
      this.role.set(null);
      this.api.expectedUserId = "";
    }
    // Outbox entries are preserved and remain scoped to their original identity.
  }
}
