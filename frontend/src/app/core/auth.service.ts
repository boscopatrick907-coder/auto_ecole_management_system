import { Injectable, inject, signal } from "@angular/core";
import { ApiService, RequestError } from "./api.service";
import { database, accountScope } from "./database";
import type { School, User, Role, Catalogue } from "./models";
import { importJWK, jwtVerify, type JWK } from "jose";

interface PendingSignout {
  schoolSlug: string;
  userId: string;
}

interface CachedIdentity {
  user: User | null;
  role: Role | null;
}

@Injectable({ providedIn: "root" })
export class AuthService {
  readonly api = inject(ApiService);
  readonly school = signal<School | null>(null);
  readonly user = signal<User | null>(null);
  readonly role = signal<Role | null>(null);
  readonly ready = signal(false);
  readonly error = signal("");
  readonly leaseError = signal(false);
  private initialization = 0;
  private opening?: { slug: string; promise: Promise<void> };
  private leases = new Map<string, Promise<void>>();

  private readonly pendingSignoutKey = "school-pending-signout";

  get scope() {
    return this.school() && this.user()
      ? accountScope(this.school()!.id, this.user()!.id)
      : "";
  }

  private isRole(value: unknown): value is Role {
    return value === "admin" || value === "student";
  }

  private clearIdentity() {
    this.user.set(null);
    this.role.set(null);
    this.api.expectedUserId = "";
  }

  private readPendingSignout(): PendingSignout | null {
    const raw = localStorage.getItem(this.pendingSignoutKey);

    if (!raw) return null;

    try {
      const value: unknown = JSON.parse(raw);

      if (
        typeof value === "object" &&
        value !== null &&
        "schoolSlug" in value &&
        "userId" in value &&
        typeof value.schoolSlug === "string" &&
        typeof value.userId === "string"
      ) {
        return {
          schoolSlug: value.schoolSlug,
          userId: value.userId,
        };
      }
    } catch {
      // Ignore legacy or malformed logout markers.
    }

    return null;
  }

  openSchool(slug: string): Promise<void> {
    if (this.opening?.slug === slug) return this.opening.promise;
    const promise = this.loadSchool(slug);
    this.opening = { slug, promise };
    void promise.finally(() => {
      if (this.opening?.promise === promise) this.opening = undefined;
    });
    return promise;
  }

