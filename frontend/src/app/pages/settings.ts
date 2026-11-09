import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { FR } from "../core/fr";
@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `<h1>{{ t.settings }}</h1>
    <section class="card narrow">
      <form [formGroup]="form" (ngSubmit)="save()">
        <label>{{ t.schoolName }}<input formControlName="name" /></label
        ><label>{{ t.address }}<input formControlName="address" /></label
        ><label>{{ t.phone }}<input formControlName="phone" /></label
        ><label>{{ t.whatsapp }}<input formControlName="whatsapp" /></label
        ><label>{{ t.agreement }}<input formControlName="agreement" /></label>
        <div class="grid-two">
          <label
            >{{ t.primary
            }}<input type="color" formControlName="primary" /></label
          ><label
            >{{ t.accent }}<input type="color" formControlName="accent"
          /></label>
        </div>
        @if (error()) {
          <p class="error-box" role="alert">{{ t.error }}</p>
        }
        <button
          class="btn full"
          [disabled]="busy() || form.invalid || !api.online()"
        >
          {{ t.save }}
        </button>
      </form>
    </section>`,
})
export class SettingsComponent {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  fb = inject(FormBuilder);
  busy = signal(false);
  error = signal(false);
  s = this.auth.school()!;
  form = this.fb.nonNullable.group({
    name: [this.s.name, [Validators.required, Validators.minLength(2)]],
    address: [this.s.address],
    phone: [this.s.phone],
    whatsapp: [this.s.whatsapp],
    agreement: [this.s.agrement_number],
    primary: [this.s.colors.primary],
    accent: [this.s.colors.accent],
  });
  async save() {
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      await this.api.tenant("admin/settings", "PATCH", {
        name: v.name,
        address: v.address,
        phone: v.phone,
        whatsapp: v.whatsapp,
        agrement_number: v.agreement,
        colors: { primary: v.primary, accent: v.accent },
      });
      await this.auth.openSchool(this.api.slug);
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
