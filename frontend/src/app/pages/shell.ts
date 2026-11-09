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
        }}<button class="btn small" (click)="outbox.retryBlocked()">
          {{ t.retryQueue }}
        </button>
      </aside>
    }
    <main id="main" class="page">
      @if (auth.error()) {
        <div class="empty">
          <h1>{{ t.noSchool }}</h1>
          <a class="btn" routerLink="/">{{ t.back }}</a>
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
