import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { FR } from "../core/fr";
import { ApiService } from "../core/api.service";
import { IconComponent, SkeletonComponent } from "../shared/ui";
import { forgetSchool, rememberedSchool, slugify } from "../core/school-memory";

interface DirectorySchool {
  slug: string;
  name: string;
  address: string | null;
  logo: string | null;
}

/**
 * Public home page: the list of partner schools (also pre-rendered by the
 * Worker for search engines). Nobody types a technical code: people pick their
 * school by name, and the school opened last on this device is offered first.
 */
@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, SkeletonComponent],
  template: `<main id="main" class="auth-page">
    <section class="auth-brand">
      <img class="app-logo" src="aem-icon.svg" alt="" width="64" height="64" />
      <h1>{{ t.app }}</h1>
      <p>{{ t.directoryIntro }}</p>
    </section>
    @if (remembered(); as r) {
      <section class="card">
        <a class="btn full" [routerLink]="['/s', r.slug]"
          >{{ t.continueWith }} {{ r.name || r.slug }}<app-icon name="arrow_forward"
        /></a>
      </section>
    }
    <section class="card">
      <h2>{{ t.findSchool }}</h2>
      <label
        >{{ t.landingSchoolName
        }}<input
          [(ngModel)]="query"
          name="query"
          autocomplete="organization"
          placeholder="La Marseillaise"
      /></label>
      @if (loading()) {
        <app-skeleton variant="list" [count]="3" />
      } @else if (error()) {
        <p class="error-box" role="alert">{{ t.networkError }}</p>
      } @else {
        @for (s of filtered(); track s.slug) {
          <a class="list-row" [routerLink]="['/s', s.slug]">
            @if (s.logo) {
              <img class="list-logo" [src]="s.logo" alt="" width="44" height="44" />
            }
            <div class="grow">
              <strong>{{ s.name }}</strong>
              @if (s.address) {
                <p>{{ s.address }}</p>
              }
            </div>
            <app-icon name="chevron_right" />
          </a>
        } @empty {
          <p class="muted">{{ t.schoolNotFoundHelp }}</p>
        }
      }
    </section>
  </main>`,
})
export class LandingComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  schools = signal<DirectorySchool[]>([]);
  loading = signal(true);
  error = signal(false);
  query = "";
  private rememberedSlug = signal<string | null>(null);

  remembered = computed(() => {
    const slug = this.rememberedSlug();
    return slug ? (this.schools().find((s) => s.slug === slug) ?? { slug, name: "" }) : null;
  });

  filtered() {
    const q = slugify(this.query);
    return this.schools().filter((s) => !q || slugify(s.name).includes(q) || s.slug.includes(q));
  }

  async ngOnInit() {
    // ?changer=1 (from "Choisir une autre auto-école") forgets the last school.
    if (new URLSearchParams(location.search).has("changer")) forgetSchool();
    this.rememberedSlug.set(rememberedSchool());
    try {
      this.schools.set((await this.api.request<{ schools?: DirectorySchool[] }>("/schools")).schools ?? []);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
