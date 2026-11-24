import { Component, inject, signal, computed, OnInit, OnDestroy } from "@angular/core";
import { DatePipe } from "@angular/common";
import { RouterLink, ActivatedRoute } from "@angular/router";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
import { DataService } from "../core/data.service";
import { WhatsAppService } from "../core/whatsapp.service";
import { ReceiptService } from "../core/receipt.service";
import { NotificationsService, computePaymentReminders, reminderText } from "../core/notifications.service";
import { FR } from "../core/fr";
import { MoneyPipe } from "../shared/money.pipe";
import {
  BadgeComponent,
  IconComponent,
  EmptyComponent,
  SkeletonComponent,
  installmentLabel,
} from "../shared/ui";
import type { Dossier, Payment, StudentAnnouncement } from "../core/models";

@Component({
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    MoneyPipe,
    BadgeComponent,
    IconComponent,
    EmptyComponent,
    SkeletonComponent,
  ],
  template: `@if (error()) {
      <div role="alert" class="error-box">
        {{ t.error }}<button class="btn" (click)="load()">{{ t.retry }}</button>
      </div>
    }
    @if (data(); as d) {
      @if (view === "home") {
        <div class="page-heading">
          <div>
            <span class="eyebrow">{{ t.progress }}</span>
            <h1>{{ t.welcome }}, {{ d.student.full_name.split(" ")[0] }}</h1>
          </div>
        </div>

        <!-- Rappels de paiement (J-7, J-3, J-1, en retard) -->
        @for (r of reminders(); track r.installmentId) {
          <div
            class="reminder-banner"
            [class.d7]="r.milestone === 7"
            [class.d3]="r.milestone === 3"
            [class.d1]="r.milestone === 1"
            [class.overdue]="r.milestone === -1"
          >
            <app-icon [name]="r.urgent ? 'warning' : 'schedule'" />
            <div class="grow">
              <strong>{{ reminderText(r) }}</strong>
              <p>{{ r.amount | fcfa }} — échéance le {{ r.dueDate | date: 'dd/MM/yyyy' }}</p>
            </div>
            <a class="btn small" [routerLink]="base + '/paiements'">{{ t.open }}</a>
          </div>
        }

        @if (notifications.pushSupported() && notifications.permission() === 'default' && !notifications.subscribed()) {
          <section class="card soft-note">
            <div class="row between">
              <div>
                <strong>{{ t.reminderTitle }}</strong>
                <p class="muted small">{{ t.remindersPrompt }}</p>
              </div>
              <button class="btn small" [disabled]="notifications.busy()" (click)="enablePush()">
                {{ t.enableReminders }}
              </button>
            </div>
            @if (notifications.message()) {
              <p class="muted small" role="status" style="margin-top: 8px">{{ notifications.message() }}</p>
            }
          </section>
        } @else if (notifications.message()) {
          <p class="muted small" role="status">{{ notifications.message() }}</p>
        }

        <!-- Annonces du groupe ou de l'école -->
        @if (announcements().length) {
          <section class="card">
            <div class="row between">
              <h2>{{ t.announcements }}</h2>
              @if (unreadAnnouncementsCount() > 0) {
                <span class="badge upcoming">{{ unreadAnnouncementsCount() }} {{ t.unread }}</span>
              }
            </div>
            @for (a of announcements(); track a.id) {
              <article class="announcement-card" [class.unread]="!a.is_read">
                <div class="row between">
                  <span class="badge ghost">{{ a.group_name || t.allGroups }}</span>
                  <span class="muted small">{{ a.created_at | date: "dd/MM/yyyy HH:mm" }}</span>
                </div>
                <h3>{{ a.title }}</h3>
                <p class="announcement-body">{{ a.body }}</p>
                @if (!a.is_read) {
                  <div class="announcement-actions">
                    <button class="btn small secondary" (click)="markRead(a)">
                      <app-icon name="done" />{{ t.markRead }}
                    </button>
                  </div>
                }
              </article>
            }
          </section>
        }

        @if (!d.student.has_paid) {
          <section class="trial-card">
            <div class="row">
              <app-icon name="timer" />
              <h2>{{ remaining(d.student.trial_ends_at) }} {{ t.days }}</h2>
              <app-badge kind="trial" [label]="t.trial" />
            </div>
            <p>{{ t.payAtSchool }}</p>
            <progress
              [value]="remaining(d.student.trial_ends_at)"
              [max]="auth.school()?.trial_days || 14"
            ></progress
            ><a class="btn full" [routerLink]="base + '/paiements'"
              >{{ t.nextInstallment }}<app-icon name="arrow_forward"
            /></a>
          </section>
        }
        <section class="card">
          <div class="row between">
            <h2>{{ d.student.full_name }}</h2>
            <app-badge
              [kind]="d.student.has_paid ? 'paid' : 'trial'"
              [label]="d.student.has_paid ? t.paid : t.trial"
            />
          </div>
          <p>{{ d.enrollment?.group_name }}</p>
          <span class="muted">N° {{ d.student.student_number }}</span>
        </section>
        <div class="grid-two">
          <a class="card feature" [routerLink]="base + '/cours'"
            ><span class="feature-icon"><app-icon name="menu_book" /></span>
            <h2>{{ t.courses }}</h2>
            <p>{{ t.download }}</p>
            <span class="btn full"
              >{{ t.open }}<app-icon name="arrow_forward" /></span></a
          ><a class="card feature" [routerLink]="base + '/quiz'"
            ><span class="feature-icon amber"><app-icon name="quiz" /></span>
            <h2>{{ t.quiz }}</h2>
            <p>{{ t.serverGrade }}</p>
            <span class="btn accent full"
              >{{ t.start }}<app-icon name="arrow_forward" /></span
          ></a
          ><a class="card feature" [routerLink]="base + '/epreuves'"
            ><span class="feature-icon"><app-icon name="assignment" /></span>
            <h2>{{ t.exams }}</h2>
            <p>{{ t.examsTeaser }}</p>
            <span class="btn secondary full"
              >{{ t.open }}<app-icon name="arrow_forward" /></span
          ></a>
        </div>
      }
      @if (view === "home" && d.attempts.length) {
        <section class="card">
          <h2>{{ t.result }}</h2>
          @for (attempt of d.attempts; track attempt.id) {
            <div class="list-row">
              <span>{{ attempt.taken_at | date: "dd/MM/yyyy" }}</span
              ><strong>{{ attempt.score }} / {{ attempt.total }}</strong>
            </div>
          }
        </section>
      }
      @if (view === "expired" || !d.student.has_access) {
        <section class="card expired">
          <span class="feature-icon amber"><app-icon name="lock" /></span>
          <h1>{{ t.expired }}</h1>
          <p>{{ t.payAtSchool }}</p>
          <strong>{{ auth.school()?.name }}</strong>
          <p>{{ auth.school()?.address }}</p>
          <a [href]="'tel:' + auth.school()?.phone">{{
            auth.school()?.phone
          }}</a
          ><button class="btn full" (click)="contact()">
            {{ t.whatsapp }}
          </button>
        </section>
      }
      <section class="card">
        <div class="row between">
          <h2>{{ t.payments }}</h2>
          <app-icon name="account_balance_wallet" />
        </div>
        @if (d.enrollment; as e) {
          <div class="money-grid">
            <div class="inset">
              <span>{{ t.received }}</span
              ><strong>{{ e.paid | fcfa }}</strong>
            </div>
            <div class="inset">
              <span>{{ t.balance }}</span
              ><strong>{{ e.balance | fcfa }}</strong>
            </div>
          </div>
          <p class="muted">{{ t.total }} : {{ e.total_fee | fcfa }}</p>
          @if (view === "home") {
            <a class="text-link" [routerLink]="base + '/paiements'"
              >{{ t.open }}<app-icon name="arrow_forward"
            /></a>
          } @else {
            <div class="timeline">
              @for (i of d.installments; track i.id) {
                <div class="timeline-row">
                  <span
                    class="timeline-dot"
                    [class.paid]="i.status === 'paid'"
                  ></span>
                  <div>
                    <strong>{{ i.label }}</strong>
                    <p>{{ i.due_date | date: "dd/MM/yyyy" }}</p>
                  </div>
                  <div class="align-right">
                    <strong>{{ i.amount | fcfa }}</strong
                    ><app-badge
                      [kind]="i.status"
                      [label]="t[statusLabel(i.status)]"
                    />
                  </div>
                </div>
              }
            </div>
          }
        } @else {
          <app-empty />
        }
      </section>
      @if (view !== "home") {
        <section class="card">
          <h2>{{ t.receipts }}</h2>
          @for (p of d.payments; track p.id) {
            <article class="list-row">
              <div>
                <strong>{{ p.receipt_number }}</strong>
                <p>
                  {{ p.paid_at | date: "dd/MM/yyyy" }} · {{ p.amount | fcfa }}
                </p>
                @if (p.cancelled_at) {
                  <app-badge kind="overdue" [label]="t.cancel" />
                }
              </div>
              <div class="actions">
                <button
                  class="btn small secondary"
                  (click)="receipt.generate(p, d)"
                >
                  {{ t.pdf }}</button
                ><button
                  class="btn small ghost"
                  (click)="receipt.generate(p, d, true)"
                >
                  {{ t.ticket }}
                </button>
              </div>
            </article>
          } @empty {
            <app-empty />
          }
        </section>
      }
    } @else if (!error()) {
      <app-skeleton variant="dashboard" [count]="3" />
    }`,
})
export class StudentPageComponent implements OnInit, OnDestroy {
  t = FR;
  auth = inject(AuthService);
  api = inject(ApiService);
  store = inject(DataService);
  whatsapp = inject(WhatsAppService);
  receipt = inject(ReceiptService);
  notifications = inject(NotificationsService);
  route = inject(ActivatedRoute);

