import { Component, inject } from "@angular/core";
import { FormControl, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { FR } from "../core/fr";
import { IconComponent } from "../shared/ui";
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IconComponent],
  template: `<main id="main" class="auth-page">
    <section class="auth-brand">
      <app-icon name="directions_car" />
      <h1>{{ t.app }}</h1>
      <p>{{ t.brand }}</p>
    </section>
    <section class="card">
      <h2>{{ t.schoolAccess }}</h2>
      <form (submit)="open($event)">
        <label
          >{{ t.schoolCode
          }}<input
            [formControl]="slug"
            autocomplete="organization"
            placeholder="mon-ecole" /></label
        ><button class="btn full" [disabled]="slug.invalid">
          {{ t.selectSchool }}<app-icon name="arrow_forward" />
        </button>
      </form>
    </section>
  </main>`,
})
export class LandingComponent {
  t = FR;
  router = inject(Router);
  slug = new FormControl("", {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.pattern(/^[a-z0-9][a-z0-9-]{1,62}$/),
    ],
  });
  open(e: Event) {
    e.preventDefault();
    if (this.slug.valid)
      void this.router.navigate(["/s", this.slug.value, "connexion"]);
  }
}
