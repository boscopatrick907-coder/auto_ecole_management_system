import { Component, inject, signal, OnInit, OnDestroy } from "@angular/core";
import { DatePipe } from "@angular/common";
import { RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
import { DataService } from "../core/data.service";
import { FR } from "../core/fr";
import { MoneyPipe } from "../shared/money.pipe";
import { IconComponent, EmptyComponent } from "../shared/ui";
import type { Dashboard, Payment } from "../core/models";
@Component({
  standalone: true,
  imports: [RouterLink, DatePipe, MoneyPipe, IconComponent, EmptyComponent],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">{{ auth.school()?.name }}</span>
        <h1>{{ t.dashboard }}</h1>
        <p>{{ auth.user()?.name }}</p>
      </div>
      <a class="btn" [routerLink]="base + '/eleves/nouveau'"
        ><app-icon name="person_add" />{{ t.newStudent }}</a
      >
    </div>
    @if (error()) {
      <p role="alert" class="error-box">
        {{ t.error
        }}<button class="btn small" (click)="load()">{{ t.retry }}</button>
      </p>
    }
    @if (loading()) {
      <p role="status">{{ dashboard() ? t.refreshing : t.loading }}</p>
    }
    @if (dashboard(); as d) {
      <div class="kpi-grid">
        <div class="card">
          <app-icon name="groups" /><span>{{ t.totalStudents }}</span
          ><strong>{{ d.students }}</strong>
        </div>
        <div class="card primary-kpi">
          <app-icon name="payments" /><span>{{ t.collected }}</span
          ><strong>{{ d.collected | fcfa }}</strong>
        </div>
        <div class="card">
          <app-icon name="account_balance_wallet" /><span>{{ t.owed }}</span
          ><strong>{{ d.owed | fcfa }}</strong>
        </div>
        <div class="card">
          <app-icon name="warning" /><span>{{ t.overdueStudents }}</span
          ><strong>{{ d.overdue }}</strong>
        </div>
      </div>
      <section class="card">
        <div class="row between">
          <h2>{{ t.payments }}</h2>
          <a class="text-link" [routerLink]="base + '/journal'"
            >{{ t.journal }}<app-icon name="arrow_forward"
          /></a>
        </div>
        @for (p of d.recentPayments; track p.id) {
          <div class="list-row">
            <div class="row">
              <span class="avatar">{{ p.student_name?.charAt(0) }}</span>
              <div>
                <strong>{{ p.student_name }}</strong>
                <p>
                  {{ p.receipt_number }} · {{ p.paid_at | date: "dd/MM/yyyy" }}
                </p>
              </div>
            </div>
            <strong>{{ p.amount | fcfa }}</strong>
          </div>
        } @empty {
          <app-empty />
        }
      </section>
    }
    <div class="quick-links">
      <a class="card" [routerLink]="base + '/journal'"
        ><app-icon name="receipt_long" />{{ t.journal }}</a
      ><a class="card" [routerLink]="base + '/rapport'"
        ><app-icon name="bar_chart" />{{ t.report }}</a
      ><a class="card" [routerLink]="base + '/parametres'"
        ><app-icon name="settings" />{{ t.settings }}</a
      >
    </div>`,
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  store = inject(DataService);
  dashboard = signal<Dashboard | null>(null);
  error = signal(false);
  loading = signal(true);
  private loadVersion = 0;
  get base() {
    return "/s/" + this.api.slug + "/admin";
  }
  listener = () => void this.load();
  ngOnInit() {
    void this.load();
    window.addEventListener("school:sync", this.listener);
  }
  ngOnDestroy() {
    window.removeEventListener("school:sync", this.listener);
  }
  async load() {
    const version = ++this.loadVersion;
    this.loading.set(true);
    try {
      const value = await this.store.read("dashboard", () => this.api.dashboard(), (cached) => {
        if (version === this.loadVersion) this.dashboard.set(cached);
      });
      if (version !== this.loadVersion) return;
      this.dashboard.set(value);
      this.error.set(false);
    } catch {
      if (version !== this.loadVersion) return;
      this.error.set(true);
    } finally {
      if (version === this.loadVersion) this.loading.set(false);
    }
  }
}
