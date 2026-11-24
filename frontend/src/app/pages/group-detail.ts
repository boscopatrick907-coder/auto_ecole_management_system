import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { ApiService, RequestError } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { WhatsAppService } from "../core/whatsapp.service";
import { FR } from "../core/fr";
import { MoneyPipe } from "../shared/money.pipe";
import { BadgeComponent, IconComponent, SkeletonComponent } from "../shared/ui";
import type { Category } from "../core/models";

interface Tranche {
  id?: string;
  label: string;
  amount: number;
  due_date: string;
}
interface GroupStats {
  group: {
    id: string;
    name: string;
    licence_category_id: string;
    licence_name: string;
    start_date: string;
    schedule_text: string;
    capacity: number;
    total_fee: number;
    status: "open" | "closed" | "finished";
    installments: Tranche[];
  };
  summary: {
    enrolled: number;
    capacity: number;
    activated: number;
    paying: number;
    fully_paid: number;
    late: number;
    expected: number;
    collected: number;
    outstanding: number;
    overdue_amount: number;
    collected_last_30_days: number;
  };
  tranches: (Tranche & { position: number; paid: number; partial: number; overdue: number; upcoming: number })[];
  learning: { quiz_attempts: number; quiz_average: number | null; exam_attempts: number; exam_average: number | null };
  students: {
    id: string;
    full_name: string;
    phone: string;
    student_number: number;
    activated: boolean;
    paid: number;
    balance: number;
    overdue_count: number;
    overdue_amount: number;
    next_due: string | null;
  }[];
}

const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

