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
  imports: [FormsModule, DatePipe, MoneyPipe, EmptyComponent, IconComponent],
  template: `<div class="page-heading">
      <h1>{{ monthly ? t.report : t.journal }}</h1>
      <button
        class="btn secondary"
        [disabled]="!payments().length"
        (click)="exportCsv()"
      >
        <app-icon name="download" />{{ t.export }}
      </button>
    </div>
    <section class="card">
      <label
        >{{ t.date
        }}<input
          [type]="monthly ? 'month' : 'date'"
          [(ngModel)]="date"
          (change)="load()"
      /></label>
      <div class="money-grid">
        <div class="inset">
          <span>{{ t.collected }}</span
          ><strong>{{ total() | fcfa }}</strong>
        </div>
        <div class="inset">
          <span>{{ t.receipts }}</span
          ><strong>{{ count() }}</strong>
        </div>
      </div>
    </section>
    @if (error()) {
      <p class="error-box" role="alert">{{ t.error }}</p>
    }
    <section class="card">
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ t.receipt }}</th>
              <th>{{ t.name }}</th>
              <th>{{ t.date }}</th>
              <th>{{ t.method }}</th>
              <th>{{ t.amount }}</th>
              <th>{{ t.status }}</th>
            </tr>
          </thead>
          <tbody>
            @for (p of payments(); track p.id) {
              <tr>
                <td>{{ p.receipt_number }}</td>
                <td>{{ p.student_name }}</td>
                <td>{{ p.paid_at | date: "dd/MM/yyyy HH:mm" }}</td>
                <td>{{ p.method }}</td>
                <td class="tabular">{{ p.amount | fcfa }}</td>
                <td>{{ p.cancelled_at ? t.cancel : t.paid }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (!payments().length) {
        <app-empty />
      }
      @if (hasMore()) {
        <button class="btn secondary full" (click)="more()">
          {{ t.next }}
        </button>
      }
    </section>`,
})
export class ReportsComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  store = inject(DataService);
  monthly = location.pathname.endsWith("/rapport");
  date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Douala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .slice(0, this.monthly ? 7 : 10);
  payments = signal<Payment[]>([]);
  collected = signal(0);
  count = signal(0);
  hasMore = signal(false);
  error = signal(false);
  ngOnInit() {
    void this.load();
  }
  private loadVersion = 0;
  async load() {
    const version = ++this.loadVersion;
    const date = this.date;
    try {
      const r = await this.store.read("report:" + date, () =>
        this.api.payments(date),
      );
      if (version !== this.loadVersion) return;
      this.payments.set(r?.payments || []);
      this.count.set(r?.count || 0);
      this.collected.set(r?.collected || 0);
      this.hasMore.set(r?.hasMore || false);
      this.error.set(false);
    } catch {
      if (version !== this.loadVersion) return;
      this.error.set(true);
    }
  }
  total() {
    return this.collected();
  }
  async more() {
    const version = this.loadVersion;
    const date = this.date;
    const offset = this.payments().length;
    try {
      const r = await this.api.payments(date, offset);
      if (version !== this.loadVersion || date !== this.date || offset !== this.payments().length) return;
      this.payments.update((x) => [...x, ...r.payments]);
      this.hasMore.set(r.hasMore);
    } catch {
      if (version !== this.loadVersion) return;
      this.error.set(true);
    }
  }
  async exportCsv() {
    if (this.hasMore()) {
      while (this.hasMore()) {
        const before = this.payments().length;
        await this.more();
        if (this.payments().length === before) return;
      }
    }
    const safe = (v: unknown) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@-]/, "'" + "$&")
        .replace(/"/g, '""') +
      '"';
    const lines = [
      [
        this.t.receipt,
        this.t.name,
        this.t.date,
        this.t.amount,
        this.t.method,
        this.t.status,
      ],
      ...this.payments().map((p) => [
        p.receipt_number,
        p.student_name,
        p.paid_at,
        p.amount,
        p.method,
        p.cancelled_at ? this.t.cancel : this.t.paid,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\ufeff" + lines.map((r) => r.map(safe).join(";")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = this.date + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
