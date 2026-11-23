import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
import { WhatsAppService } from "../core/whatsapp.service";
import { FR } from "../core/fr";
import type { Group } from "../core/models";
import { IconComponent } from "../shared/ui";
import { MoneyPipe } from "../shared/money.pipe";

/**
 * Public page of one school (/s/<school>): what a visitor, a search engine or a
 * WhatsApp link shows first. The Worker pre-renders the same information for
 * crawlers; this component is the interactive version.
 */
@Component({
  standalone: true,
  imports: [RouterLink, IconComponent, MoneyPipe],
  template: `@if (auth.school(); as s) {
    <section class="auth-brand">
      @if (s.logo) {
        <img class="school-logo" [src]="s.logo" alt="" width="72" height="72" />
      }
      <span class="eyebrow">{{ t.drivingSchool }}</span>
      <h1>{{ s.name }}</h1>
      @if (s.address) {
        <p><app-icon name="location_on" /> {{ s.address }}</p>
      }
    </section>
    <section class="card">
      @if (auth.role()) {
        <a class="btn full" [routerLink]="base() + (auth.role() === 'admin' ? '/admin' : '/accueil')"
          >{{ t.openMySpace }}<app-icon name="arrow_forward"
        /></a>
      } @else {
        <a class="btn full" [routerLink]="base() + '/inscription'"
          >{{ t.enrollOnline }}<app-icon name="arrow_forward"
        /></a>
        <div class="actions">
          <a class="btn secondary" [routerLink]="base() + '/connexion'">{{ t.login }}</a>
          <a class="btn secondary" [routerLink]="base() + '/activation'">{{ t.haveCode }}</a>
        </div>
      }
      @if (contact()) {
        <button class="btn ghost full" type="button" (click)="whatsapp()">
          <app-icon name="chat" />{{ t.askSchool }}
        </button>
      }
    </section>
    @if (groups().length) {
      <section class="card">
        <h2>{{ t.trainings }}</h2>
        @for (g of groups(); track g.id) {
          <div class="list-row">
            <div class="grow">
              <strong>{{ g.licence_name }} · {{ g.name }}</strong>
              @if (g.schedule_text) {
                <p>{{ g.schedule_text }}</p>
              }
            </div>
            <strong>{{ g.total_fee | fcfa }}</strong>
          </div>
        }
      </section>
    }
    <p class="muted" style="text-align:center">{{ t.trialInfo }}</p>
  }`,
})
export class SchoolHomeComponent implements OnInit {
  t = FR;
  auth = inject(AuthService);
  api = inject(ApiService);
  wa = inject(WhatsAppService);
  groups = signal<Group[]>([]);
  base = computed(() => "/s/" + this.api.slug);
  contact = computed(() => this.auth.school()?.whatsapp || this.auth.school()?.phone || "");

  async ngOnInit() {
    try {
      this.groups.set((await this.api.catalogue()).groups);
    } catch {
      /* the page still offers sign-up and login without the price list */
    }
  }

  whatsapp() {
    this.wa.open(this.contact(), `Bonjour ${this.auth.school()?.name}, je souhaite des informations sur l’inscription au permis.`);
  }
}
