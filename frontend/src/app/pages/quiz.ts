import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { DataService } from "../core/data.service";
import { OutboxService } from "../core/outbox.service";
import { FR } from "../core/fr";
import { IconComponent, EmptyComponent } from "../shared/ui";
import type { Quiz, Attempt } from "../core/models";
import { database } from "../core/database";
@Component({
  standalone: true,
  imports: [IconComponent, EmptyComponent],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">{{ t.progress }}</span>
        <h1>{{ t.quiz }}</h1>
      </div>
      @if (active()) {
        <span class="timer" role="timer">{{ minutes() }}</span>
      }
    </div>
    @if (error()) {
      <p role="alert" class="error-box">{{ error() }}</p>
    }
    @if (result(); as r) {
      <section class="card result">
        <app-icon name="emoji_events" />
        <h2>{{ t.result }}</h2>
        <strong>{{ r.score }} / {{ r.total }}</strong>
        <p>{{ t.serverGrade }}</p>
        <button class="btn" (click)="reset()">{{ t.back }}</button>
      </section>
    } @else if (submitted()) {
      <section class="card">
        <h2>{{ t.queued }}</h2>
        <button class="btn" (click)="reset()">{{ t.back }}</button>
      </section>
    } @else if (active(); as quiz) {
      @if (question(); as q) {
        <section class="card">
          <div class="row between">
            <span class="eyebrow"
              >{{ index() + 1 }} / {{ quiz.questions.length }}</span
            ><button
              class="btn ghost small"
              [class.flagged]="flags().includes(q.id)"
              (click)="flag(q.id)"
            >
              <app-icon name="flag" />{{ t.flag }}
            </button>
          </div>
          <h2>{{ q.body }}</h2>
          @if (q.image_url) {
            <img class="question-image" [src]="q.image_url" alt="" />
          }
          <div class="answers">
            @for (option of q.options; track $index) {
              <button
                class="answer"
                [class.selected]="answers()[q.id] === '' + $index"
                (click)="answer(q.id, $index)"
              >
                <span>{{ letters[$index] || $index + 1 }}</span
                >{{ option }}
              </button>
            }
          </div>
          <div class="actions">
            <button
              class="btn secondary"
              [disabled]="index() === 0"
              (click)="index.update(previous)"
            >
              {{ t.back }}</button
            ><button class="btn" (click)="next()">
              {{ t.skip }}<app-icon name="arrow_forward" />
            </button>
          </div>
        </section>
        <div class="question-grid">
          @for (item of quiz.questions; track item.id) {
            <button
              [class.selected]="index() === $index"
              [class.answered]="answers()[item.id] !== undefined"
              [class.flagged]="flags().includes(item.id)"
              (click)="index.set($index)"
            >
              {{ $index + 1 }}
            </button>
          }
        </div>
        <button class="btn full accent" [disabled]="busy()" (click)="finish()">
          {{ t.finish }}
        </button>
      }
    } @else {
      <div class="grid-two">
        @for (q of quizzes(); track q.id) {
          <article class="card">
            <span class="feature-icon amber"><app-icon name="quiz" /></span>
            <h2>{{ q.title }}</h2>
            <p>{{ q.questions.length }} · {{ q.duration_minutes }} min</p>
            <button class="btn full" (click)="start(q)">{{ t.start }}</button
            ><button
              class="btn secondary full"
              [disabled]="!api.online() || busy()"
              (click)="downloadPack(q)"
            >
              {{ packs().includes(q.id) ? t.saved : t.download }}
            </button>
          </article>
        } @empty {
          <app-empty />
        }
      </div>
    }`,
})
export class QuizComponent implements OnInit, OnDestroy {
  t = FR;
  api = inject(ApiService);
  auth = inject(AuthService);
  data = inject(DataService);
  outbox = inject(OutboxService);
  quizzes = signal<Quiz[]>([]);
  active = signal<Quiz | null>(null);
  index = signal(0);
  answers = signal<Record<string, string>>({});
  flags = signal<string[]>([]);
  seconds = signal(0);
  busy = signal(false);
  submitted = signal(false);
  result = signal<Attempt | null>(null);
  error = signal("");
  packs = signal<string[]>([]);
  urls: string[] = [];
  attemptId = "";
  deadline = 0;
  timer: ReturnType<typeof setInterval> | undefined;
  letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  previous = (n: number) => Math.max(0, n - 1);
  question = computed(() => this.active()?.questions[this.index()]);
  minutes = computed(
    () =>
      `${Math.floor(this.seconds() / 60)}:${String(this.seconds() % 60).padStart(2, "0")}`,
  );
  async ngOnInit() {
    try {
      if (this.api.online()) await this.auth.refreshLease();
      if (!(await this.auth.offlineAllowed()))
        throw new Error(this.t.accessCheck);
      const r = await this.data.read("quizzes", () => this.api.quizzes());
      this.quizzes.set(r?.quizzes || []);
      const pack = await database.snapshots.get(
        this.auth.scope + ":quiz-packs",
      );
      this.packs.set((pack?.data as string[]) || []);
    } catch {
      this.error.set(this.t.accessCheck);
    }
  }
  async start(q: Quiz) {
    if (this.api.online()) await this.auth.refreshLease();
    if (!(await this.auth.offlineAllowed())) {
      this.error.set(this.t.accessCheck);
      return;
    }
    this.reset();
    this.attemptId = crypto.randomUUID();
    const questions = await Promise.all(
      q.questions.map(async (question) => {
        const image = await database.files.get(
          this.auth.scope + ":question:" + question.id,
        );
        if (!image) return question;
        const url = URL.createObjectURL(image.blob);
        this.urls.push(url);
        return { ...question, image_url: url };
      }),
    );
    this.active.set({ ...q, questions });
    this.deadline = Date.now() + q.duration_minutes * 60000;
    this.seconds.set(q.duration_minutes * 60);
    this.timer = setInterval(() => {
      this.seconds.set(
        Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000)),
      );
      if (this.seconds() === 0) void this.finish();
    }, 1000);
  }
  answer(id: string, index: number) {
    this.answers.update((x) => ({ ...x, [id]: String(index) }));
  }
  flag(id: string) {
    this.flags.update((x) =>
      x.includes(id) ? x.filter((i) => i !== id) : [...x, id],
    );
  }
  next() {
    const q = this.active();
    if (q) this.index.update((i) => (i + 1) % q.questions.length);
  }
  async finish() {
    if (this.busy() || this.submitted() || !this.active()) return;
    this.busy.set(true);
    clearInterval(this.timer);
    try {
      await this.outbox.enqueue(
        "quiz",
        {
          quizId: this.active()!.id,
          answers: this.answers(),
          takenAt: new Date().toISOString(),
        },
        this.attemptId,
      );
      this.submitted.set(true);
      await this.outbox.flush();
      const result = await database.snapshots.get(
        this.auth.scope + ":result:" + this.attemptId,
      );
      if (result)
        this.result.set((result.data as { attempt: Attempt }).attempt);
    } catch {
      this.error.set(this.t.error);
    } finally {
      this.busy.set(false);
    }
  }
  async downloadPack(q: Quiz) {
    this.busy.set(true);
    try {
      const scope = this.auth.scope;
      const files = [];
      for (const question of q.questions) {
        if (!question.image_url) continue;
        const response = await fetch(question.image_url);
        if (!response.ok) throw new Error("DOWNLOAD_FAILED");
        files.push({
          key: scope + ":question:" + question.id,
          scope,
          blob: await response.blob(),
        });
      }
      if (this.auth.scope !== scope) return;
      await database.files.bulkPut(files);
      const packs = Array.from(new Set([...this.packs(), q.id]));
      await database.snapshots.put({
        key: scope + ":quiz-packs",
        scope,
        data: packs,
        updatedAt: Date.now(),
      });
      this.packs.set(packs);
    } catch {
      this.error.set(this.t.downloadError);
    } finally {
      this.busy.set(false);
    }
  }
  reset() {
    clearInterval(this.timer);
    this.active.set(null);
    this.index.set(0);
    this.answers.set({});
    this.flags.set([]);
    this.result.set(null);
    this.submitted.set(false);
  }
  ngOnDestroy() {
    clearInterval(this.timer);
    for (const url of this.urls) URL.revokeObjectURL(url);
  }
}
