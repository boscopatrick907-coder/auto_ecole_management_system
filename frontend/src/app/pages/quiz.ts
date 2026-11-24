import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { ApiService, RequestError } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { DataService } from "../core/data.service";
import { OutboxService } from "../core/outbox.service";
import { FR } from "../core/fr";
import { IconComponent, EmptyComponent, SkeletonComponent } from "../shared/ui";
import type { Quiz, Attempt } from "../core/models";
import { database } from "../core/database";
import {
  QuizDraftStore,
  quizRevision,
  quizTime,
  quizSubmissions,
  type QuizDraft,
  type QuizSubmission,
} from "../core/quiz-draft";
@Component({
  standalone: true,
  imports: [IconComponent, EmptyComponent, SkeletonComponent, RouterLink],
  template: `@if (current()) {
      <div class="page-heading">
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
      @if (notice()) {
        <p role="status">{{ notice() }}</p>
      }
      @if (loading()) {
        <app-skeleton variant="cards" [count]="4" />
      }
      @if (blockedDraft(); as draft) {
        <section class="card">
          <h2>Brouillon à vérifier</h2>
          <p>
            Le contenu a changé ou n’est plus disponible. Vos réponses ne seront
            pas envoyées sous une autre version.
          </p>
          <button class="btn secondary" (click)="discardDraft(draft.attemptId)">
            Supprimer ce brouillon et revenir aux quiz
          </button>
        </section>
      }
      @if (result(); as r) {
        <section class="card result">
          <app-icon name="emoji_events" />
          <h2>{{ t.result }}</h2>
          <strong>{{ r.score }} / {{ r.total }}</strong>
          <p>{{ t.serverGrade }}</p>
          <div class="actions quiz-result-actions">
            <button class="btn" (click)="reset()">{{ t.back }}</button>
          </div>
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
                  [disabled]="busy()"
                  (click)="answer(q.id, $index)"
                >
                  <span>{{ letters[$index] || $index + 1 }}</span
                  >{{ option }}
                </button>
              }
            </div>
            <div class="actions quiz-nav-actions">
              <button
                class="btn secondary"
                [disabled]="index() === 0"
                (click)="move(-1)"
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
                (click)="goTo($index)"
              >
                {{ $index + 1 }}
              </button>
            }
          </div>
          <button
            class="btn full accent quiz-finish"
            [disabled]="busy()"
            (click)="finish()"
          >
            {{ t.finish }}
          </button>
        }
      } @else {
        <a class="card promo-link" [routerLink]="'/s/' + api.slug + '/epreuves'">
          <span class="feature-icon"><app-icon name="assignment" /></span>
          <div class="grow">
            <strong>{{ t.exams }}</strong>
            <p>{{ t.examsTeaser }}</p>
          </div>
          <app-icon name="chevron_right" />
        </a>
        <div class="grid-two">
          @for (q of quizzes(); track q.id) {
            <article class="card">
              <span class="feature-icon amber"><app-icon name="quiz" /></span>
              <h2>{{ q.title }}</h2>
              <p>{{ q.questions.length }} · {{ q.duration_minutes }} min</p>
              <div class="actions quiz-card-actions">
                <button
                  class="btn"
                  [disabled]="busy() || !!blockedDraft()"
                  (click)="start(q)"
                >
                  {{ t.start }}
                </button>
                <button
                  class="btn secondary"
                  [disabled]="!api.online() || busy()"
                  (click)="downloadPack(q)"
                >
                  {{ packs().includes(q.id) ? t.saved : t.download }}
                </button>
              </div>
            </article>
          } @empty {
            @if (!loading()) {
              <app-empty />
            }
          }
        </div>
      }
      @if (history().length) {
        <section class="card">
          <h2>Mes envois de quiz sur cet appareil</h2>
          @for (item of history(); track item.id) {
            <div class="list-row">
              <div class="grow">
                <strong>{{ item.title }}</strong>
                <p>
                  {{
                    item.state === "confirmed"
                      ? "Corrigé par le serveur"
                      : item.state === "blocked"
                        ? "Envoi rejeté — à vérifier"
                        : item.state === "pending"
                          ? "En attente de synchronisation"
                          : "Confirmation indisponible"
                  }}
                </p>
                @if (item.id !== attemptId || !result()) {
                  @if (item.attempt; as a) {
                    <strong>{{ a.score }} / {{ a.total }}</strong>
                  }
                }
              </div>
            </div>
          }
        </section>
      }
    } @else {
      <p role="alert">
        Le compte a changé. Rouvrez la page sous le compte souhaité.
      </p>
    } `,
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
  loading = signal(true);
  notice = signal("");
  blockedDraft = signal<QuizDraft | null>(null);
  history = signal<QuizSubmission[]>([]);
  private scope = "";
  private destroyed = false;
  private drafts = new QuizDraftStore(() => this.auth.scope);
  private writes: Promise<void> = Promise.resolve();
  private readonly syncListener = () => {
    void this.refreshHistory().catch((e) => this.fail(e));
  };
  private readonly visibilityListener = () => {
    if (document.visibilityState === "visible" && this.active())
      void this.tick();
  };
  current() {
    return !this.destroyed && !!this.scope && this.auth.scope === this.scope;
  }
  private async allowed(refresh = false) {
    if (refresh && this.api.online()) {
      try {
        await this.auth.refreshLease();
      } catch (e) {
        if (e instanceof RequestError && e.status >= 400 && e.status < 500)
          throw e;
      }
    }
    if (!this.current() || !(await this.auth.offlineAllowed()))
      throw new Error("ACCESS_EXPIRED");
  }
  async ngOnInit() {
    this.scope = this.auth.scope;
    window.addEventListener("school:sync", this.syncListener);
    window.addEventListener("school:queue", this.syncListener);
    document.addEventListener("visibilitychange", this.visibilityListener);
    try {
      await this.allowed(true);
      const r = await this.data.read("quizzes", () => this.api.quizzes());
      if (!this.current()) return;
      this.quizzes.set(r?.quizzes || []);
      const pack = await database.snapshots.get(this.scope + ":quiz-packs");
      if (!this.current()) return;
      this.packs.set((pack?.data as string[]) || []);
      const draft = await this.drafts.load();
      if (draft) {
        const latest = this.quizzes().find((q) => q.id === draft.quiz.id);
        if (!latest || quizRevision(latest) !== draft.revision)
          this.blockedDraft.set(draft);
        else {
          await this.restore(draft);
          this.notice.set("Brouillon restauré. Le délai initial est conservé.");
        }
      }
      await this.refreshHistory();
    } catch (e) {
      this.fail(e);
    } finally {
      this.loading.set(false);
    }
  }
  private fail(e: unknown) {
    if (!this.current()) return;
    const code = e instanceof Error ? e.message : "";
    this.error.set(
      code === "QUIZ_CLOCK_ROLLBACK"
        ? "L’horloge a reculé. Corrigez l’heure de l’appareil puis rouvrez le quiz ; le délai ne sera pas prolongé."
        : code === "ACCESS_EXPIRED"
          ? this.t.accessCheck
          : code === "QUIZ_DRAFT_INVALID"
            ? "Cette copie du quiz est incompatible. Actualisez les contenus en ligne avant de commencer."
            : code === "QUIZ_DRAFT_CHANGED" || code === "QUIZ_DRAFT_EXISTS"
              ? "Ce brouillon a changé dans un autre onglet. Rouvrez le quiz pour reprendre la version enregistrée."
              : "Impossible d’enregistrer ou de récupérer le brouillon. Vérifiez la connexion et l’espace disponible, puis réessayez.",
    );
  }
  private apply(draft: QuizDraft) {
    this.answers.set(draft.answers);
    this.flags.set(draft.flags);
    this.index.set(draft.index);
    this.seconds.set(quizTime(draft));
  }
  private async restore(draft: QuizDraft) {
    quizTime(draft);
    const questions = await Promise.all(
      draft.quiz.questions.map(async (q) => {
        const image = await database.files.get(
          this.scope + ":question:" + q.id,
        );
        if (!image) return q;
        const url = URL.createObjectURL(image.blob);
        this.urls.push(url);
        return { ...q, image_url: url };
      }),
    );
    if (!this.current()) return;
    this.attemptId = draft.attemptId;
    this.deadline = draft.deadline;
    this.active.set({ ...draft.quiz, questions });
    this.apply(draft);
    this.timer = setInterval(() => void this.tick(), 1000);
    if (this.seconds() === 0) void this.finish();
  }
  async start(q: Quiz) {
    if (this.busy() || this.active() || this.blockedDraft()) return;
    this.busy.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      await this.allowed(true);
      const draft = await this.drafts.start(q);
      this.clearView();
      await this.restore(draft);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
      if (this.active() && this.seconds() === 0) void this.finish();
    }
  }
  private persist(change: (draft: QuizDraft) => void) {
    if (this.busy() || !this.active() || !this.current()) return;
    const attempt = this.attemptId;
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        if (!this.current() || attempt !== this.attemptId) return;
        const draft = await this.drafts.update(attempt, (d) => {
          if (quizTime(d) > 0) change(d);
        });
        if (this.current() && attempt === this.attemptId) this.apply(draft);
      })
      .catch((e) => {
        this.fail(e);
        throw e;
      });
    // Keep an observed rejection while allowing the next explicit operation to retry.
    void this.writes.catch(() => {});
  }
  answer(id: string, index: number) {
    this.persist((d) => {
      if (
        d.quiz.questions.find((q) => q.id === id)?.options[index] !== undefined
      )
        d.answers[id] = String(index);
    });
  }
  flag(id: string) {
    this.persist((d) => {
      d.flags = d.flags.includes(id)
        ? d.flags.filter((x) => x !== id)
        : [...d.flags, id];
    });
  }
  next() {
    this.move(1);
  }
  move(delta: number) {
    this.persist((d) => {
      d.index = Math.max(
        0,
        Math.min(d.quiz.questions.length - 1, d.index + delta),
      );
    });
  }
  goTo(index: number) {
    this.persist((d) => {
      d.index = index;
    });
  }
  private async tick() {
    if (this.busy() || !this.active() || !this.current()) return;
    const attempt = this.attemptId;
    try {
      await this.writes;
      const draft = await this.drafts.update(attempt, () => {});
      if (!this.current() || attempt !== this.attemptId) return;
      this.seconds.set(quizTime(draft));
      if (this.seconds() === 0) await this.finish();
    } catch (e) {
      clearInterval(this.timer);
      this.fail(e);
    }
  }
  async finish() {
    if (this.busy() || this.submitted() || !this.active() || !this.current())
      return;
    this.busy.set(true);
    clearInterval(this.timer);
    try {
      await this.writes;
      await this.allowed();
      await this.drafts.submit(this.attemptId);
      if (!this.current()) return;
      this.submitted.set(true);
      await this.outbox.refresh();
      await this.outbox.flush();
      await this.refreshHistory();
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  private async refreshHistory() {
    if (!this.current()) return;
    const rows = await quizSubmissions(this.scope);
    if (!this.current()) return;
    this.history.set(rows);
    const result = rows.find((x) => x.id === this.attemptId)?.attempt;
    if (result && this.submitted()) this.result.set(result);
  }
  async discardDraft(id: string) {
    if (this.busy() || !this.current()) return;
    this.busy.set(true);
    try {
      await this.drafts.discard(id);
      this.blockedDraft.set(null);
      this.error.set("");
      this.clearView();
    } catch (e) {
      this.fail(e);
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
  private clearView() {
    this.writes = Promise.resolve();
    clearInterval(this.timer);
    this.active.set(null);
    this.index.set(0);
    this.answers.set({});
    this.flags.set([]);
    this.result.set(null);
    this.submitted.set(false);
    this.attemptId = "";
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
  }
  reset() {
    this.clearView();
    this.notice.set("");
  }
  ngOnDestroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    window.removeEventListener("school:sync", this.syncListener);
    window.removeEventListener("school:queue", this.syncListener);
    document.removeEventListener("visibilitychange", this.visibilityListener);
    this.urls.forEach((u) => URL.revokeObjectURL(u));
  }
}