/** One group: figures at a glance, its tranches, its students, and editing. */
@Component({
  standalone: true,
  imports: [DatePipe, RouterLink, FormsModule, MoneyPipe, BadgeComponent, IconComponent, SkeletonComponent],
  template: `
    <a class="text-link back-link" [routerLink]="base + '/admin/groupes'"><app-icon name="arrow_back" />{{ t.groups }}</a>
    @if (error()) {
      <p class="error-box" role="alert">{{ error() }}</p>
    }
    @if (!data() && loading()) {
      <app-skeleton variant="dashboard" [count]="4" />
    }
    @if (data(); as d) {
      <div class="page-heading">
        <div>
          <span class="eyebrow">{{ d.group.licence_name }} · {{ d.group.schedule_text }}</span>
          <h1>{{ d.group.name }}</h1>
          <p class="muted">@if (d.group.start_date) {{{ t.dateStart }} : {{ d.group.start_date | date: "dd/MM/yyyy" }} · }{{ d.group.total_fee | fcfa }}</p>
        </div>
        <app-badge [kind]="d.group.status === 'open' ? 'paid' : 'upcoming'" [label]="statusLabel(d.group.status)" />
      </div>

      @if (!editing()) {
        <div class="actions group-actions">
          <button class="btn" type="button" [disabled]="!api.online()" (click)="startEdit()"><app-icon name="edit" />{{ t.editGroup }}</button>
          <button class="btn secondary" type="button" [disabled]="busy() || !api.online()" (click)="toggleStatus()">
            {{ d.group.status === "open" ? t.close : t.open }}
          </button>
        </div>
        @if (success()) {
          <p class="soft-note" role="status"><app-icon name="check_circle" /><span>{{ success() }}</span></p>
        }

        <div class="group-kpis">
          <article class="kpi">
            <span>{{ t.students }}</span>
            <strong>{{ d.summary.enrolled }} / {{ d.summary.capacity }}</strong>
            <progress [value]="d.summary.enrolled" [max]="d.summary.capacity || 1"></progress>
            <small>{{ d.summary.capacity - d.summary.enrolled }} {{ t.seatsLeft }}</small>
          </article>
          <article class="kpi">
            <span>{{ t.collectedSoFar }}</span>
            <strong>{{ d.summary.collected | fcfa }}</strong>
            <progress [value]="d.summary.collected" [max]="d.summary.expected || 1"></progress>
            <small>{{ collectionRate() }} % {{ t.of }} {{ d.summary.expected | fcfa }}</small>
          </article>
          <article class="kpi">
            <span>{{ t.toCollect }}</span>
            <strong>{{ d.summary.outstanding | fcfa }}</strong>
            <small>{{ d.summary.fully_paid }} {{ t.fullyPaid }} · {{ d.summary.paying }} {{ t.havePaid }}</small>
          </article>
          <article class="kpi" [class.alert]="d.summary.late > 0">
            <span>{{ t.overdue }}</span>
            <strong>{{ d.summary.overdue_amount | fcfa }}</strong>
            <small>{{ d.summary.late }} {{ t.lateStudents }}</small>
          </article>
          <article class="kpi">
            <span>{{ t.last30Days }}</span>
            <strong>{{ d.summary.collected_last_30_days | fcfa }}</strong>
            <small>{{ d.summary.activated }} / {{ d.summary.enrolled }} {{ t.accountsActivated }}</small>
          </article>
          <article class="kpi">
            <span>{{ t.learningLevel }}</span>
            <strong>{{ d.learning.exam_average ?? d.learning.quiz_average ?? "—" }}{{ (d.learning.exam_average ?? d.learning.quiz_average) !== null ? " %" : "" }}</strong>
            <small>{{ t.quiz }} {{ d.learning.quiz_average ?? "—" }}{{ d.learning.quiz_average !== null ? " %" : "" }} ({{ d.learning.quiz_attempts }}) · {{ t.exams }} {{ d.learning.exam_average ?? "—" }}{{ d.learning.exam_average !== null ? " %" : "" }} ({{ d.learning.exam_attempts }})</small>
          </article>
        </div>

        <section class="card">
          <h2>{{ t.fees }}</h2>
          @for (tr of d.tranches; track tr.id) {
            <div class="tranche-row">
              <div class="grow">
                <strong>{{ tr.label }}</strong>
                <p class="muted">{{ tr.due_date | date: "dd/MM/yyyy" }} · {{ tr.amount | fcfa }}</p>
              </div>
              <div class="tranche-counts">
                <span class="ok">{{ tr.paid }} {{ t.paidShort }}</span>
                @if (tr.partial) {
                  <span class="part">{{ tr.partial }} {{ t.partialShort }}</span>
                }
                @if (tr.overdue) {
                  <span class="late">{{ tr.overdue }} {{ t.lateShort }}</span>
                }
              </div>
            </div>
          }
        </section>

        <section class="card">
          <div class="row between">
            <h2>{{ t.students }}</h2>
            @if (lateStudents().length) {
              <button class="btn small" type="button" [class.secondary]="!onlyLate()" (click)="onlyLate.set(!onlyLate())">
                {{ t.overdue }} ({{ lateStudents().length }})
              </button>
            }
          </div>
          @for (s of shownStudents(); track s.id) {
            <div class="list-row student-row">
              <a class="grow row" [routerLink]="base + '/admin/eleves/' + s.id">
                <span class="avatar" aria-hidden="true">{{ s.full_name.charAt(0) }}</span>
                <span class="grow">
                  <strong>{{ s.full_name }}</strong>
                  <small class="muted block">N° {{ s.student_number }} · {{ s.phone }}@if (!s.activated) { · {{ t.notActivated }} }</small>
                </span>
              </a>
              <div class="align-right">
                <strong>{{ s.balance | fcfa }}</strong>
                <app-badge
                  [kind]="s.balance <= 0 ? 'paid' : s.overdue_count ? 'overdue' : 'upcoming'"
                  [label]="s.balance <= 0 ? t.settled : s.overdue_count ? t.overdue : t.paid"
                />
              </div>
              @if (s.overdue_count) {
                <button class="icon-btn wa" type="button" [attr.aria-label]="t.whatsapp + ' ' + s.full_name" (click)="remind(s)">
                  <app-icon name="chat" />
                </button>
              }
            </div>
          } @empty {
            <p class="muted">{{ t.noStudentsInGroup }}</p>
          }
        </section>
      } @else {
        <section class="card">
          <h2>{{ t.editGroup }}</h2>
          <form (ngSubmit)="save()" #f="ngForm">
            <div class="grid-two">
              <label>{{ t.groupName }}<input name="name" [(ngModel)]="form.name" required minlength="2" /></label>
              <label>{{ t.licence }}
                <select name="licence" [(ngModel)]="form.licenceCategoryId" [disabled]="d.summary.enrolled > 0">
                  @for (c of categories(); track c.id) {
                    <option [value]="c.id">{{ c.name }}</option>
                  }
                </select>
              </label>
              <label>{{ t.schedule }}<input name="schedule" [(ngModel)]="form.scheduleText" /></label>
              <label>{{ t.dateStart }}<input name="start" type="date" [(ngModel)]="form.startDate" /></label>
              <label>{{ t.capacity }}<input name="capacity" type="number" [min]="d.summary.enrolled || 1" [(ngModel)]="form.capacity" required />
                @if (form.capacity < d.summary.enrolled) {
                  <small class="field-error" role="alert">{{ t.capacityBelowEnrolled }} ({{ d.summary.enrolled }})</small>
                }
              </label>
            </div>
            @if (d.summary.enrolled > 0) {
              <p class="muted small">{{ t.editGroupRules }}</p>
            }
            <h3>{{ t.fees }}</h3>
            @for (tr of tranches(); track $index; let i = $index) {
              <div class="installment-form">
                <label>{{ t.trancheLabel }}<input [name]="'l' + i" [(ngModel)]="tr.label" required /></label>
                <label>{{ t.amount }}<input [name]="'a' + i" type="number" min="1" [(ngModel)]="tr.amount" (ngModelChange)="touch()" required /></label>
                <label>{{ t.date }}<input [name]="'d' + i" type="date" [(ngModel)]="tr.due_date" required /></label>
                <button type="button" class="btn ghost" [disabled]="tranches().length === 1" (click)="removeTranche(i)">{{ t.removeTranche }}</button>
              </div>
            }
            <button type="button" class="btn ghost small" (click)="addTranche()"><app-icon name="add" />{{ t.addTranche }}</button>
            <p class="tranche-total">{{ t.total }} : <strong>{{ trancheTotal() | fcfa }}</strong> <span class="muted">({{ t.sumOfTranches }})</span></p>
            <div class="actions">
              <button class="btn" [disabled]="busy() || f.invalid || !api.online()">{{ t.save }}</button>
              <button class="btn ghost" type="button" (click)="editing.set(false); error.set('')">{{ t.cancel }}</button>
            </div>
          </form>
        </section>
      }
    }
  `,
})
export class GroupDetailComponent implements OnInit {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  wa = inject(WhatsAppService);
  id = inject(ActivatedRoute).snapshot.paramMap.get("id")!;
  base = "/s/" + this.api.slug;

