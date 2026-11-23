import { Component, OnInit, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ApiService, RequestError } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { FR } from "../core/fr";
import { formatCode } from "../core/activation";
import { IconComponent } from "../shared/ui";

interface StaffRow {
  kind: "member" | "invite";
  id: string;
  name: string;
  email: string;
  since: string;
}

/** Équipe: school admins add and remove other admins, without a developer. */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">{{ auth.school()?.name }}</span>
        <h1>{{ t.team }}</h1>
        <p class="muted">{{ t.teamHelp }}</p>
      </div>
    </div>
    <div class="grid-two">
      <section class="card">
        <h2>{{ t.teamAdmins }}</h2>
        @if (loading()) {
          <p role="status">{{ t.loading }}</p>
        }
        @for (m of members(); track m.id) {
          <div class="list-row">
            <span class="avatar" aria-hidden="true">{{ (m.name || m.email).charAt(0).toUpperCase() }}</span>
            <div class="grow">
              <strong>{{ m.name || m.email }}</strong>
              @if (m.id === auth.user()?.id) {
                <span class="badge trial">{{ t.you }}</span>
              }
              <p>{{ m.email }}</p>
            </div>
            @if (m.id !== auth.user()?.id) {
              @if (confirming() === m.id) {
                <div class="row">
                  <button class="btn small danger" type="button" [disabled]="busy()" (click)="remove(m)">{{ t.confirmRemove }}</button>
                  <button class="btn small ghost" type="button" (click)="confirming.set('')">{{ t.back }}</button>
                </div>
              } @else {
                <button class="btn small ghost" type="button" [attr.aria-label]="t.removeAccess + ' ' + (m.name || m.email)" (click)="confirming.set(m.id)">
                  <app-icon name="person_remove" />{{ t.removeAccess }}
                </button>
              }
            }
          </div>
        }
        @if (invites().length) {
          <h3>{{ t.pendingInvites }}</h3>
          @for (i of invites(); track i.id) {
            <div class="list-row">
              <div class="grow">
                <strong>{{ i.name || i.email }}</strong>
                <p>{{ i.email }} · {{ t.codeWaiting }}</p>
              </div>
              <button class="btn small ghost" type="button" [disabled]="busy()" (click)="cancel(i)">{{ t.cancelCode }}</button>
            </div>
          }
        }
      </section>

      <section class="card">
        <h2>{{ t.addAdmin }}</h2>
        <form [formGroup]="form" (ngSubmit)="add()">
          <label>{{ t.name }}<input formControlName="name" autocomplete="off" /></label>
          <label>{{ t.email }}<input formControlName="email" type="email" autocomplete="off" /></label>
          <button class="btn full" [disabled]="busy() || form.invalid || !api.online()">
            <app-icon name="person_add" />{{ t.createCode }}
          </button>
        </form>
        @if (issued(); as c) {
          <div class="inset" role="status" style="margin-top: 18px">
            <strong>{{ t.staffCodeReady }} {{ c.email }}</strong>
            <code class="invite-code">{{ format(c.code) }}</code>
            <p class="muted">{{ t.staffCodeHelp }}</p>
            <p class="muted">{{ link(c.email) }}</p>
          </div>
        }
        @if (error()) {
          <p class="error-box" role="alert">{{ error() }}</p>
        }
      </section>
    </div>`,
})
export class TeamComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  fb = inject(FormBuilder);
  members = signal<StaffRow[]>([]);
  invites = signal<StaffRow[]>([]);
  loading = signal(true);
  busy = signal(false);
  error = signal("");
  confirming = signal("");
  issued = signal<{ code: string; email: string } | null>(null);
  form = this.fb.nonNullable.group({
    name: ["", [Validators.required, Validators.minLength(2)]],
    email: ["", [Validators.required, Validators.email]],
  });
  format = formatCode;

  ngOnInit() {
    void this.load();
  }

  link(email: string) {
    return `${location.origin}/s/${this.api.slug}/activation?staff=1&email=${encodeURIComponent(email)}`;
  }

  async load() {
    this.loading.set(true);
    try {
      const { staff } = await this.api.tenant<{ staff: StaffRow[] }>("admin/staff");
      this.members.set(staff.filter((s) => s.kind === "member"));
      this.invites.set(staff.filter((s) => s.kind === "invite"));
    } catch {
      this.error.set(this.t.error);
    } finally {
      this.loading.set(false);
    }
  }

  private message(e: unknown) {
    if (!(e instanceof RequestError)) return this.t.networkError;
    if (e.code === "ALREADY_STAFF") return this.t.alreadyStaff;
    if (e.code === "CANNOT_REMOVE_SELF") return this.t.cannotRemoveSelf;
    if (e.code === "VALIDATION_ERROR" || e.code === "INVALID_EMAIL") return this.t.loginEmailInvalid;
    return this.t.conflict;
  }

  async add() {
    this.busy.set(true);
    this.error.set("");
    try {
      const v = this.form.getRawValue();
      const r = await this.api.tenant<{ code: string; email: string }>("admin/staff/invite", "POST", v);
      this.issued.set(r);
      this.form.reset();
      await this.load();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(m: StaffRow) {
    this.busy.set(true);
    this.error.set("");
    try {
      await this.api.tenant(`admin/staff/members/${encodeURIComponent(m.id)}`, "DELETE");
      this.confirming.set("");
      await this.load();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  async cancel(i: StaffRow) {
    this.busy.set(true);
    try {
      await this.api.tenant(`admin/staff/invites/${encodeURIComponent(i.id)}`, "DELETE");
      await this.load();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }
}
