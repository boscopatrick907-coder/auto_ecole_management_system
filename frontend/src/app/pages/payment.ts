import { Component, inject, signal, OnInit, OnDestroy } from "@angular/core";
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
import { nextOfflineReceipt } from "../core/database";

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
              <span>{{ t.received }}</span>
              <strong>{{ d.enrollment?.paid | fcfa }}</strong>
            </div>
            <div class="inset">
              <span>{{ t.balance }}</span>
              <strong>{{ d.enrollment?.balance | fcfa }}</strong>
            </div>
          </div>

          <form [formGroup]="form" (ngSubmit)="submit()">
            <label>
              {{ t.amount }}
              <input
                formControlName="amount"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                class="amount-input"
              />
            </label>

            <div class="chips">
              <button
                type="button"
                (click)="form.controls.amount.setValue(nextAmount())"
              >
                {{ t.nextInstallment }} · {{ nextAmount() | fcfa }}
              </button>

              <button
                type="button"
                (click)="
                  form.controls.amount.setValue(number(d.enrollment?.balance))
                "
              >
                {{ t.remaining }}
              </button>
            </div>

            <label>
              {{ t.method }}
              <select formControlName="method">
                <option value="cash">{{ t.cash }}</option>
                <option value="mtn_momo">{{ t.momo }}</option>
                <option value="orange_money">{{ t.orange }}</option>
                <option value="bank">{{ t.bank }}</option>
              </select>
            </label>

            <label>
              {{ t.reference }}
              <input formControlName="reference" />
            </label>

            @if (error()) {
              <p class="error-box" role="alert">{{ error() }}</p>
            }

            <button
              class="btn full"
              [disabled]="
                form.invalid || busy() || !!payment() || recoveryBlocked()
              "
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
                {{ t.pdf }}
              </button>

              <button
                class="btn secondary"
                (click)="receipt.generate(p, d, true)"
              >
                {{ t.ticket }}
              </button>

              @if (!p.pending) {
                <button class="btn secondary full" (click)="send()">
                  {{ t.whatsapp }}
                </button>

                <button
                  class="btn full"
                  [disabled]="busy()"
                  (click)="startNewPayment()"
                >
                  Nouveau paiement
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
export class PaymentComponent implements OnInit, OnDestroy {
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
  recoveryBlocked = signal(false);

  id = this.route.snapshot.paramMap.get("id")!;
  number = Number;

  private destroyed = false;

  private readonly syncListener = () => {
    void this.restorePayment();
  };

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
    window.addEventListener("school:sync", this.syncListener);

    try {
      this.data.set(
        await this.store.read("dossier:" + this.id, () =>
          this.api.dossier(this.id),
        ),
      );

      if (this.destroyed) return;

      this.form.controls.amount.setValue(this.nextAmount());

      await this.restorePayment();
    } catch {
      this.error.set(this.t.error);
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    window.removeEventListener("school:sync", this.syncListener);
  }

  nextAmount() {
    const i = this.data()?.installments.find((x) => x.status !== "paid");

    return i
      ? Math.max(0, Number(i.amount) - Number(i.paid_amount || 0))
      : Number(this.data()?.enrollment?.balance || 0);
  }

  private async restorePayment() {
    const d = this.data();
    const enrollment = d?.enrollment;

    if (!enrollment || this.destroyed) return;

    const scope = this.auth.scope;
    if (!scope) return;

    try {
      const recovered = await this.outbox.recoverPayment(enrollment.id);

      if (this.destroyed || this.auth.scope !== scope) return;

      if (!recovered) {
        this.recoveryBlocked.set(false);
        return;
      }

      if (recovered.payment) {
        this.payment.set({
          ...recovered.payment,
          pending: false,
        });

        this.recoveryBlocked.set(false);

        const updated = await this.store.read("dossier:" + this.id, () =>
          this.api.dossier(this.id),
        );

        if (!this.destroyed && this.auth.scope === scope && updated) {
          this.data.set(updated);
        }

        return;
      }

      if (recovered.queued) {
        const body = recovered.body;

        this.payment.set({
          id: recovered.id,
          enrollment_id: enrollment.id,
          amount: Number(body["amount"]),
          method: String(body["method"]),
          reference: (body["reference"] as string | null) ?? null,
          paid_at: String(body["paidAt"]),
          receipt_number: String(body["receiptNumber"] || recovered.id),
          cancelled_at: null,
          cancel_reason: null,
          pending: true,
        });

        this.recoveryBlocked.set(false);
        return;
      }

      this.payment.set(null);
      this.recoveryBlocked.set(true);
      this.error.set(this.t.error);
    } catch {
      if (!this.destroyed && this.auth.scope === scope) {
        this.recoveryBlocked.set(true);
        this.error.set(this.t.error);
      }
    }
  }

  async submit() {
    if (
      this.form.invalid ||
      this.busy() ||
      this.payment() ||
      this.recoveryBlocked()
    ) {
      return;
    }

    const d = this.data();

    if (!d?.enrollment) return;

    const v = this.form.getRawValue();

    if (v.amount > Number(d.enrollment.balance)) {
      this.error.set(this.t.conflict);
      return;
    }

    const scope = this.auth.scope;

    if (!scope) {
      this.error.set("AUTH_REQUIRED");
      return;
    }

    this.busy.set(true);
    this.error.set("");

    try {
      const id = crypto.randomUUID();
      const paidAt = new Date().toISOString();

      let receiptNumber: string | undefined;

      if (!this.api.online()) {
        if (!(await this.auth.offlineAllowed(false))) {
          throw new Error(this.t.accessCheck);
        }

        if (this.auth.scope !== scope) {
          throw new Error("AUTH_CHANGED");
        }

        receiptNumber = await nextOfflineReceipt(this.auth.school()!.id);
      }

      const body: Record<string, unknown> = {
        enrollmentId: d.enrollment.id,
        amount: v.amount,
        method: v.method,
        reference: v.reference || null,
        paidAt,
        ...(receiptNumber ? { receiptNumber } : {}),
      };

      if (this.auth.scope !== scope) {
        throw new Error("AUTH_CHANGED");
      }

      await this.outbox.enqueuePayment(d.enrollment.id, body, id);

      if (this.auth.scope !== scope) {
        throw new Error("AUTH_CHANGED");
      }

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

      await this.outbox.flush();

      if (this.auth.scope !== scope) return;

      await this.restorePayment();
    } catch {
      if (this.auth.scope === scope) {
        await this.restorePayment();
      }

      if (!this.payment()) {
        this.error.set(this.t.error);
      }
    } finally {
      this.busy.set(false);
    }
  }

  async startNewPayment() {
    const p = this.payment();
    const d = this.data();
    const enrollment = d?.enrollment;

    if (!p || p.pending || !enrollment || this.busy()) return;

    const scope = this.auth.scope;
    if (!scope) return;

    this.busy.set(true);
    this.error.set("");

    try {
      const recovered = await this.outbox.recoverPayment(enrollment.id);

      if (this.auth.scope !== scope) return;

      if (
        !recovered ||
        recovered.id !== p.id ||
        !recovered.payment ||
        recovered.queued
      ) {
        this.recoveryBlocked.set(true);
        this.error.set(this.t.error);
        return;
      }

      await this.outbox.clearPaymentReference(enrollment.id, p.id);

      if (this.auth.scope !== scope) return;

      this.payment.set(null);
      this.recoveryBlocked.set(false);

      this.form.reset({
        amount: this.nextAmount(),
        method: "cash",
        reference: "",
      });
    } catch {
      this.error.set(this.t.error);
    } finally {
      this.busy.set(false);
    }
  }

  send() {
    const p = this.payment();
    const d = this.data();

    if (p && d && !p.pending) {
      this.wa.open(
        d.student.phone,
        `${this.auth.school()?.name}\n${this.t.receipt} ${p.receipt_number}\n${formatMoney(p.amount)}\n${this.t.notice}`,
      );
    }
  }
}
