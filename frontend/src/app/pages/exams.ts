import { Component, OnDestroy, OnInit, computed, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { DataService } from "../core/data.service";
import { OutboxService } from "../core/outbox.service";
import { database } from "../core/database";
import { FR } from "../core/fr";
import { EmptyComponent, IconComponent, SkeletonComponent } from "../shared/ui";
import { clock, timeLeft, toggleLetter } from "../core/exam-sheet";

export interface ExamPaper {
  resource_id: string;
  title: string;
  description: string;
  question_count: number;
  choices: number;
  duration_minutes: number;
}
export interface ExamResult {
  id: string;
  resource_id: string;
  title: string;
  score: number;
  total: number;
  submitted_at: string;
}
interface Sitting {
  clientId: string;
  resourceId: string;
  title: string;
  startedAt: number;
  deadline: number;
  answers: string[];
}
interface Graded {
  score: number;
  total: number;
  answers: string[];
  key: string[];
}

const LETTERS = "ABCDEF";

/**
 * Épreuves PDF: the student downloads the paper, sits it with a timer (1 hour by
 * default) even without network, ticks answers on a sheet, and submits. The
 * answer sheet survives a closed tab; the submission waits in the outbox when
 * offline, and the server grades it.
 */
@Component({
  standalone: true,
  imports: [RouterLink, DatePipe, IconComponent, EmptyComponent, SkeletonComponent],
  template: `
    @if (sitting(); as s) {
      <div class="exam-bar" [class.urgent]="left() < 300000">
        <div>
          <span class="eyebrow">{{ t.examInProgress }}</span>
          <strong>{{ s.title }}</strong>
        </div>
        <span class="timer" role="timer" [attr.aria-label]="t.time">{{ clockText() }}</span>
      </div>

      <section class="card exam-paper">
        @if (pdfUrl()) {
          <a class="btn full" [href]="pdfUrl()" target="_blank" rel="noopener">
            <app-icon name="picture_as_pdf" />{{ t.openPaper }}
          </a>
        } @else if (pdfError()) {
          <p class="error-box">{{ t.paperUnavailable }}</p>
        } @else {
          <app-skeleton variant="detail" [count]="1" />
        }
        <p class="muted small">{{ t.examHowTo }}</p>
      </section>

      <section class="card">
        <div class="row between">
          <h2>{{ t.answerSheet }}</h2>
          <span class="badge">{{ answered() }} / {{ s.answers.length }}</span>
        </div>
        <ol class="answer-sheet">
          @for (a of s.answers; track $index; let i = $index) {
            <li [class.done]="!!a">
              <span class="qn">{{ i + 1 }}</span>
              <div class="letters" role="group" [attr.aria-label]="t.question + ' ' + (i + 1)">
                @for (l of letters(); track l) {
                  <button
                    type="button"
                    class="letter"
                    [class.on]="a.includes(l)"
                    [attr.aria-pressed]="a.includes(l)"
                    (click)="pick(i, l)"
                  >
                    {{ l }}
                  </button>
                }
              </div>
            </li>
          }
        </ol>
      </section>

      @if (confirming()) {
        <section class="card confirm-card" role="alertdialog">
          <h2>{{ t.submitExam }}</h2>
          <p>
            @if (answered() < s.answers.length) {
              {{ s.answers.length - answered() }} {{ t.unanswered }}
            } @else {
              {{ t.allAnswered }}
            }
          </p>
          <div class="actions">
            <button class="btn accent" type="button" [disabled]="busy()" (click)="submit()">{{ t.submitNow }}</button>
            <button class="btn ghost" type="button" (click)="confirming.set(false)">{{ t.back }}</button>
          </div>
        </section>
      } @else {
        <button class="btn full accent exam-submit" type="button" [disabled]="busy()" (click)="confirming.set(true)">
          <app-icon name="send" />{{ t.submitExam }}
        </button>
      }
    } @else if (graded(); as g) {
      <section class="card result exam-result">
        <app-icon name="emoji_events" />
        <h2>{{ t.result }}</h2>
        <strong>{{ g.score }} / {{ g.total }}</strong>
        <p>{{ percent(g) }} %</p>
        <button class="btn" type="button" (click)="graded.set(null)">{{ t.back }}</button>
      </section>
      <section class="card">
        <h2>{{ t.corrections }}</h2>
        <ol class="corrections">
          @for (k of g.key; track $index; let i = $index) {
            <li [class.ok]="g.answers[i] === k" [class.ko]="g.answers[i] !== k">
              <span class="qn">{{ i + 1 }}</span>
              <span class="mine">{{ g.answers[i] || "—" }}</span>
              <app-icon [name]="g.answers[i] === k ? 'check_circle' : 'cancel'" />
              @if (g.answers[i] !== k) {
                <span class="right">{{ t.correctAnswer }} : <b>{{ k }}</b></span>
              }
            </li>
          }
        </ol>
      </section>
    } @else {
      <div class="page-heading">
        <div>
          <span class="eyebrow">{{ auth.school()?.name }}</span>
          <h1>{{ t.exams }}</h1>
          <p class="muted">{{ t.examsHelp }}</p>
        </div>
      </div>
      @if (queued()) {
        <p class="soft-note" role="status"><app-icon name="cloud_upload" /><span>{{ t.examQueued }}</span></p>
      }
      @if (error()) {
        <p class="error-box" role="alert">{{ error() }}</p>
      }
      <div class="grid-two">
        @for (p of papers(); track p.resource_id) {
          <article class="card exam-card">
            <span class="feature-icon"><app-icon name="assignment" /></span>
            <h2>{{ p.title }}</h2>
            @if (p.description) {
              <p class="muted">{{ p.description }}</p>
            }
            <p class="chips">
              <span><app-icon name="format_list_numbered" />{{ p.question_count }} {{ t.questions }}</span>
              <span><app-icon name="timer" />{{ p.duration_minutes }} min</span>
              @if (saved()[p.resource_id]) {
                <span class="ok"><app-icon name="offline_pin" />{{ t.availableOffline }}</span>
              }
            </p>
            @if (best(p.resource_id); as b) {
              <p class="best">{{ t.bestScore }} : <b>{{ b.score }} / {{ b.total }}</b></p>
            }
            <div class="actions">
              <button class="btn" type="button" [disabled]="busy()" (click)="start(p)">
                <app-icon name="play_arrow" />{{ t.startExam }}
              </button>
              @if (!saved()[p.resource_id]) {
                <button class="btn secondary" type="button" [disabled]="busy() || !api.online()" (click)="download(p)">
                  <app-icon name="download" />{{ t.download }}
                </button>
              }
            </div>
          </article>
        } @empty {
          <app-empty [text]="t.noExams" />
        }
      </div>
      @if (results().length) {
        <section class="card">
          <h2>{{ t.myResults }}</h2>
          @for (r of results(); track r.id) {
            <div class="list-row">
              <div class="grow">
                <strong>{{ r.title }}</strong>
                <p>{{ r.submitted_at | date: "dd/MM/yyyy HH:mm" : "Africa/Douala" }}</p>
              </div>
              <b>{{ r.score }} / {{ r.total }}</b>
            </div>
          }
        </section>
      }
      <a class="text-link" [routerLink]="'/s/' + api.slug + '/quiz'">{{ t.backToQuiz }}</a>
    }
  `,
})
export class ExamsComponent implements OnInit, OnDestroy {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  store = inject(DataService);
  outbox = inject(OutboxService);

  papers = signal<ExamPaper[]>([]);
  results = signal<ExamResult[]>([]);
  saved = signal<Record<string, boolean>>({});
  sitting = signal<Sitting | null>(null);
  graded = signal<Graded | null>(null);
  pdfUrl = signal("");
  pdfError = signal(false);
  now = signal(Date.now());
  busy = signal(false);
  confirming = signal(false);
  queued = signal(false);
  error = signal("");
  private timer?: ReturnType<typeof setInterval>;
  private choices = signal(4);

  letters = computed(() => LETTERS.slice(0, this.choices()).split(""));
  left = computed(() => timeLeft(this.sitting()?.deadline ?? 0, this.now()));
  clockText = computed(() => clock(this.left()));
  answered = computed(() => this.sitting()?.answers.filter(Boolean).length ?? 0);

  private get storageKey() {
    return `aem:exam:${this.auth.scope}`;
  }
  private pendingId = "";
  private sync = () => {
    void this.load();
    if (this.pendingId) void this.showResult(this.pendingId);
  };

  /** Show the correction as soon as the server has graded the sheet. */
  private async showResult(id: string) {
    const row = await database.snapshots.get(`${this.auth.scope}:result:${id}`);
    const a = (row?.data as { attempt?: Graded } | undefined)?.attempt;
    if (!a?.key) return false;
    this.pendingId = "";
    this.queued.set(false);
    if (!this.sitting()) this.graded.set({ score: a.score, total: a.total, answers: a.answers, key: a.key });
    return true;
  }

  async ngOnInit() {
    window.addEventListener("school:sync", this.sync);
    await this.load();
    this.resume();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    window.removeEventListener("school:sync", this.sync);
    if (this.pdfUrl()) URL.revokeObjectURL(this.pdfUrl());
  }

  async load() {
    this.error.set("");
    try {
      const data = await this.store.read("exams", () => this.api.tenant<{ exams: ExamPaper[] }>("exams"), (c) => c && this.papers.set(c.exams));
      if (data) this.papers.set(data.exams);
      const res = await this.store.read("exam-results", () => this.api.tenant<{ results: ExamResult[] }>("exam-results"), (c) => c && this.results.set(c.results));
      if (res) this.results.set(res.results);
      const map: Record<string, boolean> = {};
      for (const p of this.papers()) map[p.resource_id] = await this.store.saved(p.resource_id);
      this.saved.set(map);
    } catch {
      this.error.set(this.api.online() ? this.t.error : this.t.offlineUnavailable);
    }
  }

  best(id: string) {
    return this.results()
      .filter((r) => r.resource_id === id)
      .sort((a, b) => b.score / b.total - a.score / a.total)[0];
  }

  percent(g: Graded) {
    return Math.round((g.score / g.total) * 100);
  }

  async download(p: ExamPaper) {
    this.busy.set(true);
    this.error.set("");
    try {
      URL.revokeObjectURL(await this.store.file(p.resource_id, true));
      this.saved.update((m) => ({ ...m, [p.resource_id]: true }));
    } catch {
      this.error.set(this.t.downloadError);
    } finally {
      this.busy.set(false);
    }
  }

  async start(p: ExamPaper) {
    if (!this.saved()[p.resource_id] && !this.api.online()) {
      this.error.set(this.t.downloadFirst);
      return;
    }
    const now = Date.now();
    const s: Sitting = {
      clientId: crypto.randomUUID(),
      resourceId: p.resource_id,
      title: p.title,
      startedAt: now,
      deadline: now + p.duration_minutes * 60000,
      answers: Array.from({ length: p.question_count }, () => ""),
    };
    this.choices.set(p.choices);
    this.save(s);
    await this.enter(s);
  }

  /** A sitting survives closing the app: pick it up where it was. */
  private resume() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const s = JSON.parse(raw) as Sitting;
      const paper = this.papers().find((p) => p.resource_id === s.resourceId);
      if (paper) this.choices.set(paper.choices);
      void this.enter(s);
    } catch {
      /* nothing to resume */
    }
  }

  private async enter(s: Sitting) {
    this.sitting.set(s);
    this.graded.set(null);
    this.confirming.set(false);
    window.scrollTo({ top: 0 });
    clearInterval(this.timer);
    this.now.set(Date.now());
    this.timer = setInterval(() => {
      this.now.set(Date.now());
      if (this.left() === 0) void this.submit();
    }, 1000);
    if (this.left() === 0) return void this.submit();
    this.pdfError.set(false);
    try {
      // Keep the paper on the device so the sitting can continue offline.
      this.pdfUrl.set(await this.store.file(s.resourceId, true));
      this.saved.update((m) => ({ ...m, [s.resourceId]: true }));
    } catch {
      this.pdfError.set(true);
    }
  }

  private save(s: Sitting) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(s));
    } catch {
      /* private mode: the sitting still works until the tab closes */
    }
  }

  pick(i: number, letter: string) {
    const s = this.sitting();
    if (!s || this.left() === 0) return;
    const answers = [...s.answers];
    answers[i] = toggleLetter(answers[i], letter);
    const next = { ...s, answers };
    this.sitting.set(next);
    this.save(next);
  }

  async submit() {
    const s = this.sitting();
    if (!s || this.busy()) return;
    this.busy.set(true);
    clearInterval(this.timer);
    try {
      const submittedAt = Math.min(Date.now(), s.deadline);
      const id = await this.outbox.enqueue(
        "exam",
        {
          resourceId: s.resourceId,
          answers: s.answers,
          startedAt: new Date(s.startedAt).toISOString(),
          submittedAt: new Date(submittedAt).toISOString(),
        },
        s.clientId,
      );
      await database.outbox.update(id, { context: { title: s.title } }).catch(() => {});
      localStorage.removeItem(this.storageKey);
      this.sitting.set(null);
      if (this.pdfUrl()) URL.revokeObjectURL(this.pdfUrl());
      this.pdfUrl.set("");
      this.pendingId = id;
      await this.outbox.flush();
      if (await this.showResult(id)) void this.load();
      else this.queued.set(true);
    } catch {
      this.error.set(this.t.error);
    } finally {
      this.busy.set(false);
      this.confirming.set(false);
    }
  }
}
