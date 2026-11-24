import { formatCode, activationLink, activationMessage } from "../core/activation";
import { Component, inject, signal, OnInit, OnDestroy } from "@angular/core";
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  Validators,
} from "@angular/forms";
import { RouterLink, ActivatedRoute, Router } from "@angular/router";
import { DatePipe } from "@angular/common";
import { AuthService } from "../core/auth.service";
import { ApiService, RequestError } from "../core/api.service";
import { DataService } from "../core/data.service";
import { WhatsAppService } from "../core/whatsapp.service";
import { ReceiptService } from "../core/receipt.service";
import { FR } from "../core/fr";
import { MoneyPipe } from "../shared/money.pipe";
import {
  IconComponent,
  EmptyComponent,
  BadgeComponent,
  installmentLabel,
  SkeletonComponent,
} from "../shared/ui";
import type { Dossier, Student, Group, Payment } from "../core/models";
@Component({
  standalone: true,
  imports: [RouterLink, FormsModule, MoneyPipe, EmptyComponent, IconComponent, SkeletonComponent],
  template: `@if (sameIdentity()) {
      <div class="page-heading">
        <div>
          <span class="eyebrow">{{ t.admin }}</span>
          <h1>{{ t.students }}</h1>
        </div>
        <a class="btn" [routerLink]="base + '/nouveau'"
          ><app-icon name="person_add" />{{ t.newStudent }}</a
        >
      </div>
      <section class="card">
        <form class="search" (submit)="search($event)">
          <app-icon name="search" /><input
            [(ngModel)]="query"
            name="query"
            [placeholder]="t.search"
            [attr.aria-label]="t.search"
          /><button class="btn small icon-only" [attr.aria-label]="t.search"><app-icon name="search" /></button>
        </form>
        @if (error()) {
          <p class="error-box" role="alert">{{ t.error }}</p>
        }
        @if (loading() && !students().length) {
          <app-skeleton variant="list" [count]="4" />
        }
        <p>{{ students().length }} élève(s) affiché(s) sur {{ total() }}</p>
        @for (s of students(); track s.id) {
          <a class="list-row student-row" [routerLink]="base + '/' + s.id"
            ><span class="avatar">{{ s.full_name.charAt(0) }}</span>
            <div class="grow">
              <strong>{{ s.full_name }}</strong>
              <p>N° {{ s.student_number }} · {{ s.phone }}</p>
              <span class="muted">{{ s.group_name }}</span>
            </div>
            <div class="align-right">
              <strong>{{ s.balance | fcfa }}</strong
              ><app-icon name="chevron_right" /></div
          ></a>
        } @empty {
          @if (!loading()) {
            <app-empty />
          }
        }
        @if (hasMore()) {
          <button
            class="btn secondary full"
            [disabled]="loading() || !api.online()"
            (click)="load(false)"
          >
            Afficher les élèves suivants
          </button>
        }
      </section>
    } @else {
      <p role="alert">
        Actualisez cette page après avoir changé d’école ou de compte.
      </p>
    }`,
})
export class StudentListComponent implements OnInit, OnDestroy {
  t = FR;
  api = inject(ApiService);
  store = inject(DataService);
  query = "";
  students = signal<Array<Student & { balance: number; group_name: string }>>(
    [],
  );
  private readonly identity = `${this.api.slug}:${this.api.expectedUserId}`;
  sameIdentity() {
    return this.identity === `${this.api.slug}:${this.api.expectedUserId}`;
  }
  error = signal(false);
  loading = signal(false);
  total = signal(0);
  hasMore = signal(false);
  private nextOffset = 0;
  private activeQuery = "";
  private requestId = 0;
  get base() {
    return "/s/" + this.api.slug + "/admin/eleves";
  }
  ngOnInit() {
    void this.load();
  }
  ngOnDestroy() {
    this.requestId++;
  }
  search(e: Event) {
    e.preventDefault();
    void this.load();
  }
  async load(reset = true) {
    if (!reset && this.loading()) return;
    const request = ++this.requestId;
    const identity = `${this.api.slug}:${this.api.expectedUserId}`;
    if (reset) {
      this.activeQuery = this.query.trim();
      this.nextOffset = 0;
      this.students.set([]);
      this.hasMore.set(false);
      this.total.set(0);
    }
    const query = this.activeQuery,
      offset = this.nextOffset;
    this.loading.set(true);
    this.error.set(false);
    try {
      const current = () =>
        request === this.requestId &&
        identity === `${this.api.slug}:${this.api.expectedUserId}`;
      const r = await this.store.read(
        `students:${query}:page:${offset}`,
        () => this.api.students(query, offset),
        // Show the verified cached first page while it is revalidated.
        (cached) => {
          if (reset && current()) this.students.set(cached?.students || []);
        },
      );
      if (
        request !== this.requestId ||
        identity !== `${this.api.slug}:${this.api.expectedUserId}`
      )
        return;
      const rows = r?.students || [];
      this.students.set(
        reset
          ? rows
          : [
              ...new Map(
                [...this.students(), ...rows].map((s) => [s.id, s]),
              ).values(),
            ],
      );
      this.total.set(r?.count ?? this.students().length);
      this.nextOffset = r?.nextOffset ?? offset + rows.length;
      this.hasMore.set(!!r?.hasMore && this.nextOffset > offset);
    } catch (e) {
      if (
        request !== this.requestId ||
        identity !== `${this.api.slug}:${this.api.expectedUserId}`
      )
        return;
      this.error.set(true);
      if (e instanceof RequestError && [401, 403].includes(e.status)) {
        this.students.set([]);
        this.hasMore.set(false);
      }
    } finally {
      if (request === this.requestId) this.loading.set(false);
    }
  }
}
@Component({
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, MoneyPipe, IconComponent],
  template: `<div class="page-heading">
      <h1>{{ t.newStudent }}</h1>
    </div>
    <section class="card narrow">
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label
          >{{ t.name
          }}<input formControlName="name" autocomplete="name" /></label
        ><label
          >{{ t.phone
          }}<input
            formControlName="phone"
            type="tel"
            placeholder="+2376XXXXXXXX" /></label
        ><label
          >{{ t.group
          }}<select formControlName="group">
            <option value="">{{ t.choose }}</option>
            @for (g of groups(); track g.id) {
              <option [value]="g.id">
                {{ g.licence_name }} · {{ g.name }} · {{ g.total_fee | fcfa }}
              </option>
            }
          </select></label
        >
        <p class="muted">{{ t.trialInfo }}</p>
        @if (error()) {
          <p class="error-box" role="alert">{{ t.conflict }}</p>
        }
        <button
          class="btn full"
          [disabled]="form.invalid || busy() || !api.online()"
        >
          {{ busy() ? t.loading : t.save }}
        </button>
      </form>
    </section>
    @if (created(); as d) {
      <section class="card narrow">
        <h2>{{ t.activationReady }}</h2>
        <code class="invite-code">{{ code() }}</code>
        <p>{{ d.student.full_name }} · {{ d.student.phone }}</p>
        <p class="muted">{{ t.activationValidity }}</p>
        <div class="actions">
          <button class="btn secondary" (click)="sendInvite()">
            {{ t.whatsapp }}</button
          ><button class="btn ghost" type="button" (click)="print()">
            {{ t.printCode }}</button
          ><a
            class="btn"
            [routerLink]="'/s/' + api.slug + '/admin/paiement/' + d.student.id"
            >{{ t.firstPayment }}</a
          >
        </div>
        <a
          class="text-link"
          [routerLink]="'/s/' + api.slug + '/admin/eleves/' + d.student.id"
          >{{ t.open }}<app-icon name="arrow_forward"
        /></a>
      </section>
    }`,
})
export class NewStudentComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  fb = inject(FormBuilder);
  wa = inject(WhatsAppService);
  auth = inject(AuthService);
  groups = signal<Group[]>([]);
  created = signal<Dossier | null>(null);
  inviteCode = signal("");
  busy = signal(false);
  error = signal(false);
  form = this.fb.nonNullable.group({
    name: ["", [Validators.required, Validators.minLength(2)]],
    phone: [
      "",
      [Validators.required, Validators.pattern(/^\+237[26][0-9]{8}$/)],
    ],
    group: ["", Validators.required],
  });
  async ngOnInit() {
    try {
      this.groups.set(
        (await this.api.groups()).groups.filter((g) => g.status === "open"),
      );
    } catch {
      this.error.set(true);
    }
  }
  async submit() {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      const r = await this.api.tenant<Dossier & { inviteCode: string }>(
        "admin/students",
        "POST",
        { fullName: v.name, phone: v.phone, groupId: v.group },
      );
      this.created.set(r);
      this.inviteCode.set(r.inviteCode);
      this.error.set(false);
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
  code() {
    return formatCode(this.inviteCode());
  }
  sendInvite() {
    const s = this.created()?.student;
    if (s)
      this.wa.open(
        s.phone,
        activationMessage(
          this.auth.school()?.name || "",
          this.inviteCode(),
          s.phone,
          activationLink(location.origin, this.api.slug, this.inviteCode(), s.phone),
        ),
      );
  }
  print() {
    window.print();
  }
}
interface ExamRow {
  id: string;
  title: string;
  score: number;
  total: number;
  submitted_at: string;
}
@Component({
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    MoneyPipe,
    DatePipe,
    BadgeComponent,
    EmptyComponent,
    IconComponent,
    SkeletonComponent,
  ],
  template: `@if (dossier(); as d) {
      <div class="page-heading">
        <div>
          <span class="eyebrow">N° {{ d.student.student_number }}</span>
          <h1>{{ d.student.full_name }}</h1>
          <p>{{ d.student.phone }}</p>
        </div>
        <a
          class="btn"
          [routerLink]="'/s/' + api.slug + '/admin/paiement/' + d.student.id"
          >{{ t.record }}</a
        >
      </div>
      <div class="grid-two">
        <section class="card">
          <h2>{{ t.progress }}</h2>
          <p>{{ d.enrollment?.group_name }}</p>
          <p>
            {{ t.trialEnd }} :
            {{ d.student.trial_ends_at ? (d.student.trial_ends_at | date: "dd/MM/yyyy") : t.trialAtActivation }}
          </p>
          <div class="money-grid">
            <div class="inset">
              <span>{{ t.received }}</span
              ><strong>{{ d.enrollment?.paid | fcfa }}</strong>
            </div>
            <div class="inset">
              <span>{{ t.balance }}</span
              ><strong>{{ d.enrollment?.balance | fcfa }}</strong>
            </div>
          </div>
          <button class="btn secondary full" (click)="remind()">
            {{ t.whatsapp }}
          </button>
          <button
            class="btn ghost full"
            [disabled]="!api.online() || busy()"
            (click)="d.student.user_id ? resetCode() : invite()"
          >
            {{ d.student.user_id ? t.resetCodeButton : t.invitation }}
          </button>
          @if (inviteCode()) {
            <div class="inset">
              <strong>{{ codeIsReset() ? t.resetCodeReady : t.activationReady }}</strong>
              <code class="invite-code">{{ code() }}</code>
              <p class="muted">
                {{ codeIsReset() ? t.resetCodeValidity : t.activationValidity }}
              </p>
              <button class="btn secondary full" type="button" (click)="sendCode()">
                {{ t.whatsapp }}
              </button>
            </div>
          }
        </section>
        <section class="card">
          <h2>{{ t.nextInstallment }}</h2>
          @for (i of d.installments; track i.id) {
            <div class="list-row">
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
          } @empty {
            <app-empty />
          }
        </section>
      </div>
      <section class="card">
        <h2>{{ t.learningResults }}</h2>
        @for (r of examResults(); track r.id) {
          <div class="list-row">
            <div class="grow">
              <strong>{{ r.title }}</strong>
              <p>{{ t.exams }} · {{ r.submitted_at | date: "dd/MM/yyyy HH:mm" }}</p>
            </div>
            <strong>{{ r.score }} / {{ r.total }}</strong>
          </div>
        }
        @for (a of d.attempts; track a.id) {
          <div class="list-row">
            <div class="grow">
              <strong>{{ t.quiz }}</strong>
              <p>{{ a.taken_at | date: "dd/MM/yyyy HH:mm" }}</p>
            </div>
            <strong>{{ a.score }} / {{ a.total }}</strong>
          </div>
        }
        @if (!examResults().length && !d.attempts.length) {
          <p class="muted">{{ t.noResultsYet }}</p>
        }
      </section>
      <section class="card">
        <h2>{{ t.receipts }}</h2>
        @for (p of d.payments; track p.id) {
          <article class="list-row wrap">
            <div class="grow">
              <strong>{{ p.receipt_number }}</strong>
              <p>
                {{ p.amount | fcfa }} · {{ p.paid_at | date: "dd/MM/yyyy" }}
              </p>
              @if (p.cancelled_at) {
                <app-badge kind="overdue" [label]="t.cancel" />
                <p>{{ p.cancel_reason }}</p>
              }
            </div>
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
            @if (!p.cancelled_at) {
              <button class="btn small danger" (click)="cancelling.set(p.id)">
                {{ t.cancel }}
              </button>
            }
          </article>
        } @empty {
          <app-empty />
        }
      </section>
      @if (cancelling()) {
        <section class="card">
          <h2>{{ t.confirmCancel }}</h2>
          <label>{{ t.reason }}<input [(ngModel)]="reason" /></label>
          <div class="actions">
            <button
              class="btn danger"
              [disabled]="reason.trim().length < 3 || busy() || !api.online()"
              (click)="cancelPayment()"
            >
              {{ t.confirm }}</button
            ><button class="btn secondary" (click)="cancelling.set('')">
              {{ t.back }}
            </button>
          </div>
        </section>
      }
      <section class="card">
        <h2>{{ t.actions }}</h2>
        <div class="actions">
          <button class="btn secondary" (click)="remind()">
            <app-icon name="chat" />{{ t.whatsapp }}
          </button>
          <button
            class="btn ghost danger"
            [disabled]="busy() || !api.online()"
            (click)="confirmDelete.set(!confirmDelete()); deleteHasPaymentsError.set(false)"
          >
            <app-icon name="delete" />{{ t.deleteStudent }}
          </button>
        </div>
        @if (confirmDelete()) {
          <div class="confirm-box danger">
            <p>{{ t.deleteStudentConfirm }}</p>
            <div class="confirm-box-actions">
              <button class="btn danger small" [disabled]="busy()" (click)="deleteStudent()">
                {{ busy() ? t.deleting : t.yesDelete }}
              </button>
              <button class="btn secondary small" [disabled]="busy()" (click)="confirmDelete.set(false)">
                {{ t.cancel }}
              </button>
            </div>
          </div>
        }
        @if (deleteHasPaymentsError()) {
          <div class="confirm-box">
            <p>{{ t.deleteStudentHasPayments }}</p>
          </div>
        }
      </section>
    } @else if (!error()) {
      <app-skeleton variant="detail" [count]="3" />
    }
    @if (error()) {
      <p class="error-box" role="alert">{{ t.conflict }}</p>
    }`,
})
export class DossierComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  store = inject(DataService);
  wa = inject(WhatsAppService);
  receipt = inject(ReceiptService);
  route = inject(ActivatedRoute);
  router = inject(Router);
  id = this.route.snapshot.paramMap.get("id")!;
  dossier = signal<Dossier | null>(null);
  error = signal(false);
  confirmDelete = signal(false);
  deleteHasPaymentsError = signal(false);
  inviteCode = signal("");
  cancelling = signal("");
  busy = signal(false);
  reason = "";
  statusLabel = installmentLabel;
  examResults = signal<ExamRow[]>([]);
  ngOnInit() {
    void this.load();
  }
  async load() {
    if (this.api.online())
      void this.api
        .tenant<{ results: ExamRow[] }>("admin/students/" + encodeURIComponent(this.id) + "/exam-results")
        .then((r) => this.examResults.set(r.results))
        .catch(() => {});
    try {
      this.dossier.set(
        await this.store.read("dossier:" + this.id, () =>
          this.api.dossier(this.id),
        ),
      );
      this.error.set(false);
    } catch {
      this.error.set(true);
    }
  }
  remind() {
    const d = this.dossier();
    if (d)
      this.wa.open(
        d.student.phone,
        `${this.auth.school()?.name} — ${this.t.balance} : ${d.enrollment?.balance || 0} FCFA. ${this.auth.school()?.address}`,
      );
  }
  codeIsReset = signal(false);
  code() {
    return formatCode(this.inviteCode());
  }
  async invite() {
    try {
      const r = await this.api.tenant<{ inviteCode: string }>(
        "admin/students/" + this.id + "/invite",
        "POST",
        {},
      );
      this.codeIsReset.set(false);
      this.inviteCode.set(r.inviteCode);
    } catch {
      this.error.set(true);
    }
  }
  async resetCode() {
    this.busy.set(true);
    try {
      const r = await this.api.tenant<{ resetCode: string }>(
        "admin/students/" + this.id + "/reset-code",
        "POST",
        {},
      );
      this.codeIsReset.set(true);
      this.inviteCode.set(r.resetCode);
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
  sendCode() {
    const d = this.dossier();
    if (!d) return;
    this.wa.open(
      d.student.phone,
      activationMessage(
        this.auth.school()?.name || "",
        this.inviteCode(),
        d.student.phone,
        activationLink(location.origin, this.api.slug, this.inviteCode(), d.student.phone),
        this.codeIsReset(),
      ),
    );
  }
  async cancelPayment() {
    this.busy.set(true);
    try {
      await this.api.tenant(
        "admin/payments/" + this.cancelling() + "/cancel",
        "POST",
        { reason: this.reason },
      );
      this.cancelling.set("");
      this.reason = "";
      await this.load();
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
  async deleteStudent() {
    this.busy.set(true);
    this.deleteHasPaymentsError.set(false);
    try {
      await this.api.deleteStudent(this.id);
      await this.router.navigate(["/s", this.api.slug, "admin", "eleves"]);
    } catch (e: unknown) {
      if (
        (e instanceof RequestError && e.status === 409) ||
        (typeof e === "object" && e !== null && "status" in e && (e as { status: number }).status === 409)
      ) {
        this.deleteHasPaymentsError.set(true);
      } else {
        this.error.set(true);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
