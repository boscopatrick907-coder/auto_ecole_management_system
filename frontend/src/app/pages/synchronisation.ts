import { Component, inject, signal, OnInit, OnDestroy } from "@angular/core";
import { RouterLink } from "@angular/router";
import { DatePipe } from "@angular/common";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { OutboxService } from "../core/outbox.service";
import { database, type QueueAction } from "../core/database";
import { MoneyPipe } from "../shared/money.pipe";
import { quizSubmissions, type QuizSubmission } from "../core/quiz-draft";

export function syncError(code?: string) {
  const messages: Record<string, string> = {
    EXCEEDS_BALANCE:
      "Montant supérieur au solde. Faites vérifier le dossier par la direction avant toute correction.",
    GROUP_FULL: "Groupe complet. La direction doit vérifier l’inscription.",
    IDEMPOTENCY_CONFLICT:
      "Cette référence correspond à une autre opération. Ne recréez pas le paiement ; demandez un rapprochement.",
    RECEIPT_NUMBER_CONFLICT:
      "Numéro de reçu déjà utilisé. Conservez ce justificatif et demandez un rapprochement.",
    QUIZ_VERSION_CHANGED:
      "Le quiz a été modifié depuis sa préparation. Vos réponses sont conservées ; demandez une nouvelle évaluation.",
    QUIZ_FORBIDDEN:
      "Ce quiz n’est plus accessible. Vérifiez vos droits avec l’école.",
    AUTH_REQUIRED: "Reconnectez-vous pour reprendre la synchronisation.",
    SESSION_IDENTITY_CHANGED:
      "Le compte a changé. Reconnectez-vous au compte à l’origine de cette opération.",
    MEMBERSHIP_REQUIRED: "L’accès à cette école doit être vérifié.",
    VALIDATION_ERROR:
      "Le serveur a refusé les données. Conservez l’opération pour vérification.",
  };
  return code
    ? messages[code] ||
        "Échec de l’envoi. Vérifiez la connexion ou demandez une vérification à l’école."
    : "L’envoi sera repris lorsque la connexion et les droits le permettront.";
}
@Component({
  standalone: true,
  imports: [RouterLink, DatePipe, MoneyPipe],
  template: `@if (current()) {
      <div class="page-heading">
        <h1>Synchronisation</h1>
        <button class="btn secondary" [disabled]="loading()" (click)="load()">
          Actualiser
        </button>
      </div>
      <p>
        Opérations de ce compte et de cette école sur cet appareil. Une saisie
        en attente n’est pas un encaissement confirmé.
      </p>
      @if (error()) {
        <p role="alert" class="error-box">{{ error() }}</p>
      }
      @if (loading()) {
        <p role="status">Chargement des envois…</p>
      }
      @for (item of items(); track item.id) {
        <section class="card" style="margin-bottom:16px">
          <span class="eyebrow"
            >{{ item.kind === "payment" ? "Paiement" : item.kind === "exam" ? "Épreuve" : "Quiz" }} ·
            {{ item.state === "blocked" ? "À vérifier" : "En attente" }}</span
          >
          <h2>
            {{
              item.context?.studentName ||
                item.context?.title ||
                (item.kind === "payment"
                  ? "Paiement à rapprocher"
                  : "Évaluation")
            }}
          </h2>
          <p>
            {{ item.createdAt | date: "dd/MM/yyyy HH:mm" : "Africa/Douala" }}
          </p>
          @if (item.kind === "payment") {
            <strong>{{ number(item.body["amount"]) | fcfa }}</strong>
            <p>Inscription : {{ item.body["enrollmentId"] }}</p>
            <p>
              Reçu provisoire / référence :
              {{ item.body["receiptNumber"] || item.id }}
            </p>
          }
          <p>{{ explain(item.error) }}</p>
          <p class="muted">
            Tentatives : {{ item.attempts }} · Référence : {{ item.id }}
          </p>
          <div class="actions">
            <button
              class="btn secondary"
              [disabled]="
                !api.online() || outbox.syncing() || busy() === item.id
              "
              (click)="retry(item)"
            >
              Réessayer cet envoi
            </button>
            @if (
              item.kind === "payment" &&
              item.context?.studentId &&
              auth.role() === "admin"
            ) {
              <a
                class="btn"
                [routerLink]="
                  '/s/' +
                  api.slug +
                  '/admin/paiement/' +
                  item.context!.studentId
                "
                >Ouvrir le dossier et le reçu</a
              >
            }
          </div>
          <p class="muted">
            Réessayer conserve les mêmes données et la même référence. Aucune
            opération rejetée n’est supprimée automatiquement.
          </p>
        </section>
      } @empty {
        @if (!loading()) {
          <section class="card">
            <h2>Aucun envoi en attente pour ce compte</h2>
          </section>
        }
      }
      @if (quizzes().length) {
        <section class="card">
          <h2>Résultats et envois de quiz</h2>
          @for (q of quizzes(); track q.id) {
            <div class="list-row">
              <div>
                <strong>{{ q.title }}</strong>
                <p>
                  {{
                    q.state === "confirmed"
                      ? "Confirmé par le serveur"
                      : q.state === "blocked"
                        ? "À vérifier"
                        : "Confirmation en attente"
                  }}
                </p>
                @if (q.attempt; as a) {
                  <strong>{{ a.score }} / {{ a.total }}</strong>
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
export class SynchronisationComponent implements OnInit, OnDestroy {
  api = inject(ApiService);
  auth = inject(AuthService);
  outbox = inject(OutboxService);
  items = signal<QueueAction[]>([]);
  quizzes = signal<QuizSubmission[]>([]);
  loading = signal(false);
  error = signal("");
  busy = signal("");
  number = Number;
  explain = syncError;
  private scope = "";
  private destroyed = false;
  private readonly listener = () => {
    void this.load();
  };
  async ngOnInit() {
    this.scope = this.auth.scope;
    window.addEventListener("school:sync", this.listener);
    window.addEventListener("school:queue", this.listener);
    await this.load();
  }
  ngOnDestroy() {
    this.destroyed = true;
    window.removeEventListener("school:sync", this.listener);
    window.removeEventListener("school:queue", this.listener);
  }
  current() {
    return !this.destroyed && !!this.scope && this.scope === this.auth.scope;
  }
  async load() {
    if (!this.current()) return;
    this.loading.set(true);
    this.error.set("");
    try {
      const [items, quizzes] = await Promise.all([
        database.outbox.where("scope").equals(this.scope).toArray(),
        quizSubmissions(this.scope),
      ]);
      if (!this.current()) return;
      this.items.set(items.sort((a, b) => a.createdAt - b.createdAt));
      this.quizzes.set(quizzes);
    } catch {
      this.error.set(
        "Impossible de lire les opérations locales. Vérifiez l’espace disponible.",
      );
    } finally {
      this.loading.set(false);
    }
  }
  async retry(item: QueueAction) {
    if (!this.current() || this.busy()) return;
    this.busy.set(item.id);
    try {
      await this.outbox.retry(item.id);
      await this.load();
    } catch {
      this.error.set(
        "La reprise a échoué. Aucune donnée de l’opération n’a été modifiée.",
      );
    } finally {
      this.busy.set("");
    }
  }
}
