import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { ApiService } from "../core/api.service";
import { FR } from "../core/fr";
@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `<section class="card narrow">
    <h1>{{ t.resetPassword }}</h1>
    <form [formGroup]="form" (ngSubmit)="save()">
      <label
        >{{ t.password
        }}<input
          type="password"
          formControlName="password"
          autocomplete="new-password"
      /></label>
      @if (error()) {
        <p class="error-box" role="alert">{{ t.conflict }}</p>
      }
      <button class="btn full" [disabled]="form.invalid || busy()">
        {{ t.save }}
      </button>
    </form>
  </section>`,
})
export class RecoveryComponent {
  t = FR;
  api = inject(ApiService);
  route = inject(ActivatedRoute);
  router = inject(Router);
  fb = inject(FormBuilder);
  busy = signal(false);
  error = signal(false);
  form = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.minLength(12)]],
  });
  async save() {
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      await this.api.request("/auth/reset-password", "POST", {
        token: this.route.snapshot.queryParamMap.get("token"),
        newPassword: this.form.controls.password.value,
      });
      await this.router.navigate(["/s", this.api.slug, "connexion"]);
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