  data = signal<GroupStats | null>(null);
  categories = signal<Category[]>([]);
  loading = signal(true);
  busy = signal(false);
  editing = signal(false);
  error = signal("");
  success = signal("");
  tranches = signal<Tranche[]>([]);
  private version = signal(0);
  form = { name: "", licenceCategoryId: "", scheduleText: "", startDate: "", capacity: 1 };

  collectionRate = computed(() => {
    const s = this.data()?.summary;
    return s ? pct(s.collected, s.expected) : 0;
  });
  lateStudents = computed(() => this.data()?.students.filter((s) => s.overdue_count > 0) ?? []);
  onlyLate = signal(false);
  shownStudents = computed(() => (this.onlyLate() ? this.lateStudents() : this.data()?.students ?? []));
  trancheTotal = computed(() => {
    this.version();
    return this.tranches().reduce((n, x) => n + (Number(x.amount) || 0), 0);
  });

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      this.data.set(await this.api.tenant<GroupStats>(`admin/groups/${encodeURIComponent(this.id)}/stats`));
      this.error.set("");
    } catch (e) {
      this.error.set(e instanceof RequestError && e.status === 404 ? this.t.groupNotFound : this.t.error);
    } finally {
      this.loading.set(false);
    }
  }

  statusLabel(s: string) {
    return s === "open" ? "Ouvert" : s === "closed" ? "Fermé" : "Terminé";
  }

  async startEdit() {
    const g = this.data()!.group;
    this.form = {
      name: g.name,
      licenceCategoryId: g.licence_category_id,
      scheduleText: g.schedule_text,
      startDate: g.start_date ? String(g.start_date).slice(0, 10) : "",
      capacity: g.capacity,
    };
    this.tranches.set(g.installments.map((i) => ({ label: i.label, amount: Number(i.amount), due_date: String(i.due_date).slice(0, 10) })));
    this.success.set("");
    this.error.set("");
    this.editing.set(true);
    if (!this.categories().length) {
      try {
        this.categories.set((await this.api.catalogue(true)).categories);
      } catch {
        /* the licence stays as it is */
      }
    }
  }

  touch() {
    this.version.update((v) => v + 1);
  }
  addTranche() {
    const last = this.tranches().at(-1);
    this.tranches.update((t) => [...t, { label: "Tranche " + (t.length + 1), amount: 0, due_date: last?.due_date ?? (this.form.startDate || new Date().toISOString().slice(0, 10)) }]);
  }
  removeTranche(i: number) {
    this.tranches.update((t) => t.filter((_, k) => k !== i));
  }

  private message(e: unknown) {
    if (!(e instanceof RequestError)) return this.t.networkError;
    switch (e.code) {
      case "CAPACITY_BELOW_ENROLLED":
        return this.t.capacityBelowEnrolled;
      case "FEE_BELOW_PAID":
        return this.t.feeBelowPaid;
      case "GROUP_HAS_STUDENTS":
        return this.t.licenceLocked;
      case "INVALID_INSTALLMENTS":
        return this.t.tranchesInvalid;
      default:
        return this.t.conflict;
    }
  }

  async save() {
    const d = this.data();
    if (!d) return;
    const tranches = this.tranches().map((x) => ({ label: x.label.trim(), amount: Number(x.amount), dueDate: x.due_date }));
    if (tranches.some((x, i) => i > 0 && x.dueDate < tranches[i - 1].dueDate)) {
      this.error.set(this.t.tranchesInvalid);
      return;
    }
    this.busy.set(true);
    this.error.set("");
    try {
      await this.api.tenant(`admin/groups/${encodeURIComponent(this.id)}`, "PATCH", {
        name: this.form.name.trim(),
        scheduleText: this.form.scheduleText,
        ...(this.form.startDate ? { startDate: this.form.startDate } : {}),
        capacity: Number(this.form.capacity),
        ...(this.form.licenceCategoryId !== d.group.licence_category_id ? { licenceCategoryId: this.form.licenceCategoryId } : {}),
        totalFee: this.trancheTotal(),
        installments: tranches,
      });
      this.editing.set(false);
      this.success.set(this.t.groupSaved);
      await this.load();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  async toggleStatus() {
    const d = this.data();
    if (!d) return;
    this.busy.set(true);
    try {
      await this.api.tenant(`admin/groups/${encodeURIComponent(this.id)}`, "PATCH", {
        status: d.group.status === "open" ? "closed" : "open",
      });
      await this.load();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** WhatsApp reminder to one late student, with the amount due. */
  remind(s: GroupStats["students"][number]) {
    const school = this.auth.school();
    if (!school) return;
    this.wa.open(
      s.phone,
      `${school.name} — Bonjour ${s.full_name.split(" ")[0]}, une tranche de votre formation est en retard (${s.overdue_amount.toLocaleString("fr-FR")} FCFA). Merci de passer à l’accueil.`,
    );
  }
}
