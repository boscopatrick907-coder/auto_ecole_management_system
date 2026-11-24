import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { DataService } from "../core/data.service";
import { OutboxService } from "../core/outbox.service";
import { PwaService } from "../core/pwa.service";
import { NotificationsService } from "../core/notifications.service";
import { FR } from "../core/fr";
import { MoneyPipe } from "../shared/money.pipe";
import { IconComponent } from "../shared/ui";
import type { Dossier } from "../core/models";

/** Mon profil: who is signed in, useful shortcuts, and sign-out (never on a single tap of the avatar). */
@Component({
  standalone: true,
  imports: [RouterLink, MoneyPipe, IconComponent],
  template: `<section class="profile-hero">
      <span class="avatar xl" aria-hidden="true">{{ initials() }}</span>
      <div>
        <h1>{{ name() }}</h1>
        <p>{{ auth.role() === "admin" ? t.roleAdmin : t.roleStudent }} · {{ auth.school()?.name }}</p>
      </div>
    </section>

    <section class="card">
      <h2>{{ t.account }}</h2>
      <dl class="facts">
        @if (dossier(); as d) {
          <div><dt>{{ t.phoneLabel }}</dt><dd>{{ d.student.phone }}</dd></div>
          <div><dt>{{ t.studentNumber }}</dt><dd>{{ d.student.student_number }}</dd></div>
          @if (d.enrollment) {
            <div><dt>{{ t.group }}</dt><dd>{{ d.enrollment.group_name }}</dd></div>
            <div><dt>{{ t.balanceLeft }}</dt><dd>{{ d.enrollment.balance | fcfa }}</dd></div>
          }
        }
        @if (email()) {
          <div><dt>{{ t.email }}</dt><dd class="break">{{ email() }}</dd></div>
        }
        <div><dt>{{ t.profileRole }}</dt><dd>{{ auth.role() === "admin" ? t.roleAdmin : t.roleStudent }}</dd></div>
        <div><dt>{{ t.school }}</dt><dd>{{ auth.school()?.name }}</dd></div>
      </dl>
    </section>

    <section class="card menu-list">
      <h2>{{ t.shortcuts }}</h2>
      @if (auth.role() === "admin") {
        <a [routerLink]="base + '/admin/equipe'"><app-icon name="group" /><span>{{ t.team }}</span><app-icon name="chevron_right" /></a>
        <a [routerLink]="base + '/admin/parametres'"><app-icon name="settings" /><span>{{ t.settings }}</span><app-icon name="chevron_right" /></a>
      } @else {
        <a [routerLink]="base + '/paiements'"><app-icon name="receipt_long" /><span>{{ t.payments }}</span><app-icon name="chevron_right" /></a>
      }
      <a [routerLink]="base + '/synchronisation'">
        <app-icon name="sync" /><span>{{ t.mySync }}</span>
        @if (outbox.count()) {
          <b class="count">{{ outbox.count() }}</b>
        }
        <app-icon name="chevron_right" />
      </a>
      @if (pwa.installAvailable()) {
        <button type="button" (click)="pwa.install()"><app-icon name="install_mobile" /><span>{{ t.installApp }}</span><app-icon name="chevron_right" /></button>
      }
      <a routerLink="/" [queryParams]="{ changer: 1 }"><app-icon name="swap_horiz" /><span>{{ t.switchSchool }}</span><app-icon name="chevron_right" /></a>
    </section>

    @if (auth.role() === "student") {
      <section class="card">
        <h2>{{ t.notifications }}</h2>
        <p class="muted small">{{ t.remindersPrompt }}</p>
        <div class="row between" style="margin-top: 14px">
          <div>
            <strong>{{ t.reminderTitle }}</strong>
            <p class="muted small">{{ notifications.subscribed() ? t.pushEnabled : t.pushDisabled }}</p>
          </div>
          @if (notifications.pushSupported()) {
            <button
              class="btn small"
              [class.secondary]="notifications.subscribed()"
              [disabled]="notifications.busy()"
              (click)="notifications.subscribed() ? notifications.disablePush(api.slug) : notifications.enablePush(api.slug)"
            >
              {{ notifications.subscribed() ? t.disableReminders : t.enableReminders }}
            </button>
          } @else {
            <span class="badge ghost">{{ t.pushUnsupported }}</span>
          }
        </div>
        @if (notifications.message()) {
          <p class="muted small" role="status" style="margin-top: 8px">{{ notifications.message() }}</p>
        }
      </section>
    }

    <button class="btn danger-outline full" type="button" [disabled]="busy()" (click)="logout()">
      <app-icon name="logout" />{{ t.logout }}
    </button>`,
})
export class ProfileComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  store = inject(DataService);
  outbox = inject(OutboxService);
  pwa = inject(PwaService);
  notifications = inject(NotificationsService);
  router = inject(Router);
  dossier = signal<Dossier | null>(null);
  busy = signal(false);
  base = "/s/" + this.api.slug;
  name = computed(() => this.dossier()?.student.full_name || this.auth.user()?.name || "");
  email = computed(() => {
    const e = this.auth.user()?.email || "";
    // Students signing in by phone get a technical address; never show it.
    return e && !e.endsWith(".invalid") && !e.includes("@phone.") ? e : "";
  });
  initials = computed(
    () =>
      this.name()
        .split(" ")
        .filter(Boolean)
        .map((s) => s[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "?",
  );

  async ngOnInit() {
    if (this.auth.role() !== "student") return;
    try {
      this.dossier.set(await this.store.read("me", () => this.api.me(), (c) => this.dossier.set(c)));
    } catch {
      /* the profile still shows the account basics */
    }
  }

  async logout() {
    this.busy.set(true);
    try {
      await this.auth.logout();
      await this.outbox.refresh();
      await this.router.navigate(["/s", this.api.slug, "connexion"]);
    } finally {
      this.busy.set(false);
    }
  }
}
