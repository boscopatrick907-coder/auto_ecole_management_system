import {
  Component,
  inject,
  signal,
  OnDestroy,
  AfterViewInit,
  viewChild,
  ElementRef,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { AuthService } from "../core/auth.service";
import { ApiService, RequestError } from "../core/api.service";
import { FR } from "../core/fr";
import { IconComponent } from "../shared/ui";
import type { Catalogue } from "../core/models";
import { normalizePhone } from "../core/activation";
declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, options: Record<string, unknown>): string;
      remove(id: string): void;
      reset(id?: string): void;
    };
    __TURNSTILE_SITE_KEY__?: string;
  }
}

type Mode = "login" | "activate" | "signup";
const PHONE = /^\+237[26][0-9]{8}$/;
export const MIN_PASSWORD = 8;


@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent, RouterLink],
  template: `<section class="auth-layout">
    <div class="auth-brand">
      <span class="eyebrow">{{ auth.school()?.name }}</span>
      <h1>{{ t.brand }}</h1>
      <p>{{ t.trialInfo }}</p>
      <div class="auth-road"><app-icon name="directions_car" /></div>
    </div>
    <div class="card auth-form">
      <div class="segmented" role="tablist">
        @for (m of modes; track m) {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="mode() === m"
            [class.selected]="mode() === m"
            (click)="setMode(m)"
          >
            {{ tabLabel[m] }}
          </button>
        }
      </div>

      <form [formGroup]="form" (ngSubmit)="submit()">
        @if (mode() === "login") {
          <h2>{{ t.login }}</h2>
          @if (loginWith() === "phone") {
            <label
              >{{ t.phoneLogin
              }}<input
                formControlName="phone"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                placeholder="6XX XX XX XX"
            /></label>
          } @else {
            <label
              >{{ t.email
              }}<input formControlName="email" type="email" autocomplete="email"
            /></label>
          }
          <label>{{ t.password }}<div class="pw-field"><input formControlName="password" [type]="showPassword() ? 'text' : 'password'" autocomplete="current-password" /><button type="button" class="pw-toggle" [attr.aria-label]="showPassword() ? t.hidePassword : t.showPassword" [attr.aria-pressed]="showPassword()" (click)="showPassword.set(!showPassword())"><app-icon [name]="showPassword() ? 'visibility_off' : 'visibility'" [size]="18" /></button></div></label>
        }

        @if (mode() === "activate") {
          <h2>{{ t.activateTitle }}</h2>
          <div class="segmented" role="tablist" [attr.aria-label]="t.activateAs">
            <button type="button" role="tab" [attr.aria-selected]="!staff()" [class.selected]="!staff()" (click)="staff.set(false)">{{ t.iAmStudent }}</button>
            <button type="button" role="tab" [attr.aria-selected]="staff()" [class.selected]="staff()" (click)="staff.set(true)">{{ t.iAmStaff }}</button>
          </div>
          <p class="muted">{{ staff() ? t.activateStaffHelp : t.activateHelp }}</p>
          @if (staff()) {
            <label
              >{{ t.email
              }}<input formControlName="email" type="email" autocomplete="email"
            /></label>
          } @else {
            <label
              >{{ t.phoneLogin
              }}<input
                formControlName="phone"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                placeholder="6XX XX XX XX"
            /></label>
          }
          <label
            >{{ staff() ? t.staffAccessCode : t.activationCode
            }}<input
              formControlName="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              spellcheck="false"
              placeholder="123 456"
          /></label>
          <label>{{ t.newPassword }}<div class="pw-field"><input formControlName="password" [type]="showPassword() ? 'text' : 'password'" autocomplete="new-password" /><button type="button" class="pw-toggle" [attr.aria-label]="showPassword() ? t.hidePassword : t.showPassword" [attr.aria-pressed]="showPassword()" (click)="showPassword.set(!showPassword())"><app-icon [name]="showPassword() ? 'visibility_off' : 'visibility'" [size]="18" /></button></div></label>
          <p class="muted">{{ staff() ? t.staffPasswordRule : t.passwordRule }}</p>
        }

        @if (mode() === "signup") {
          <h2>{{ t.signup }}</h2>
          <div class="stepper">
            @for (n of [1, 2, 3]; track n) {
              <span [class.selected]="step() >= n">{{ n }}</span>
            }
          </div>
          @if (step() === 1) {
            <label
              >{{ t.name }}<input formControlName="name" autocomplete="name"
            /></label>
            <label
              >{{ t.email
              }}<input formControlName="email" type="email" autocomplete="email"
            /></label>
            <label>{{ t.password }}<div class="pw-field"><input formControlName="password" [type]="showPassword() ? 'text' : 'password'" autocomplete="new-password" /><button type="button" class="pw-toggle" [attr.aria-label]="showPassword() ? t.hidePassword : t.showPassword" [attr.aria-pressed]="showPassword()" (click)="showPassword.set(!showPassword())"><app-icon [name]="showPassword() ? 'visibility_off' : 'visibility'" [size]="18" /></button></div></label>
            <p class="muted">{{ t.passwordRule }}</p>
          }
          @if (step() === 2) {
            <label
              >{{ t.phone
              }}<input
                formControlName="phone"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                placeholder="6XX XX XX XX"
            /></label>
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
          }
          @if (step() === 3) {
            <div class="inset">
              <strong>{{ form.controls.name.value }}</strong>
              <p>{{ form.controls.email.value }}</p>
              <p>{{ phoneValue() }}</p>
              <p>{{ t.trialInfo }}</p>
            </div>
            <div #captcha></div>
          }
        }

        @if (error()) {
          <p class="error-box" role="alert">{{ error() }}</p>
        }

        <div class="actions">
          @if (mode() === "signup" && step() > 1) {
            <button
              type="button"
              class="btn secondary"
              (click)="step.set(step() - 1)"
            >
              {{ t.back }}
            </button>
          }
          <button class="btn full" [disabled]="busy()">
            {{ busy() ? t.loading : submitLabel() }}<app-icon name="arrow_forward" />
          </button>
        </div>

        @if (mode() === "signup" || mode() === "activate") {
          <p class="muted small consent">
            En continuant, vous acceptez que l’auto-école enregistre vos données pour gérer votre formation.
            <a [routerLink]="'/s/' + api.slug + '/confidentialite'">Politique de confidentialité</a>
          </p>
        }
        @if (mode() === "login") {
          @if (loginWith() === "phone") {
            <p class="muted">{{ t.forgotPasswordDesk }}</p>
            <button type="button" class="btn ghost full" (click)="setLoginWith('email')">
              {{ t.staffEmailLogin }}
            </button>
          } @else {
            <button
              type="button"
              class="btn ghost full"
              [disabled]="busy()"
              (click)="requestReset()"
            >
              {{ t.resetPassword }}
            </button>
            <button type="button" class="btn ghost full" (click)="setLoginWith('phone')">
              {{ t.studentPhoneLogin }}
            </button>
          }
          <a class="text-link center-link" [routerLink]="'/s/' + api.slug + '/confidentialite'">Confidentialité</a>
        }
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
  mode = signal<Mode>("login");
  modes = ["login", "activate", "signup"] as const;
  tabLabel: Record<Mode, string> = {
    login: FR.login,
    activate: FR.haveCode,
    signup: FR.signup,
  };
  loginWith = signal<"phone" | "email">("phone");
  /** "J'ai un code" as a member of the school staff (Équipe) instead of a student. */
  staff = signal(false);
  step = signal(1);
  showPassword = signal(false);
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
    password: ["", [Validators.required, Validators.minLength(MIN_PASSWORD)]],
    phone: [""],
    category: [""],
    group: [""],
    code: [""],
  });
  constructor() {
    void this.api
      .request<{ turnstileSiteKey: string }>("/config")
      .then((x) => (this.siteKey = x.turnstileSiteKey))
      .catch(() => {});
    // A message about the previous attempt goes away as soon as the user edits.
    this.form.valueChanges.subscribe(() => {
      if (this.error() && !this.busy()) this.error.set("");
    });
    // Links sent by the desk: /s/<school>/activation?code=482913&tel=6XXXXXXXX
    const params = new URLSearchParams(location.search);
    if (location.pathname.endsWith("/inscription")) this.mode.set("signup");
    if (location.pathname.endsWith("/activation") || params.get("code")) {
      this.mode.set("activate");
      // Links from the Équipe page: ?staff=1&email=…
      this.staff.set(params.get("staff") === "1");
      this.form.patchValue({
        code: params.get("code") || "",
        phone: params.get("tel") || "",
        email: params.get("email") || "",
      });
    }
    void this.api
      .catalogue()
      .then((x) => this.catalogue.set(x))
      .catch(() => this.error.set(this.t.error));
  }
  phoneValue() {
    return normalizePhone(this.form.controls.phone.value);
  }
  submitLabel() {
    if (this.mode() === "login") return this.t.login;
    if (this.mode() === "activate") return this.t.activate;
    return this.step() < 3 ? this.t.next : this.t.activate;
  }
  setMode(m: Mode) {
    this.mode.set(m);
    this.step.set(1);
    this.showPassword.set(false);
    this.error.set("");
  }
  setLoginWith(way: "phone" | "email") {
    this.loginWith.set(way);
    this.showPassword.set(false);
    this.error.set("");
  }
  ngAfterViewInit() {
    this.timer = setInterval(() => this.renderCaptcha(), 500);
  }
  renderCaptcha() {
    if (this.mode() !== "signup" || this.step() !== 3 || !this.captcha()) return;
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
    const phone = this.phoneValue();
    const mode = this.mode();

    // Validate before any network call, with a message that says what to fix.
    if (mode === "login") {
      if (this.loginWith() === "phone" ? !PHONE.test(phone) : this.form.controls.email.invalid)
        return this.error.set(
          this.loginWith() === "phone" ? this.t.phoneInvalid : this.t.loginEmailInvalid,
        );
      if (!v.password) return this.error.set(this.t.loginPasswordMissing);
    } else if (mode === "activate" && this.staff()) {
      if (this.form.controls.email.invalid) return this.error.set(this.t.loginEmailInvalid);
      if (v.code.replace(/[^A-Za-z0-9]/g, "").length < 6)
        return this.error.set(this.t.activationCodeInvalid);
      if (!v.password) return this.error.set(this.t.loginPasswordMissing);
    } else if (mode === "activate") {
      if (!PHONE.test(phone)) return this.error.set(this.t.phoneInvalid);
      if (v.code.replace(/[^A-Za-z0-9]/g, "").length < 6)
        return this.error.set(this.t.activationCodeInvalid);
      if (v.password.length < MIN_PASSWORD) return this.error.set(this.t.passwordRule);
    } else if (this.step() < 3) {
      if (this.step() === 1) {
        if (v.name.trim().length < 2) return this.error.set(this.t.nameRequired);
        if (this.form.controls.email.invalid) return this.error.set(this.t.loginEmailInvalid);
        if (v.password.length < MIN_PASSWORD) return this.error.set(this.t.passwordRule);
      } else {
        if (!PHONE.test(phone)) return this.error.set(this.t.phoneInvalid);
        if (!v.group) return this.error.set(this.t.groupRequired);
      }
      this.step.update((n) => n + 1);
      return;
    }

    this.busy.set(true);
    try {
      if (mode === "login") {
        if (this.loginWith() === "phone") await this.auth.loginWithPhone(phone, v.password);
        else await this.auth.login(v.email, v.password);
      } else if (mode === "activate" && this.staff()) {
        await this.auth.activateStaff(v.email, v.code, v.password, v.name);
      } else if (mode === "activate") {
        await this.auth.activate(phone, v.code, v.password);
      } else {
        if (!this.auth.user()) {
          if (!this.token) throw new Error("TURNSTILE_REQUIRED");
          await this.auth.signup(v.name, v.email, v.password, this.token);
          await this.auth.openSchool(this.api.slug, true);
        }
        await this.api.tenant("enroll", "POST", {
          groupId: v.group,
          fullName: v.name,
          phone,
        });
        await this.auth.openSchool(this.api.slug, true);
      }
      if (!this.auth.role()) {
        if (mode === "login") this.error.set(this.t.loginNoMembership);
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
    } catch (e) {
      this.error.set(this.errorMessage(e, mode));
      // A Turnstile token is single-use: get a fresh one before the next try.
      if (mode === "signup" && this.widget) {
        this.token = "";
        window.turnstile?.reset(this.widget);
      }
    } finally {
      this.busy.set(false);
    }
  }

  private errorMessage(e: unknown, mode: Mode) {
    if (e instanceof Error && e.message === "TURNSTILE_REQUIRED")
      // Widget shown but not finished yet: ask to wait, not to call the school.
      return this.widget ? this.t.captchaPending : this.t.captchaUnavailable;
    if (!(e instanceof RequestError)) return this.t.networkError;
    if (e.code === "LOGIN_LOCKED") return this.t.loginLocked;
    if (e.status === 429) return this.t.loginRateLimited;
    if (e.status === 403 && e.code === "ORIGIN_FORBIDDEN") return this.t.loginOriginRejected;
    if (e.code === "TURNSTILE_UNAVAILABLE") return this.t.captchaUnavailableRetry;
    if (e.status >= 500) return this.t.loginServerError;
    if (mode === "activate" && this.staff()) {
      if (e.status === 401) return this.t.staffExistingPassword;
      if (e.code === "STAFF_EMAIL_IS_STUDENT") return this.t.staffEmailIsStudent;
      if (e.code === "INVALID_INVITE" || e.status === 400) return this.t.staffActivationInvalid;
    }
    if (mode === "activate" && (e.code === "INVALID_INVITE" || e.status === 400))
      return this.t.activationInvalid;
    if (mode === "login" && (e.status === 401 || e.code === "INVALID_EMAIL_OR_PASSWORD"))
      return this.loginWith() === "phone" ? this.t.phoneLoginInvalid : this.t.loginInvalid;
    if (e.code === "PHONE_ALREADY_REGISTERED") return this.t.phoneTaken;
    if (mode === "signup") {
      if (e.code?.startsWith("USER_ALREADY_EXISTS") || e.status === 422) return this.t.emailTaken;
      if (e.code === "TURNSTILE_FAILED" || e.code === "TURNSTILE_REQUIRED") return this.t.captchaFailed;
      if (e.code === "STUDENT_ALREADY_REGISTERED") return this.t.alreadyStudent;
      if (e.code === "GROUP_FULL") return this.t.groupFull;
      if (e.code?.startsWith("PASSWORD_TOO")) return this.t.passwordRule;
    }
    if (e.status === 403 && mode === "login") return this.t.loginOriginRejected;
    return this.t.conflict;
  }

  async requestReset() {
    if (this.form.controls.email.invalid) {
      this.error.set(this.t.loginEmailInvalid);
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