  private async loadSchool(slug: string) {
    const generation = ++this.initialization;
    const ensureCurrent = () => {
      if (generation !== this.initialization) throw new Error("INITIALIZATION_REPLACED");
    };
    this.ready.set(false);
    this.error.set("");
    this.leaseError.set(false);
    this.clearIdentity();
    this.school.set(null);
    this.api.slug = slug;

    try {
      let cat: Catalogue;
      let session: { user: User } | null = null;

      if (this.api.online()) {
        [cat, session] = await Promise.all([
          this.api.catalogue(),
          this.api.request<{ user: User } | null>("/auth/get-session"),
        ]);
        ensureCurrent();

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

      ensureCurrent();
      this.school.set(cat.school);
      this.applyBrand(cat.school);

      if (this.api.online()) {
        const pending = this.readPendingSignout();

        let currentUser = session?.user || null;

        // Only sign out the same account that requested offline logout.
        if (pending) {
          if (
            pending.schoolSlug === slug &&
            currentUser?.id === pending.userId
          ) {
            await this.api.request("/auth/sign-out", "POST", {});
            ensureCurrent();
            currentUser = null;
          }

          localStorage.removeItem(this.pendingSignoutKey);
        } else if (localStorage.getItem(this.pendingSignoutKey)) {
          // Remove an obsolete or malformed legacy marker.
          localStorage.removeItem(this.pendingSignoutKey);
        }

        this.user.set(currentUser);
        this.api.expectedUserId = currentUser?.id || "";

        if (currentUser) {
          try {
            const membership = await this.api.tenant<{ role: Role }>("session");
            ensureCurrent();

            if (!this.isRole(membership.role)) {
              throw new Error("INVALID_USER_ROLE");
            }

            this.role.set(membership.role);
          } catch (e) {
            if (!(e instanceof RequestError && e.status === 403)) {
              throw e;
            }

            this.role.set(null);
          }
        }

        await database.snapshots.put({
          key: "identity:" + slug,
          scope: "identity:" + slug,
          data: {
            user: this.user(),
            role: this.role(),
          },
          updatedAt: Date.now(),
        });
        ensureCurrent();
      } else {
        const cached = await database.snapshots.get("identity:" + slug);
        ensureCurrent();

        const identity = cached?.data as CachedIdentity | undefined;

        if (identity?.user?.id && this.isRole(identity.role)) {
          this.user.set(identity.user);
          this.role.set(identity.role);
          this.api.expectedUserId = identity.user.id;

          const allowed = await this.offlineAllowed(false);
          ensureCurrent();
          if (!allowed) {
            this.clearIdentity();
          }
        } else {
          this.clearIdentity();
        }
      }

      this.error.set("");
      if (this.api.online() && this.role()) {
        void this.refreshLease().catch(() => {
          if (generation === this.initialization) this.leaseError.set(true);
        });
      }
    } catch (e) {
      if (generation !== this.initialization) return;
      console.error("School initialization failed", e);
      this.clearIdentity();
      this.error.set(
        e instanceof RequestError && e.code === "SCHOOL_NOT_FOUND" ? "noSchool" : "loadFailed",
      );
    } finally {
      if (generation === this.initialization) this.ready.set(true);
    }
  }

  private applyBrand(s: School) {
    for (const [key, value] of Object.entries({
      primary: s.colors.primary,
      accent: s.colors.accent,
    })) {
      if (/^#[0-9a-f]{6}$/i.test(value)) {
        document.documentElement.style.setProperty("--" + key, value);
      }
    }

    document.title = s.name;

    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", s.colors.primary);

    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    );

    if (link) {
      if (link.href.startsWith("blob:")) {
        URL.revokeObjectURL(link.href);
      }

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

  refreshLease(): Promise<void> {
    const scope = this.scope;
    const key = this.initialization + ":" + scope;
    const pending = this.leases.get(key);
    if (pending) return pending;
    const promise = this.loadLease(scope, this.initialization);
    this.leases.set(key, promise);
    void promise.finally(() => this.leases.delete(key)).catch(() => {});
    return promise;
  }

  private async loadLease(scope: string, generation: number) {
    if (!this.scope || !this.role()) {
      throw new Error("INVALID_LEASE_IDENTITY");
    }

    const lease = await this.api.tenant<{
      token: string;
      publicKey: JWK;
    }>("lease");

    if (this.scope !== scope || generation !== this.initialization) return;

    if (!lease.token || !lease.publicKey) {
      throw new Error("INVALID_OFFLINE_LEASE");
    }

    const now = Date.now();

    await database.snapshots.put({
      key: scope + ":lease",
      scope,
      data: {
        ...lease,
        highWater: now,
      },
      updatedAt: now,
    });
    if (this.scope === scope && generation === this.initialization) this.leaseError.set(false);
  }

  async offlineAllowed(learning = true): Promise<boolean> {
    if (!this.scope || !this.role()) return false;

    const row = await database.snapshots.get(this.scope + ":lease");

    if (!row) return false;

    const data = row.data as {
      token: string;
      publicKey: JWK;
      highWater: number;
    };

    const now = Date.now();

    if (
      !Number.isFinite(data.highWater) ||
      now + 300000 < data.highWater ||
      typeof data.token !== "string" ||
      !data.publicKey
    ) {
      return false;
    }

    try {
      const key = await importJWK(data.publicKey, "EdDSA");

      const { payload } = await jwtVerify(data.token, key, {
        algorithms: ["EdDSA"],
        issuer: "school-api",
        audience: "school-pwa",
      });

      const maxOfflineUntil = Number(payload["maxOfflineUntilMs"]);

      if (
        payload.sub !== this.user()?.id ||
        payload["schoolId"] !== this.school()?.id ||
        payload["role"] !== this.role() ||
        !Number.isFinite(maxOfflineUntil) ||
        maxOfflineUntil <= now
      ) {
        return false;
      }

      await database.snapshots.update(row.key, {
        data: {
          ...data,
          highWater: Math.max(now, data.highWater),
        },
      });

      if (!learning) return true;

      return (
        payload["hasAccess"] === true &&
        (payload["hasPaid"] === true ||
          (typeof payload["trialEndsAt"] === "string" &&
            Date.parse(payload["trialEndsAt"]) > now))
      );
    } catch {
      return false;
    }
  }

  async logout() {
    ++this.initialization;
    this.opening = undefined;
    const scope = this.scope;
    const currentUser = this.user();
    const slug = this.api.slug;

    try {
      if (this.api.online()) {
        await this.api.request("/auth/sign-out", "POST", {});
      } else if (currentUser?.id) {
        const marker: PendingSignout = {
          schoolSlug: slug,
          userId: currentUser.id,
        };

        localStorage.setItem(this.pendingSignoutKey, JSON.stringify(marker));
      }
    } finally {
      await database.snapshots.delete("identity:" + slug);

      if (scope) {
        await database.snapshots.where("scope").equals(scope).delete();

        await database.files.where("scope").equals(scope).delete();
      }

      this.clearIdentity();
    }

    // Outbox entries remain scoped to their original identity.
  }
}
