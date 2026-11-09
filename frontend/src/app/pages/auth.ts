import {
  Component,
  inject,
  signal,
  OnDestroy,
  AfterViewInit,
  viewChild,
  ElementRef,
} from "@angular/core";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
import { FR } from "../core/fr";
import { IconComponent } from "../shared/ui";
import type { Catalogue } from "../core/models";
declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, options: Record<string, unknown>): string;
      remove(id: string): void;
    };
    __TURNSTILE_SITE_KEY__?: string;
  }
}
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent],
  template: `<section class="auth-layout">
    <div class="auth-brand">
      <span class="eyebrow">{{ auth.school()?.name }}</span>
      <h1>{{ t.brand }}</h1>
      <p>{{ t.trialInfo }}</p>
      <div class="auth-road"><app-icon name="directions_car" /></div>
    </div>
    <div class="card auth-form">
      <div class="segmented">
        @for (m of modes; track m) {
          <button [class.selected]="mode() === m" (click)="setMode(m)">
            {{ t[m] }}
          </button>
        }
      </div>
      <h2>{{ t[mode()] }}</h2>
      @if (mode() !== "login") {
        <div class="stepper">
          @for (n of [1, 2, 3]; track n) {
            <span [class.selected]="step() >= n">{{ n }}</span>
          }
        </div>
      }
      <form [formGroup]="form" (ngSubmit)="submit()">
        @if (mode() === "login" || step() === 1) {
          @if (mode() !== "login") {
            <label
              >{{ t.name }}<input formControlName="name" autocomplete="name"
            /></label>
          }
          <label
            >{{ t.email
            }}<input
              formControlName="email"
              type="email"
              autocomplete="email" /></label
          ><label
            >{{ t.password
            }}<input
              formControlName="password"
              type="password"
              [attr.autocomplete]="
                mode() === 'login' ? 'current-password' : 'new-password'
              "
          /></label>
        }
        @if (mode() !== "login" && step() === 2) {
          <label
            >{{ t.phone
            }}<input
              formControlName="phone"
              type="tel"
              autocomplete="tel"
              placeholder="+2376XXXXXXXX"
          /></label>
          @if (mode() === "signup") {
            <label
              >{{ t.licence
              }}<select
                formControlName="category"
                (change)="form.controls.group.setValue('')"
              >
                <option value="">{{ t.choose }}</option>
                @for (c of catalogue()?.categories; track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select></label
            ><label
              >{{ t.group
              }}<select formControlName="group">
                <option value="">{{ t.choose }}</option>
                @for (g of catalogue()?.groups; track g.id) {
                  @if (g.licence_category_id === form.controls.category.value) {
                    <option [value]="g.id">
                      {{ g.name }} · {{ g.schedule_text }}
                    </option>
                  }
                }
              </select></label
            >
          } @else {
            <label
              >{{ t.inviteCode
              }}<input formControlName="code" autocomplete="one-time-code"
            /></label>
          }
        }
        @if (mode() !== "login" && step() === 3) {
          <div class="inset">
            <strong>{{ form.controls.name.value }}</strong>
            <p>{{ form.controls.email.value }}</p>
            <p>{{ form.controls.phone.value }}</p>
            <p>{{ t.trialInfo }}</p>
          </div>
          <div #captcha></div>
        }
        @if (error()) {
          <p class="error-box" role="alert">{{ error() }}</p>
        }
        @if (mode() === "login") {
          <button
            type="button"
            class="btn ghost full"
            [disabled]="busy()"
            (click)="requestReset()"
          >
            {{ t.resetPassword }}
          </button>
        }
        <div class="actions">
          @if (step() > 1 && mode() !== "login") {
            <button
              type="button"
              class="btn secondary"
              (click)="step.set(step() - 1)"
            >
              {{ t.back }}
            </button>
          }
          <button class="btn full" [disabled]="busy()">
            {{
              busy()
                ? t.loading
                : mode() === "login"
                  ? t.login
                  : step() < 3
                    ? t.next
                    : t.activate
            }}<app-icon name="arrow_forward" />
          </button>
        </div>
      </form>
    </div>
  </section>`,
})
export class AuthPageComponent implements OnDestroy, AfterViewInit {
  t = FR;
  auth = inject(AuthService);
  api = inject(ApiService);
  router = inject(Router);
  fb = inject(FormBuilder);
  mode = signal<"login" | "signup" | "invite">("login");
  modes = ["login", "signup", "invite"] as const;
  step = signal(1);
  busy = signal(false);
  error = signal("");
  catalogue = signal<Catalogue | null>(null);
  token = "";
  widget = "";
  siteKey = "";
  captcha = viewChild<ElementRef<HTMLElement>>("captcha");
  timer: ReturnType<typeof setInterval> | undefined;
  form = this.fb.nonNullable.group({
    name: ["", Validators.minLength(2)],
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required, Validators.minLength(12)]],
    phone: ["", Validators.pattern(/^\+237[26][0-9]{8}$/)],
    category: [""],
    group: [""],
    code: [""],
  });
  constructor() {
    void this.api
      .request<{ turnstileSiteKey: string }>("/config")
      .then((x) => (this.siteKey = x.turnstileSiteKey))
      .catch(() => {});
    if (location.pathname.endsWith("/inscription")) this.mode.set("signup");
    void this.api
      .catalogue()
      .then((x) => this.catalogue.set(x))
      .catch(() => this.error.set(this.t.error));
  }
  setMode(m: "login" | "signup" | "invite") {
    this.mode.set(m);
    this.step.set(1);
    this.error.set("");
  }
  ngAfterViewInit() {
    this.timer = setInterval(() => this.renderCaptcha(), 500);
  }
  renderCaptcha() {
    if (this.mode() === "login" || this.step() !== 3 || !this.captcha()) return;
    if (this.widget) return;
    const key = this.siteKey || window.__TURNSTILE_SITE_KEY__;
    if (!key) {
      this.error.set(this.t.captchaUnavailable);
      return;
    }
    if (!window.turnstile) {
      if (!document.getElementById("turnstile-script")) {
        const s = document.createElement("script");
        s.id = "turnstile-script";
        s.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        document.head.append(s);
      }
      return;
    }
    this.widget = window.turnstile.render(this.captcha()!.nativeElement, {
      sitekey: key,
      callback: (token: string) => (this.token = token),
      "expired-callback": () => (this.token = ""),
    });
  }
  async submit() {
    this.error.set("");
    const v = this.form.getRawValue();
    if (this.mode() !== "login" && this.step() < 3) {
      const valid =
        this.step() === 1
          ? v.name.length >= 2 &&
            this.form.controls.email.valid &&
            this.form.controls.password.valid
          : this.form.controls.phone.valid &&
            !!v.phone &&
            (this.mode() === "invite" ? !!v.code : !!v.group);
      if (!valid) {
        this.error.set(this.t.conflict);
        return;
      }
      this.step.update((n) => n + 1);
      return;
    }
    if (this.form.controls.email.invalid || this.form.controls.password.invalid)
      return;
    this.busy.set(true);
    try {
      if (this.mode() === "login") {
        await this.auth.login(v.email, v.password);
      } else {
        if (!this.auth.user()) {
          if (!this.token) throw new Error("TURNSTILE_REQUIRED");
          await this.auth.signup(v.name, v.email, v.password, this.token);
          await this.auth.openSchool(this.api.slug);
        }
        if (this.mode() === "invite")
          await this.api.tenant("claim-invite", "POST", {
            inviteCode: v.code,
            phone: v.phone,
          });
        else
          await this.api.tenant("enroll", "POST", {
            groupId: v.group,
            fullName: v.name,
            phone: v.phone,
          });
        await this.auth.openSchool(this.api.slug);
      }
      if (!this.auth.role()) {
        this.form.controls.name.setValue(this.auth.user()?.name || v.name);
        this.setMode("signup");
        this.step.set(2);
        return;
      }
      await this.router.navigate([
        "/s",
        this.api.slug,
        this.auth.role() === "admin" ? "admin" : "accueil",
      ]);
    } catch {
      this.error.set(this.t.conflict);
    } finally {
      this.busy.set(false);
    }
  }
  async requestReset() {
    if (this.form.controls.email.invalid) {
      this.error.set(this.t.conflict);
      return;
    }
    this.busy.set(true);
    try {
      await this.api.request("/auth/request-password-reset", "POST", {
        email: this.form.controls.email.value,
        redirectTo: location.origin + "/s/" + this.api.slug + "/reinitialiser",
      });
      this.error.set(this.t.resetSent);
    } catch {
      this.error.set(this.t.error);
    } finally {
      this.busy.set(false);
    }
  }
  ngOnDestroy() {
    clearInterval(this.timer);
    if (this.widget) window.turnstile?.remove(this.widget);
  }
}