  data = signal<Dossier | null>(null);
  error = signal(false);
  announcements = signal<StudentAnnouncement[]>([]);
  view = this.route.snapshot.data["view"] as string;
  statusLabel = installmentLabel;

  reminders = computed(() => computePaymentReminders(this.data()?.installments));
  unreadAnnouncementsCount = computed(
    () => this.announcements().filter((a) => !a.is_read).length,
  );
  reminderText = reminderText;

  get base() {
    return "/s/" + this.api.slug;
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
    this.error.set(false);
    try {
      const d = await this.store.read(
        "me",
        () => this.api.me(),
        (cached) => this.data.set(cached),
      );
      this.data.set(d);

      if (this.api.online()) {
        void this.auth.refreshLease().catch(() => {});
        void this.notifications.syncIfGranted(this.api.slug);
        void this.api
          .studentAnnouncements(this.api.slug)
          .then((res) => this.announcements.set(res.announcements))
          .catch(() => {});

        if (d?.student?.id) {
          void this.notifications.fireLocalRemindersIfGranted(
            d.student.id,
            this.reminders(),
            this.api.slug,
          );
        }
      }
    } catch {
      this.error.set(true);
    }
  }

  async enablePush() {
    await this.notifications.enablePush(this.api.slug);
  }

  async markRead(a: StudentAnnouncement) {
    try {
      await this.api.markAnnouncementRead(a.id);
      this.announcements.set(
        this.announcements().map((x) =>
          x.id === a.id ? { ...x, is_read: true } : x,
        ),
      );
    } catch {
      // Offline or network error
    }
  }

  remaining(end: string | null) {
    return end
      ? Math.max(0, Math.ceil((Date.parse(end) - Date.now()) / 86400000))
      : 0;
  }
  contact() {
    const s = this.auth.school();
    if (s)
      this.whatsapp.open(
        s.whatsapp,
        `${s.name} — ${this.t.payments} : ${this.auth.user()?.name || ""}`,
      );
  }
}
