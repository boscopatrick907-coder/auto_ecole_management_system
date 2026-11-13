import { Component, inject, signal, OnInit } from "@angular/core";
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  Validators,
} from "@angular/forms";
import { RouterLink, ActivatedRoute, Router } from "@angular/router";
import { DatePipe } from "@angular/common";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
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
} from "../shared/ui";
import type { Dossier, Student, Group, Payment } from "../core/models";
@Component({
  standalone: true,
  imports: [RouterLink, FormsModule, MoneyPipe, EmptyComponent, IconComponent],
  template: `<div class="page-heading">
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
        /><button class="btn small">{{ t.search }}</button>
      </form>
      @if (error()) {
        <p class="error-box" role="alert">{{ t.error }}</p>
      }
      @for (s of students(); track s.id) {
        <a class="list-row student-row" [routerLink]="base + '/' + s.id"
          ><span class="avatar">{{ s.full_name.charAt(0) }}</span>
          <div class="grow">
            <strong>{{ s.full_name }}</strong>
            <p>#LM-{{ s.student_number }} · {{ s.phone }}</p>
            <span class="muted">{{ s.group_name }}</span>
          </div>
          <div class="align-right">
            <strong>{{ s.balance | fcfa }}</strong
            ><app-icon name="chevron_right" /></div
        ></a>
      } @empty {
        <app-empty />
      }
    </section>`,
})
export class StudentListComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  store = inject(DataService);
  query = "";
  students = signal<Array<Student & { balance: number; group_name: string }>>(
    [],
  );
  error = signal(false);
  get base() {
    return "/s/" + this.api.slug + "/admin/eleves";
  }
  ngOnInit() {
    void this.load();
  }
  search(e: Event) {
    e.preventDefault();
    void this.load();
  }
  private loadVersion = 0;
  async load() {
    const version = ++this.loadVersion;
    const query = this.query;
    try {
      const r = await this.store.read("students:" + query, () =>
        this.api.students(query),
      );
      if (version !== this.loadVersion) return;
      this.students.set(r?.students || []);
      this.error.set(false);
    } catch {
      if (version !== this.loadVersion) return;
      this.error.set(true);
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
        <h2>{{ t.invitationReady }}</h2>
        <code class="invite-code">{{ inviteCode() }}</code>
        <p>{{ d.student.full_name }}</p>
        <div class="actions">
          <button class="btn secondary" (click)="sendInvite()">
            {{ t.whatsapp }}</button
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
  sendInvite() {
    const s = this.created()?.student;
    if (s)
      this.wa.open(
        s.phone,
        `${this.auth.school()?.name} — ${this.t.inviteCode} : ${this.inviteCode()}\n${location.origin}/s/${this.api.slug}/inscription`,
      );
  }
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
  ],
  template: `@if (dossier(); as d) {
      <div class="page-heading">
        <div>
          <span class="eyebrow">#LM-{{ d.student.student_number }}</span>
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
            {{ d.student.trial_ends_at | date: "dd/MM/yyyy" }}
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
          @if (!d.student.user_id) {
            <button
              class="btn ghost full"
              [disabled]="!api.online()"
              (click)="invite()"
            >
              {{ t.invitation }}
            </button>
            @if (inviteCode()) {
              <code class="invite-code">{{ inviteCode() }}</code>
            }
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
  id = this.route.snapshot.paramMap.get("id")!;
  dossier = signal<Dossier | null>(null);
  error = signal(false);
  inviteCode = signal("");
  cancelling = signal("");
  busy = signal(false);
  reason = "";
  statusLabel = installmentLabel;
  ngOnInit() {
    void this.load();
  }
  async load() {
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
  async invite() {
    try {
      const r = await this.api.tenant<{ inviteCode: string }>(
        "admin/students/" + this.id + "/invite",
        "POST",
        {},
      );
      this.inviteCode.set(r.inviteCode);
    } catch {
      this.error.set(true);
    }
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
}
