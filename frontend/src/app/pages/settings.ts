import { Component, OnDestroy, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { FR } from "../core/fr";
import { IconComponent } from "../shared/ui";
import { PRESETS, applyTheme, isHex, mix, themeVariables } from "../core/theme";

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent],
  template: `<h1>{{ t.settings }}</h1>
    <form [formGroup]="form" (ngSubmit)="save()" class="narrow">
      <section class="card">
        <h2>{{ t.schoolInfo }}</h2>
        <label>{{ t.schoolName }}<input formControlName="name" /></label
        ><label>{{ t.address }}<input formControlName="address" /></label>
        <div class="grid-two">
          <label
            >{{ t.schoolPhone
            }}<input formControlName="phone" type="tel" placeholder="+2376XXXXXXXX" /></label
          ><label
            >{{ t.schoolWhatsapp
            }}<input formControlName="whatsapp" type="tel" placeholder="+2376XXXXXXXX"
          /></label>
        </div>
        <label>{{ t.agreement }}<input formControlName="agreement" /></label>
      </section>

      <section class="card">
        <h2>{{ t.schoolLogo }}</h2>
        <p class="muted">{{ t.schoolLogoHelp }}</p>
        <div class="logo-editor">
          <div class="logo-preview" [class.empty]="!logo()">
            @if (logo()) {
              <img [src]="logo()" alt="" />
            } @else {
              <app-icon name="add_photo_alternate" />
            }
          </div>
          <div class="grow">
            <label class="btn secondary logo-pick">
              <app-icon name="upload" />{{ logo() ? t.changeLogo : t.addLogo }}
              <input type="file" accept="image/png,image/jpeg,image/webp" (change)="pickLogo($event)" [disabled]="logoBusy() || !api.online()" />
            </label>
            @if (logo()) {
              <button type="button" class="btn ghost" [disabled]="logoBusy() || !api.online()" (click)="removeLogo()">
                <app-icon name="delete" />{{ t.removeLogo }}
              </button>
            }
            @if (logoBusy()) {
              <p role="status" class="muted">{{ t.loading }}</p>
            }
            @if (logoError()) {
              <p class="error-box" role="alert">{{ logoError() }}</p>
            }
          </div>
        </div>
      </section>

      <section class="card">
        <h2>{{ t.schoolColors }}</h2>
        <p class="muted">{{ t.schoolColorsHelp }}</p>
        <div class="palette-grid" role="list">
          @for (p of presets; track p.id) {
            <button
              type="button"
              role="listitem"
              class="palette"
              [class.selected]="isPreset(p)"
              [attr.aria-pressed]="isPreset(p)"
              (click)="pick(p.primary, p.accent)"
            >
              <i [style.background]="swatch(p.primary, p.accent)"></i>{{ p.name }}
            </button>
          }
        </div>
        <div class="grid-two">
          <label
            >{{ t.primary }}<input type="color" formControlName="primary" (input)="preview()"
          /></label>
          <label
            >{{ t.accent }}<input type="color" formControlName="accent" (input)="preview()"
          /></label>
        </div>
        <div class="theme-preview" [attr.aria-label]="t.themePreview">
          <div class="hero" [style.background]="gradient(form.value.primary!, form.value.accent!)" [style.color]="vars()['--on-primary']">
            <span class="eyebrow" style="color: inherit; opacity: 0.85">{{ t.themePreview }}</span>
            <strong>{{ form.value.name }}</strong>
          </div>
          <div class="body">
            <span class="pill" [style.background]="gradient(form.value.primary!, form.value.accent!, false)" [style.color]="vars()['--on-primary']">{{ t.enrollOnline }}</span>
            <span class="pill" [style.background]="form.value.accent" [style.color]="vars()['--on-accent']">{{ t.trial }}</span>
            <strong [style.color]="vars()['--primary-ink']">150 000 FCFA</strong>
          </div>
        </div>
        @if (adjusted()) {
          <p class="muted"><app-icon name="contrast" /> {{ t.colorAdjusted }}</p>
        }
      </section>

      @if (error()) {
        <p class="error-box" role="alert">{{ t.error }}</p>
      }
      @if (saved()) {
        <p class="inset" role="status"><app-icon name="check_circle" /> {{ t.settingsSaved }}</p>
      }
      <button class="btn full" [disabled]="busy() || form.invalid || !api.online()">
        {{ busy() ? t.loading : t.save }}
      </button>
    </form>`,
})
export class SettingsComponent implements OnDestroy {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  fb = inject(FormBuilder);
  presets = PRESETS;
  busy = signal(false);
  error = signal(false);
  saved = signal(false);
  s = this.auth.school()!;
  logo = signal<string | null>(this.s.logo);
  logoBusy = signal(false);
  logoError = signal("");
  form = this.fb.nonNullable.group({
    name: [this.s.name, [Validators.required, Validators.minLength(2)]],
    address: [this.s.address],
    phone: [this.s.phone],
    whatsapp: [this.s.whatsapp],
    agreement: [this.s.agrement_number],
    primary: [this.s.colors.primary, Validators.pattern(/^#[0-9a-fA-F]{6}$/)],
    accent: [this.s.colors.accent, Validators.pattern(/^#[0-9a-fA-F]{6}$/)],
  });

  vars() {
    return themeVariables({ primary: this.form.value.primary, accent: this.form.value.accent });
  }

  /** True when the chosen primary color was too light for text and had to be darkened. */
  adjusted() {
    const v = this.vars();
    return isHex(this.form.value.primary) && v["--primary-ink"] !== v["--primary"];
  }

  /** Same recipe as --gradient-brand in styles.css, with the accent as a glow. */
  gradient(primary: string, accent: string, glow = true) {
    if (!isHex(primary) || !isHex(accent)) return "";
    const base = `linear-gradient(135deg, ${mix(primary, "#000000", 0.18)} 0%, ${primary} 58%, ${mix(primary, "#ffffff", 0.2)} 100%)`;
    return glow ? `radial-gradient(circle at 105% -10%, ${accent}80 0, transparent 45%), ${base}` : base;
  }

  /** Palette swatch: both colors side by side. */
  swatch(primary: string, accent: string) {
    return `linear-gradient(135deg, ${primary} 0 62%, ${accent} 62% 100%)`;
  }

  isPreset(p: { primary: string; accent: string }) {
    return (
      this.form.value.primary?.toLowerCase() === p.primary && this.form.value.accent?.toLowerCase() === p.accent
    );
  }

  pick(primary: string, accent: string) {
    this.form.patchValue({ primary, accent });
    this.preview();
  }

  /** Live preview on the whole app; reverted on leave if not saved. */
  preview() {
    this.saved.set(false);
    applyTheme({ primary: this.form.value.primary, accent: this.form.value.accent });
  }

  /** Resize in the browser to a 512 px square (transparent padding), then upload. */
  async pickLogo(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    this.logoError.set("");
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return this.logoError.set(this.t.logoTypeInvalid);
    if (file.size > 15 * 1024 * 1024) return this.logoError.set(this.t.logoTooLarge);
    this.logoBusy.set(true);
    try {
      const dataUrl = await toSquareLogo(file);
      const r = await this.api.tenant<{ logo: string }>("admin/settings/logo", "PUT", { dataUrl });
      this.logo.set(r.logo);
      await this.auth.openSchool(this.api.slug, true);
    } catch (err) {
      this.logoError.set(err instanceof Error && err.message === "IMAGE_UNREADABLE" ? this.t.logoTypeInvalid : this.t.error);
    } finally {
      this.logoBusy.set(false);
    }
  }

  async removeLogo() {
    this.logoBusy.set(true);
    this.logoError.set("");
    try {
      await this.api.tenant("admin/settings/logo", "DELETE");
      this.logo.set(null);
      await this.auth.openSchool(this.api.slug, true);
    } catch {
      this.logoError.set(this.t.error);
    } finally {
      this.logoBusy.set(false);
    }
  }

  ngOnDestroy() {
    applyTheme(this.auth.school()?.colors);
  }

  async save() {
    this.busy.set(true);
    this.error.set(false);
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
      await this.auth.openSchool(this.api.slug, true);
      this.saved.set(true);
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Draws the image centered in a transparent 512x512 square; WebP when possible, under 300 KB. */
async function toSquareLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("IMAGE_UNREADABLE"));
      i.src = url;
    });
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale,
      h = img.naturalHeight * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    for (const q of [0.92, 0.8, 0.65]) {
      const webp = canvas.toDataURL("image/webp", q);
      if (webp.startsWith("data:image/webp") && webp.length * 0.75 < 300 * 1024) return webp;
    }
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
