import { Component, OnInit, inject, signal } from "@angular/core";
import { FormControl, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { FR } from "../core/fr";
import { ApiService } from "../core/api.service";
import { IconComponent } from "../shared/ui";
import { forgetSchool, isSlug, rememberedSchool, slugify } from "../core/school-memory";

/**
 * Home page. Nobody should have to know a technical school code:
 * 1. a school opened before on this device is reopened directly;
 * 2. otherwise the deployment's default school (DEFAULT_SCHOOL) opens directly;
 * 3. only then do we ask, and the school's name can be typed as written.
 */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent],
  template: `<main id="main" class="auth-page">
    <section class="auth-brand">
      <app-icon name="directions_car" />
      <h1>{{ t.app }}</h1>
      <p>{{ t.brand }}</p>
    </section>
    @if (checking()) {
      <section class="card"><p role="status">{{ t.loading }}</p></section>
    } @else {
      <section class="card">
        <h2>{{ t.schoolAccess }}</h2>
        <p class="muted">{{ t.schoolNameHelp }}</p>
        <form (submit)="open($event)">
          <label
            >{{ t.landingSchoolName
            }}<input
              [formControl]="name"
              autocomplete="organization"
              placeholder="La Marseillaise" /></label
          >
          @if (notFound()) {
            <p class="error-box" role="alert">{{ t.schoolNotFoundHelp }}</p>
          }
          <button class="btn full" [disabled]="name.invalid || opening()" [attr.aria-busy]="opening()">
            {{ opening() ? t.loading : t.selectSchool }}<app-icon name="arrow_forward" />
          </button>
        </form>
      </section>
    }
  </main>`,
})
export class LandingComponent implements OnInit {
  t = FR;
  router = inject(Router);
  api = inject(ApiService);
  checking = signal(true);
  opening = signal(false);
  notFound = signal(false);
  name = new FormControl("", { nonNullable: true, validators: [Validators.required] });

  async ngOnInit() {
    // ?changer=1 lets someone pick another school instead of being sent back.
    const choosing = new URLSearchParams(location.search).has("changer");
    if (choosing) forgetSchool();
    const remembered = choosing ? null : rememberedSchool();
    if (remembered) return this.go(remembered);
    try {
      const config = await this.api.request<{ defaultSchool?: string | null }>("/config");
      if (!choosing && isSlug(config.defaultSchool)) return this.go(config.defaultSchool);
    } catch {
      /* offline or API down: let the person type the school */
    }
    this.checking.set(false);
  }

  private async go(slug: string) {
    await this.router.navigate(["/s", slug, "connexion"], { replaceUrl: true });
  }

  async open(e: Event) {
    e.preventDefault();
    const slug = slugify(this.name.value);
    if (!isSlug(slug) || this.opening()) {
      this.notFound.set(true);
      return;
    }
    this.opening.set(true);
    this.notFound.set(false);
    try {
      // Check the school exists before leaving the page, so a typo gets a clear message.
      await this.api.request(`/schools/${encodeURIComponent(slug)}/catalogue`);
      await this.go(slug);
    } catch {
      this.notFound.set(true);
    } finally {
      this.opening.set(false);
    }
  }
}
