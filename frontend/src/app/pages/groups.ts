import { Component, inject, signal, OnInit } from "@angular/core";
import { DatePipe } from "@angular/common";
import {
  ReactiveFormsModule,
  FormsModule,
  FormBuilder,
  Validators,
} from "@angular/forms";
import { ApiService, RequestError } from "../core/api.service";
import { DataService } from "../core/data.service";
import { WhatsAppService } from "../core/whatsapp.service";
import { FR } from "../core/fr";
import { MoneyPipe } from "../shared/money.pipe";
import {
  BadgeComponent,
  EmptyComponent,
  IconComponent,
  SkeletonComponent,
} from "../shared/ui";
import type { Group, Category, AdminAnnouncement } from "../core/models";

@Component({
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    DatePipe,
    MoneyPipe,
    BadgeComponent,
    EmptyComponent,
    IconComponent,
    SkeletonComponent,
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
    @if (loading() && !groups().length) {
      <app-skeleton variant="cards" [count]="3" />
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
              [label]="g.status === 'open' ? 'Ouvert' : g.status === 'closed' ? 'Fermé' : 'Terminé'"
            />
          </div>
          <h2>{{ g.name }}</h2>
          <p>{{ g.licence_name }} · {{ g.schedule_text }}</p>
          <p>{{ g.total_fee | fcfa }}</p>
          <progress [value]="g.confirmed_seats" [max]="g.capacity"></progress>
          <p>{{ g.confirmed_seats }} / {{ g.capacity }} · {{ t.capacity }}</p>

          <div class="row between" style="margin-top: 12px; gap: 8px">
            <button
              class="btn secondary small"
              style="flex: 1"
              [disabled]="!api.online() || loading() || busy()"
              (click)="toggle(g)"
            >
              {{ g.status === "open" ? t.close : t.open }}
            </button>
            <button
              class="btn ghost danger small"
              [disabled]="!api.online() || loading() || busy()"
              (click)="confirmDelete.set(confirmDelete() === g.id ? null : g.id); deleteErrorGroup.set(null)"
            >
              <app-icon name="delete" />{{ t.deleteGroup }}
            </button>
          </div>

          @if (confirmDelete() === g.id) {
            <div class="confirm-box danger">
              <p>{{ t.deleteGroupConfirm }}</p>
              <div class="confirm-box-actions">
                <button class="btn danger small" [disabled]="busy()" (click)="deleteGroup(g)">
                  {{ busy() ? t.deleting : t.yesDelete }}
                </button>
                <button class="btn secondary small" [disabled]="busy()" (click)="confirmDelete.set(null)">
                  {{ t.cancel }}
                </button>
              </div>
            </div>
          }

          @if (deleteErrorGroup() === g.id) {
            <div class="confirm-box">
              <p>{{ t.deleteGroupHasPayments }}</p>
              <button class="btn secondary small" (click)="toggle(g); deleteErrorGroup.set(null)">
                {{ t.closeGroupInstead }}
              </button>
            </div>
          }
        </article>
      } @empty {
        @if (!loading() && !error()) { <app-empty /> }
      }
    </div>

    <!-- Annonces aux groupes (Admin) -->
    <section class="card" style="margin-top: 32px">
      <div class="row between">
        <div>
          <h2>{{ t.groupAnnouncements }}</h2>
          <p class="muted small">Diffusez une annonce aux élèves d'un groupe ou de toute l'école.</p>
        </div>
        <button
          class="btn small"
          [disabled]="loading() || busy()"
          (click)="announcing.set(!announcing())"
        >
          <app-icon [name]="announcing() ? 'close' : 'campaign'" />
          {{ announcing() ? t.cancel : t.newAnnouncement }}
        </button>
      </div>

      @if (announcing()) {
        <form (submit)="postAnnouncement($event)" style="margin-top: 16px">
          <label>
            {{ t.announcementTarget }}
            <select [ngModel]="announcementGroupId()" (ngModelChange)="announcementGroupId.set($event)" name="targetGroup">
              <option value="">{{ t.allGroups }}</option>
              @for (g of groups(); track g.id) {
                <option [value]="g.id">{{ g.name }}</option>
              }
            </select>
          </label>
          <label>
            {{ t.announcementTitle }}
            <input
              [ngModel]="announcementTitle()"
              (ngModelChange)="announcementTitle.set($event)"
              name="title"
              required
              placeholder="Ex : Séance pratique ce samedi"
            />
          </label>
          <label>
            {{ t.announcementBody }}
            <textarea
              [ngModel]="announcementBody()"
              (ngModelChange)="announcementBody.set($event)"
              name="body"
              rows="3"
              required
              placeholder="Écrivez le message de l'annonce..."
            ></textarea>
          </label>
          @if (announcementError()) {
            <p class="error-box" role="alert">{{ t.announcementError }}</p>
          }
          <div class="actions">
            <button
              class="btn"
              type="submit"
              [disabled]="busy() || !announcementTitle().trim() || !announcementBody().trim() || !api.online()"
            >
              {{ busy() ? t.publishing : t.publish }}
            </button>
          </div>
        </form>
      }

      <div style="margin-top: 20px">
        @for (a of announcements(); track a.id) {
          <article class="announcement-card">
            <div class="row between">
              <span class="badge ghost">{{ a.group_name || t.allGroups }}</span>
              <span class="muted small">{{ a.created_at | date: "dd/MM/yyyy HH:mm" }}</span>
            </div>
            <h3>{{ a.title }}</h3>
            <p class="announcement-body">{{ a.body }}</p>
            <div class="announcement-actions">
              <span class="muted small">{{ a.read_count || 0 }} {{ t.readCount }}</span>
              <button class="btn small btn-wa" type="button" (click)="shareAnnouncementWhatsApp(a)">
                <app-icon name="chat" />{{ t.shareWhatsApp }}
              </button>
              <button
                class="btn small ghost danger"
                type="button"
                [disabled]="busy() || !api.online()"
                (click)="removeAnnouncement(a.id)"
              >
                <app-icon name="delete" />{{ t.deleteAnnouncement }}
              </button>
            </div>
          </article>
        } @empty {
          @if (!announcing()) {
            <p class="muted" style="text-align: center; padding: 16px 0">{{ t.noAnnouncements }}</p>
          }
        }
      </div>
    </section>`,
})
export class GroupsComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  store = inject(DataService);
  wa = inject(WhatsAppService);
  fb = inject(FormBuilder);
  groups = signal<Group[]>([]);
  categories = signal<Category[]>([]);
  creating = signal(false);
  busy = signal(false);
  error = signal(false);
  loading = signal(true);
  confirmDelete = signal<string | null>(null);
  deleteErrorGroup = signal<string | null>(null);

  announcements = signal<AdminAnnouncement[]>([]);
  announcing = signal(false);
  announcementGroupId = signal("");
  announcementTitle = signal("");
  announcementBody = signal("");
  announcementError = signal(false);

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
    void this.loadAnnouncements();
  }
  async load() {
    const version = ++this.loadVersion;
    this.loading.set(true);
    try {
      const [r, catalogue] = await Promise.all([
        this.store.read("groups", () => this.api.groups(), (cached) => {
          if (version === this.loadVersion) this.groups.set(cached?.groups || []);
        }),
        this.api.catalogue(true),
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

  async deleteGroup(g: Group) {
    this.busy.set(true);
    this.deleteErrorGroup.set(null);
    try {
      await this.api.deleteGroup(g.id);
      this.confirmDelete.set(null);
      this.groups.set(this.groups().filter((x) => x.id !== g.id));
      await this.load();
    } catch (e: unknown) {
      if (
        (e instanceof RequestError && e.status === 409) ||
        (typeof e === "object" && e !== null && "status" in e && (e as { status: number }).status === 409)
      ) {
        this.deleteErrorGroup.set(g.id);
      } else {
        this.error.set(true);
      }
    } finally {
      this.busy.set(false);
    }
  }

  async loadAnnouncements() {
    try {
      const res = await this.api.adminAnnouncements();
      this.announcements.set(res?.announcements ?? []);
    } catch {
      // Offline or network error
    }
  }

  async postAnnouncement(e: Event) {
    e.preventDefault();
    if (!this.announcementTitle().trim() || !this.announcementBody().trim()) return;
    this.busy.set(true);
    this.announcementError.set(false);
    try {
      await this.api.createAnnouncement({
        groupId: this.announcementGroupId() || null,
        title: this.announcementTitle().trim(),
        body: this.announcementBody().trim(),
      });
      this.announcementTitle.set("");
      this.announcementBody.set("");
      this.announcing.set(false);
      await this.loadAnnouncements();
    } catch {
      this.announcementError.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  shareAnnouncementWhatsApp(a: AdminAnnouncement) {
    const text = `*${a.title}*\n\n${a.body}\n\n— Auto-école`;
    this.wa.open("", text);
  }

  async removeAnnouncement(id: string) {
    this.busy.set(true);
    try {
      await this.api.deleteAnnouncement(id);
      this.announcements.set(this.announcements().filter((x) => x.id !== id));
    } catch {
      this.announcementError.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
