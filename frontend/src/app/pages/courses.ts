import { Component, inject, signal, OnInit, OnDestroy } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";
import { DataService } from "../core/data.service";
import { FR } from "../core/fr";
import { BadgeComponent, IconComponent, EmptyComponent } from "../shared/ui";
import type { Resource } from "../core/models";
@Component({
  standalone: true,
  imports: [RouterLink, BadgeComponent, IconComponent, EmptyComponent],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">{{ auth.school()?.name }}</span>
        <h1>{{ t.courses }}</h1>
      </div>
      <app-icon name="menu_book" />
    </div>
    @if (denied()) {
      <section class="card">
        <h2>{{ t.accessCheck }}</h2>
        <a class="btn" [routerLink]="'/s/' + api.slug + '/acces-expire'">{{
          t.open
        }}</a>
      </section>
    } @else {
      <div class="grid-two">
        @for (r of resources(); track r.id) {
          <article class="card course-card">
            <div class="course-art">
              <app-icon
                [name]="r.type === 'video' ? 'play_circle' : 'menu_book'"
              /><span>{{ r.type.toUpperCase() }}</span>
            </div>
            <div class="row between">
              <h2>{{ r.title }}</h2>
              @if (saved()[r.id]) {
                <app-badge kind="paid" [label]="t.saved" />
              }
            </div>
            <p>{{ r.description }}</p>
            <div class="actions">
              <button
                class="btn"
                [disabled]="busy() === r.id"
                (click)="open(r)"
              >
                {{ t.open }}</button
              ><button
                class="btn secondary"
                [disabled]="busy() === r.id || !api.online()"
                (click)="download(r)"
              >
                <app-icon name="download" />{{ t.download }}
              </button>
              @if (saved()[r.id]) {
                <button class="btn ghost" (click)="remove(r)">
                  {{ t.deleted }}
                </button>
              }
            </div>
          </article>
        } @empty {
          <app-empty />
        }
      </div>
    }
    @if (error()) {
      <p class="error-box" role="alert">{{ t.downloadError }}</p>
    }`,
})
export class CoursesComponent implements OnInit, OnDestroy {
  t = FR;
  auth = inject(AuthService);
  api = inject(ApiService);
  store = inject(DataService);
  resources = signal<Resource[]>([]);
  saved = signal<Record<string, boolean>>({});
  denied = signal(false);
  error = signal(false);
  busy = signal("");
  urls: string[] = [];
  async ngOnInit() {
    try {
      if (this.api.online()) await this.auth.refreshLease();
      if (!(await this.auth.offlineAllowed())) {
        this.denied.set(true);
        return;
      }
      const data = await this.store.read("resources", () =>
        this.api.resources(),
      );
      this.resources.set(data?.resources || []);
      await this.refresh();
    } catch {
      this.error.set(true);
    }
  }
  async refresh() {
    const saved: Record<string, boolean> = {};
    for (const r of this.resources())
      saved[r.id] = await this.store.saved(r.id);
    this.saved.set(saved);
  }
  async open(r: Resource) {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    this.busy.set(r.id);
    try {
      const url = await this.store.file(r.id);
      this.urls.push(url);
      if (tab) tab.location.href = url;
    } catch {
      tab?.close();
      this.error.set(true);
    } finally {
      this.busy.set("");
    }
  }
  async download(r: Resource) {
    this.busy.set(r.id);
    try {
      const url = await this.store.file(r.id, true);
      URL.revokeObjectURL(url);
      await this.refresh();
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set("");
    }
  }
  async remove(r: Resource) {
    await this.store.remove(r.id);
    await this.refresh();
  }
  ngOnDestroy() {
    for (const u of this.urls) URL.revokeObjectURL(u);
  }
}
