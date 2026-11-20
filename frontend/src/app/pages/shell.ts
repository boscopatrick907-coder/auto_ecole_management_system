import { Component, inject, computed } from "@angular/core";
import { Router, RouterOutlet, RouterLink } from "@angular/router";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
import { OutboxService } from "../core/outbox.service";
import { FR } from "../core/fr";
import { BottomNavComponent, IconComponent } from "../shared/ui";
@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, BottomNavComponent, IconComponent],
  template: `<header class="topbar">
      <a [routerLink]="'/s/' + api.slug" class="brand">
        @if (auth.school()?.logo) {
          <img [src]="auth.school()!.logo" alt="" />
        } @else {
          <span class="brand-mark"><app-icon name="directions_car" /></span>
        }
        <span>{{ auth.school()?.name || t.app }}</span></a
      >
      <div class="header-actions">
        <span class="connection" [class.disconnected]="!api.online()"
          ><i></i>{{ api.online() ? t.online : t.offline.split("—")[0] }}</span
        >
        @if (auth.user()) {
          <button
            class="avatar"
            [attr.aria-label]="t.logout"
            (click)="logout()"
          >
            {{ initials() }}
          </button>
        }
      </div>
    </header>
    @if (!api.online() || outbox.count()) {
      <aside class="offline-banner" role="status">
        <app-icon name="wifi_off" /><span>{{
          !api.online() ? t.offline : t.online
        }}</span>
        @if (outbox.count()) {
          <strong>{{ outbox.count() }} {{ t.pending }}</strong>
        }
        <button
          class="btn small ghost"
          [disabled]="!api.online() || outbox.syncing()"
          (click)="outbox.flush()"
        >
          {{ t.sync }}
        </button>
      </aside>
    }
    @if (outbox.blocked()) {
      <aside class="error-box">
        {{ outbox.blocked() }} {{ t.blocked
        }}<a
          class="btn small"
          [routerLink]="'/s/' + api.slug + '/synchronisation'"
          >Vérifier ces opérations</a
        >
      </aside>
    }
    @if (auth.user()) {
      <a
        class="text-link"
        style="display:block;text-align:center;padding:8px"
        [routerLink]="'/s/' + api.slug + '/synchronisation'"
        >Voir mes envois et les opérations à vérifier</a
      >
    }
    <main id="main" class="page">
      @if (auth.leaseError()) {
        <p role="status" class="error-box">{{ t.leaseRefreshFailed }}</p>
      }
      @if (auth.error()) {
        <div class="empty">
          <h1>{{ auth.error() === "noSchool" ? t.noSchool : auth.error() === "unavailable" ? t.networkError : t.error }}</h1>
          <div class="actions">
            <button class="btn" type="button" (click)="auth.openSchool(api.slug, true)">
              {{ t.retry }}
            </button>
            <a class="btn ghost" routerLink="/">{{ t.back }}</a>
          </div>
        </div>
      } @else {
        <router-outlet />
      }
    </main>
    @if (auth.role()) {
      <app-bottom-nav [tabs]="tabs()" />
    }`,
})
export class ShellComponent {
  t = FR;
  auth = inject(AuthService);
  api = inject(ApiService);
  outbox = inject(OutboxService);
  router = inject(Router);
  initials = computed(
    () =>
      this.auth
        .user()
        ?.name.split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("") || "",
  );
  tabs = computed(() => {
    const base = "/s/" + this.api.slug;
    return this.auth.role() === "admin"
      ? [
          { path: base + "/admin", label: this.t.dashboard, icon: "dashboard" },
          {
            path: base + "/admin/eleves",
            label: this.t.students,
            icon: "groups",
          },
          {
            path: base + "/admin/contenus",
            label: "Contenus",
            icon: "library_books",
          },
          {
            path: base + "/admin/groupes",
            label: this.t.groups,
            icon: "calendar_month",
          },
        ]
      : [
          { path: base + "/accueil", label: this.t.home, icon: "home" },
          { path: base + "/cours", label: this.t.courses, icon: "menu_book" },
          { path: base + "/quiz", label: this.t.quiz, icon: "quiz" },
          {
            path: base + "/paiements",
            label: this.t.payments,
            icon: "account_balance_wallet",
          },
        ];
  });
  constructor() {
    void this.outbox.refresh();
    void this.outbox.flush();
  }
  async logout() {
    await this.auth.logout();
    await this.outbox.refresh();
    await this.router.navigate(["/s", this.api.slug, "connexion"]);
  }
}
