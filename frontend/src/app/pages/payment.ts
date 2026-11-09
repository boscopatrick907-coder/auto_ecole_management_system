import { Component, inject, signal, OnInit } from "@angular/core";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
import { DataService } from "../core/data.service";
import { OutboxService } from "../core/outbox.service";
import { ReceiptService } from "../core/receipt.service";
import { WhatsAppService } from "../core/whatsapp.service";
import { FR } from "../core/fr";
import { MoneyPipe, formatMoney } from "../shared/money.pipe";
import { IconComponent } from "../shared/ui";
import type { Dossier, Payment } from "../core/models";
import { database, nextOfflineReceipt } from "../core/database";
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, MoneyPipe, IconComponent],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">{{ t.admin }}</span>
        <h1>{{ t.record }}</h1>
      </div>
      <app-icon name="payments" />
    </div>
    @if (data(); as d) {
      <div class="payment-layout">
        <section class="card">
          <div class="row">
            <span class="avatar">{{ d.student.full_name.charAt(0) }}</span>
            <div>
              <h2>{{ d.student.full_name }}</h2>
              <p>
                #LM-{{ d.student.student_number }} ·
                {{ d.enrollment?.group_name }}
              </p>
            </div>
          </div>
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
          <form [formGroup]="form" (ngSubmit)="submit()">
            <label
              >{{ t.amount
              }}<input
                formControlName="amount"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                class="amount-input"
            /></label>
            <div class="chips">
              <button
                type="button"
                (click)="form.controls.amount.setValue(nextAmount())"
              >
                {{ t.nextInstallment }} · {{ nextAmount() | fcfa }}</button
              ><button
                type="button"
                (click)="
                  form.controls.amount.setValue(number(d.enrollment?.balance))
                "
              >
                {{ t.remaining }}
              </button>
            </div>
            <label
              >{{ t.method
              }}<select formControlName="method">
                <option value="cash">{{ t.cash }}</option>
                <option value="mtn_momo">{{ t.momo }}</option>
                <option value="orange_money">{{ t.orange }}</option>
                <option value="bank">{{ t.bank }}</option>
              </select></label
            ><label
              >{{ t.reference }}<input formControlName="reference"
            /></label>
            @if (error()) {
              <p class="error-box" role="alert">{{ error() }}</p>
            }
            <button
              class="btn full"
              [disabled]="form.invalid || busy() || !!payment()"
            >
              {{ busy() ? t.loading : t.confirm }}
            </button>
          </form>
        </section>
        <aside class="card receipt-preview">
          <div class="receipt-brand">
            <app-icon name="directions_car" />
            <h2>{{ auth.school()?.name }}</h2>
            <p>{{ auth.school()?.address }}</p>
            <p>{{ auth.school()?.phone }}</p>
          </div>
          <hr />
          <h3>{{ t.receiptHeader }}</h3>
          @if (payment(); as p) {
            <strong>{{ p.receipt_number }}</strong>
            @if (p.pending) {
              <p class="error-box">{{ t.pendingReceipt }}</p>
            }
            <p>{{ d.student.full_name }}</p>
            <div class="receipt-amount">{{ p.amount | fcfa }}</div>
            <p>{{ t.manual }}</p>
            <div class="actions">
              <button class="btn full" (click)="receipt.generate(p, d)">
                {{ t.pdf }}</button
              ><button
                class="btn secondary"
                (click)="receipt.generate(p, d, true)"
              >
                {{ t.ticket }}
              </button>
              @if (!p.pending) {
                <button class="btn secondary full" (click)="send()">
                  {{ t.whatsapp }}
                </button>
              }
            </div>
          } @else {
            <p>{{ d.student.full_name }}</p>
            <div class="receipt-amount">
              {{ form.controls.amount.value | fcfa }}
            </div>
            <p class="muted">{{ t.notice }}</p>
          }
        </aside>
      </div>
    }`,
})
export class PaymentComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  store = inject(DataService);
  outbox = inject(OutboxService);
  receipt = inject(ReceiptService);
  wa = inject(WhatsAppService);
  route = inject(ActivatedRoute);
  fb = inject(FormBuilder);
  data = signal<Dossier | null>(null);
  payment = signal<Payment | null>(null);
  busy = signal(false);
  error = signal("");
  id = this.route.snapshot.paramMap.get("id")!;
  number = Number;
  form = this.fb.nonNullable.group({
    amount: [
      0,
      [
        Validators.required,
        Validators.min(1),
        Validators.max(1000000000),
        Validators.pattern(/^\d+$/),
      ],
    ],
    method: ["cash"],
    reference: [""],
  });
  async ngOnInit() {
    try {
      this.data.set(
        await this.store.read("dossier:" + this.id, () =>
          this.api.dossier(this.id),
        ),
      );
      this.form.controls.amount.setValue(this.nextAmount());
    } catch {
      this.error.set(this.t.error);
    }
  }
  nextAmount() {
    const i = this.data()?.installments.find((x) => x.status !== "paid");
    return i
      ? Math.max(0, Number(i.amount) - Number(i.paid_amount || 0))
      : Number(this.data()?.enrollment?.balance || 0);
  }
  async submit() {
    if (this.form.invalid || this.busy() || this.payment()) return;
    const d = this.data();
    if (!d?.enrollment) return;
    const v = this.form.getRawValue();
    if (v.amount > Number(d.enrollment.balance)) {
      this.error.set(this.t.conflict);
      return;
    }
    this.busy.set(true);
    try {
      const id = crypto.randomUUID();
      const paidAt = new Date().toISOString();
      let receiptNumber: string | undefined;
      if (!this.api.online()) {
        if (!(await this.auth.offlineAllowed(false)))
          throw new Error(this.t.accessCheck);
        receiptNumber = await nextOfflineReceipt(this.auth.school()!.id);
      }
      await this.outbox.enqueue(
        "payment",
        {
          enrollmentId: d.enrollment.id,
          amount: v.amount,
          method: v.method,
          reference: v.reference || null,
          paidAt,
          ...(receiptNumber ? { receiptNumber } : {}),
        },
        id,
      );
      await this.outbox.flush();
      const row = await database.snapshots.get(
        this.auth.scope + ":result:" + id,
      );
      const p = (row?.data as { payment: Payment } | undefined)?.payment;
      if (p) {
        this.payment.set(p);
        this.data.set(
          await this.store.read("dossier:" + this.id, () =>
            this.api.dossier(this.id),
          ),
        );
      } else {
        this.payment.set({
          id,
          enrollment_id: d.enrollment.id,
          amount: v.amount,
          method: v.method,
          reference: v.reference || null,
          paid_at: paidAt,
          receipt_number: receiptNumber || id,
          cancelled_at: null,
          cancel_reason: null,
          pending: true,
        });
      }
    } catch {
      this.error.set(this.t.error);
    } finally {
      this.busy.set(false);
    }
  }
  send() {
    const p = this.payment(),
      d = this.data();
    if (p && d && !p.pending)
      this.wa.open(
        d.student.phone,
        `${this.auth.school()?.name}\n${this.t.receipt} ${p.receipt_number}\n${formatMoney(p.amount)}\n${this.t.notice}`,
      );
  }
}
