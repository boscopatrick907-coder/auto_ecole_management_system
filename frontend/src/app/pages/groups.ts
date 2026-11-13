import { Component, inject, signal, OnInit } from "@angular/core";
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormArray,
} from "@angular/forms";
import { ApiService } from "../core/api.service";
import { DataService } from "../core/data.service";
import { FR } from "../core/fr";
import { MoneyPipe } from "../shared/money.pipe";
import { BadgeComponent, EmptyComponent, IconComponent } from "../shared/ui";
import type { Group, Category } from "../core/models";
@Component({
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MoneyPipe,
    BadgeComponent,
    EmptyComponent,
    IconComponent,
  ],
  template: `<div class="page-heading">
      <h1>{{ t.groups }}</h1>
      <button class="btn" [disabled]="loading()" (click)="creating.set(!creating())">
        <app-icon name="add" />{{ t.newGroup }}
      </button>
    </div>
    @if (error()) {
      <p role="alert" class="error-box">{{ t.conflict }}</p>
    }
    @if (loading()) {
      <p role="status">{{ groups().length ? t.refreshing : t.loading }}</p>
    }
    @if (creating()) {
      <section class="card">
        <form [formGroup]="form" (ngSubmit)="create()">
          <div class="grid-two">
            <label>{{ t.name }}<input formControlName="name" /></label
            ><label
              >{{ t.licence
              }}<select formControlName="category">
                <option value="">{{ t.choose }}</option>
                @for (c of categories(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select></label
            ><label>{{ t.schedule }}<input formControlName="schedule" /></label
            ><label
              >{{ t.dateStart
              }}<input formControlName="start" type="date" /></label
            ><label
              >{{ t.capacity
              }}<input
                formControlName="capacity"
                type="number"
                min="1" /></label
            ><label
              >{{ t.total
              }}<input formControlName="total" type="number" min="1"
            /></label>
          </div>
          <h3>{{ t.fees }}</h3>
          <div formArrayName="installments">
            @for (i of installments.controls; track i; let index = $index) {
              <div [formGroupName]="index" class="installment-form">
                <label>{{ t.name }}<input formControlName="label" /></label
                ><label
                  >{{ t.amount
                  }}<input
                    formControlName="amount"
                    type="number"
                    min="1" /></label
                ><label
                  >{{ t.date
                  }}<input formControlName="dueDate" type="date" /></label
                ><button
                  type="button"
                  class="btn ghost"
                  [disabled]="installments.length === 1"
                  (click)="installments.removeAt(index)"
                >
                  {{ t.cancel }}
                </button>
              </div>
            }
          </div>
          <div class="actions">
            <button type="button" class="btn secondary" (click)="add()">
              {{ t.nextInstallment }}</button
            ><button
              class="btn"
              [disabled]="form.invalid || busy() || !api.online()"
            >
              {{ t.save }}
            </button>
          </div>
        </form>
      </section>
    }
    <div class="grid-two">
      @for (g of groups(); track g.id) {
        <article class="card">
          <div class="row between">
            <span class="feature-icon"><app-icon name="groups" /></span
            ><app-badge
              [kind]="g.status === 'open' ? 'paid' : 'upcoming'"
              [label]="g.status"
            />
          </div>
          <h2>{{ g.name }}</h2>
          <p>{{ g.licence_name }} · {{ g.schedule_text }}</p>
          <p>{{ g.total_fee | fcfa }}</p>
          <progress [value]="g.confirmed_seats" [max]="g.capacity"></progress>
          <p>{{ g.confirmed_seats }} / {{ g.capacity }} · {{ t.capacity }}</p>
          <button
            class="btn secondary full"
            [disabled]="!api.online() || loading()"
            (click)="toggle(g)"
          >
            {{ g.status === "open" ? t.close : t.open }}
          </button>
        </article>
      } @empty {
        @if (!loading() && !error()) { <app-empty /> }
      }
    </div>`,
})
export class GroupsComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  store = inject(DataService);
  fb = inject(FormBuilder);
  groups = signal<Group[]>([]);
  categories = signal<Category[]>([]);
  creating = signal(false);
  busy = signal(false);
  error = signal(false);
  loading = signal(true);
  private loadVersion = 0;
  form = this.fb.nonNullable.group({
    name: ["", [Validators.required, Validators.minLength(2)]],
    category: ["", Validators.required],
    schedule: [""],
    start: ["", Validators.required],
    capacity: [20, [Validators.min(1), Validators.max(1000)]],
    total: [0, [Validators.min(1)]],
    installments: this.fb.array<ReturnType<GroupsComponent["newInstallment"]>>(
      [],
    ),
  });
  get installments() {
    return this.form.controls.installments;
  }
  newInstallment() {
    return this.fb.nonNullable.group({
      label: ["", Validators.required],
      amount: [0, Validators.min(1)],
      dueDate: ["", Validators.required],
    });
  }
  add() {
    this.installments.push(this.newInstallment());
  }
  ngOnInit() {
    this.add();
    void this.load();
  }
  async load() {
    const version = ++this.loadVersion;
    this.loading.set(true);
    try {
      const [r, catalogue] = await Promise.all([
        this.store.read("groups", () => this.api.groups(), (cached) => {
          if (version === this.loadVersion) this.groups.set(cached?.groups || []);
        }),
        this.api.catalogue(),
      ]);
      if (version !== this.loadVersion) return;
      this.groups.set(r?.groups || []);
      this.categories.set(catalogue.categories);
      this.error.set(false);
    } catch {
      if (version !== this.loadVersion) return;
      this.error.set(true);
    } finally {
      if (version === this.loadVersion) this.loading.set(false);
    }
  }
  async create() {
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      const v = this.form.getRawValue();
      await this.api.tenant("admin/groups", "POST", {
        name: v.name,
        licenceCategoryId: v.category,
        scheduleText: v.schedule,
        startDate: v.start,
        capacity: v.capacity,
        totalFee: v.total,
        installments: v.installments,
      });
      this.creating.set(false);
      await this.load();
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
  async toggle(g: Group) {
    try {
      await this.api.tenant("admin/groups/" + g.id, "PATCH", {
        status: g.status === "open" ? "closed" : "open",
      });
      await this.load();
    } catch {
      this.error.set(true);
    }
  }
}
