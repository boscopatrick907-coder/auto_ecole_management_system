import { Component, inject, computed, signal } from "@angular/core";
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
          <a
            class="avatar"
            [routerLink]="'/s/' + api.slug + '/profil'"
            [attr.aria-label]="t.myProfile"
            [title]="t.myProfile"
          >
            {{ initials() }}
          </a>
        }
      </div>
    </header>
    @if (!api.online()) {
      <aside class="net-strip offline" role="status">
        <app-icon name="cloud_off" /><span>{{ t.offlineShort }}</span>
        @if (outbox.count()) {
          <strong>{{ outbox.count() }} {{ t.pending }}</strong>
        }
      </aside>
    } @else if (outbox.count()) {
      <aside class="net-strip pending" role="status">
        <app-icon name="cloud_upload" /><span>{{ outbox.count() }} {{ t.pending }}</span>
        <button class="btn small ghost" [disabled]="outbox.syncing()" (click)="outbox.flush()">
          {{ outbox.syncing() ? t.syncing : t.sync }}
        </button>
      </aside>
    }
    @if (outbox.blocked()) {
      <aside class="net-strip blocked" role="alert">
        <app-icon name="error" /><span>{{ outbox.blocked() }} {{ t.blocked }}</span>
        <a class="btn small" [routerLink]="'/s/' + api.slug + '/synchronisation'">{{ t.check }}</a>
      </aside>
    }
    <main id="main" class="page">
      @if (auth.leaseError() && !leaseNoteClosed()) {
        <p role="status" class="soft-note">
          <app-icon name="cloud_off" /><span>{{ t.leaseRefreshFailed }}</span>
          <button class="icon-btn" type="button" [attr.aria-label]="t.close" (click)="closeLeaseNote()">
            <app-icon name="close" />
          </button>
        </p>
      }
      @if (auth.error()) {
        <div class="empty">
          <h1>{{ auth.error() === "noSchool" ? t.noSchool : auth.error() === "unavailable" ? t.networkError : t.error }}</h1>
          <div class="actions">
            <button class="btn" type="button" (click)="auth.openSchool(api.slug, true)">
              {{ t.retry }}
            </button>
            <a class="btn ghost" routerLink="/" [queryParams]="{ changer: 1 }">{{ t.changeSchool }}</a>
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
  leaseNoteClosed = signal(sessionStorage.getItem("aem:lease-note") === "closed");
  constructor() {
    void this.outbox.refresh();
    void this.outbox.flush();
    // Back online: quietly retry the offline access refresh.
    window.addEventListener("online", () => {
      if (this.auth.role()) void this.auth.refreshLease().then(() => this.auth.leaseError.set(false)).catch(() => {});
    });
  }
  closeLeaseNote() {
    this.leaseNoteClosed.set(true);
    try {
      sessionStorage.setItem("aem:lease-note", "closed");
    } catch {
      /* private mode */
    }
  }
}
