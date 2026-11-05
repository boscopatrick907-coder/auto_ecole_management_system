import { Component, EventEmitter, Output, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../services/api.service';
import { LocalDbService } from '../services/local-db.service';
import { ReceiptExportService } from '../services/receipt-export.service';

@Component({
  selector: 'app-student-portal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-[100dvh] bg-[#F4F7FB] pb-24 max-w-md mx-auto relative">
      <!-- ==================== FROSTED LIGHT HEADER ==================== -->
      <header class="sticky top-0 z-30 aem-frosted-chrome px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <img src="/aem-icon.svg" alt="AEM" class="w-9 h-9 rounded-xl shadow-xs" />
          <div>
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-[#D94E28]">AEM • ÉLÈVE</span>
              @if (!api.isOnline()) {
                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#FEF3C7] text-[#D97706]">HORS-LIGNE</span>
              }
            </div>
            <h1 class="text-sm font-bold text-[#0F1E36] truncate max-w-[170px]">
              {{ profile()?.full_name || 'Mon Espace Élève' }}
            </h1>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Install PWA Guide Button -->
          <button
            type="button"
            (click)="showInstallSheet.set(true)"
            class="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-[#E8F2FC] text-[#2B6CA8] border border-[#3D8BCD]/20"
          >
            📲 Installer
          </button>
          <button
            type="button"
            (click)="logout.emit()"
            class="p-2 rounded-xl text-xs font-semibold text-[#4A607A] bg-[#F1F5F9]"
            title="Déconnexion"
          >
            Sortir
          </button>
        </div>
      </header>

      <!-- ==================== MAIN CONTENT ==================== -->
      <main class="px-4 pt-4 space-y-4">
        <!-- Clock Tamper Security Alert -->
        @if (clockTampered()) {
          <div class="p-4 rounded-2xl bg-[#FEF2F2] border border-[#DC2626]/30 text-xs text-[#DC2626] space-y-1">
            <p class="font-extrabold">⚠️ Horloge du téléphone modifiée</p>
            <p>Veuillez remettre votre téléphone à la date et l'heure automatiques et vous reconnecter à Internet.</p>
          </div>
        }

        <!-- Trial / Access Status Banner -->
        @if (profile()) {
          @if (!profile().has_access) {
            <div class="p-4 rounded-2xl bg-[#FFF7ED] border border-[#D94E28]/35 space-y-2.5">
              <div class="flex items-center justify-between">
                <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#D94E28] text-white uppercase">
                  Période d'essai terminée
                </span>
                <span class="text-xs font-bold text-[#D94E28] font-tabular">14 jours écoulés</span>
              </div>
              <h2 class="text-sm font-extrabold text-[#0F1E36]">
                Réglez votre 1er versement pour débloquer tous les cours & quiz
              </h2>
              <p class="text-xs text-[#4A607A]">
                Rendez-vous au secrétariat de l'Auto-École La Marseillaise ou contactez-nous sur WhatsApp pour activer votre accès illimité.
              </p>
              <div class="flex gap-2 pt-1">
                <a
                  href="https://wa.me/237699000001?text=Bonjour%20Auto-%C3%89cole%20La%20Marseillaise%2C%20je%20souhaite%20r%C3%A9gler%20mon%20versement%20pour%20d%C3%A9bloquer%20mon%20compte."
                  target="_blank"
                  rel="noopener"
                  class="flex-1 py-2.5 px-3 rounded-xl text-xs font-bold text-center bg-[#16A34A] text-white"
                >
                  💬 WhatsApp Secrétariat
                </a>
                <button
                  type="button"
                  (click)="activeTab.set('payments')"
                  class="py-2.5 px-3 rounded-xl text-xs font-bold bg-white text-[#0F1E36] border border-[#CBD5E1]"
                >
                  Voir mes frais
                </button>
              </div>
            </div>
          } @else if (!profile().has_paid) {
            <div class="p-3.5 rounded-2xl bg-gradient-to-r from-[#3D8BCD] to-[#2B6CA8] text-white flex items-center justify-between shadow-sm">
              <div>
                <span class="text-[10px] font-bold uppercase tracking-wider text-white/85 block">
                  Essai Gratuit Actif • Permis {{ enrollment()?.category_code || 'B' }}
                </span>
                <p class="text-sm font-extrabold">
                  {{ profile().trial_days_remaining }} jour(s) gratuit(s) restant(s)
                </p>
              </div>
              <button
                type="button"
                (click)="activeTab.set('payments')"
                class="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-[#2B6CA8]"
              >
                Mon dossier
              </button>
            </div>
          } @else {
            <div class="p-3 rounded-2xl bg-[#ECFDF5] border border-[#16A34A]/25 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-[#16A34A]"></span>
                <span class="text-xs font-bold text-[#15803D]">
                  Compte Élève Confirmé • Accès Illimité (Permis {{ enrollment()?.category_code || 'B' }})
                </span>
              </div>
              <span class="text-[11px] font-bold text-[#16A34A] font-tabular">Actif ✓</span>
            </div>
          }
        }

        <!-- ==================== TAB 1: ACCUEIL ==================== -->
        @if (activeTab() === 'home') {
          <!-- Financial Progress Summary Card -->
          @if (enrollment()) {
            <div class="aem-card p-4 space-y-3">
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-[11px] font-bold uppercase tracking-wider text-[#3D8BCD]">
                    {{ enrollment().category_name || 'Permis B' }}
                  </span>
                  <h3 class="text-base font-extrabold text-[#0F1E36]">
                    {{ enrollment().group_name || 'Session en cours' }}
                  </h3>
                </div>
                <span class="px-2.5 py-1 rounded-full text-xs font-extrabold bg-[#E8F2FC] text-[#2B6CA8] font-tabular">
                  {{ paymentPercent() }}% réglé
                </span>
              </div>

              <!-- Progress Bar -->
              <div class="w-full h-2.5 rounded-full bg-[#E2E8F0] overflow-hidden">
                <div
                  class="h-full rounded-full bg-[#3D8BCD] transition-all duration-300"
                  [style.width.%]="paymentPercent()"
                ></div>
              </div>

              <div class="grid grid-cols-3 gap-2 pt-1 text-center">
                <div class="p-2 rounded-xl bg-[#F8FAFC]">
                  <span class="block text-[10px] font-semibold text-[#64748B]">Total Formation</span>
                  <span class="text-xs font-extrabold text-[#0F1E36] font-tabular">
                    {{ enrollment().total_fee | number }} F
                  </span>
                </div>
                <div class="p-2 rounded-xl bg-[#ECFDF5]">
                  <span class="block text-[10px] font-semibold text-[#16A34A]">Déjà Payé</span>
                  <span class="text-xs font-extrabold text-[#16A34A] font-tabular">
                    {{ enrollment().total_paid | number }} F
                  </span>
                </div>
                <div class="p-2 rounded-xl bg-[#FFF7ED]">
                  <span class="block text-[10px] font-semibold text-[#D94E28]">Reste à Payer</span>
                  <span class="text-xs font-extrabold text-[#D94E28] font-tabular">
                    {{ enrollment().balance_due | number }} F
                  </span>
                </div>
              </div>
            </div>
          }

          <!-- Quick Action Cards -->
          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              (click)="activeTab.set('courses')"
              class="aem-card p-4 text-left space-y-2 hover:border-[#3D8BCD] transition-all"
            >
              <div class="w-10 h-10 rounded-xl bg-[#E8F2FC] text-[#3D8BCD] flex items-center justify-center font-bold text-lg">
                📘
              </div>
              <div>
                <h4 class="text-sm font-extrabold text-[#0F1E36]">Cours du Code</h4>
                <p class="text-[11px] text-[#4A607A]">{{ resources().length }} chapitres PDF & Hors-ligne</p>
              </div>
            </button>

            <button
              type="button"
              (click)="activeTab.set('quizzes')"
              class="aem-card p-4 text-left space-y-2 hover:border-[#D94E28] transition-all"
            >
              <div class="w-10 h-10 rounded-xl bg-[#FFF7ED] text-[#D94E28] flex items-center justify-center font-bold text-lg">
                🎯
              </div>
              <div>
                <h4 class="text-sm font-extrabold text-[#0F1E36]">Quiz & Examens</h4>
                <p class="text-[11px] text-[#4A607A]">{{ quizzes().length }} séries chronométrées</p>
              </div>
            </button>
          </div>

          <!-- Recent Quiz Scores -->
          <div class="aem-card p-4 space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-extrabold text-[#0F1E36]">Mes derniers résultats de Quiz</h3>
              <button
                type="button"
                (click)="activeTab.set('quizzes')"
                class="text-xs font-bold text-[#3D8BCD]"
              >
                S'entraîner →
              </button>
            </div>

            @if (attempts().length === 0) {
              <p class="text-xs text-[#64748B] py-2">
                Vous n'avez pas encore passé de test. Lancez votre premier quiz pour évaluer votre niveau !
              </p>
            } @else {
              <div class="space-y-2">
                @for (att of attempts().slice(0, 4); track att.id) {
                  <div class="flex items-center justify-between p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                    <div>
                      <p class="text-xs font-bold text-[#0F1E36]">{{ att.quiz_title }}</p>
                      <p class="text-[10px] text-[#64748B]">{{ att.completed_at | date:'dd/MM/yyyy HH:mm' }}</p>
                    </div>
                    <span
                      [class]="att.passed
                        ? 'px-2.5 py-1 rounded-lg text-xs font-extrabold bg-[#ECFDF5] text-[#16A34A] font-tabular'
                        : 'px-2.5 py-1 rounded-lg text-xs font-extrabold bg-[#FEF2F2] text-[#DC2626] font-tabular'"
                    >
                      {{ att.score_percent }}% {{ att.passed ? 'Réussi' : 'À revoir' }}
                    </span>
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- ==================== TAB 2: COURS & PDF HORS-LIGNE ==================== -->
        @if (activeTab() === 'courses') {
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-base font-extrabold text-[#0F1E36]">Supports de Cours Officiels</h2>
              <p class="text-xs text-[#4A607A]">Téléchargeables pour réviser sans connexion Internet</p>
            </div>
          </div>

          @if (selectedResource()) {
            <!-- In-App Course Reader Modal / View -->
            <div class="aem-card p-5 space-y-4">
              <div class="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
                <div>
                  <span class="text-[10px] font-bold uppercase text-[#3D8BCD]">
                    Fiche de révision • Permis {{ selectedResource().category_code || 'B' }}
                  </span>
                  <h3 class="text-base font-extrabold text-[#0F1E36]">{{ selectedResource().title }}</h3>
                </div>
                <button
                  type="button"
                  (click)="selectedResource.set(null)"
                  class="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#F1F5F9] text-[#0F1E36]"
                >
                  Fermer
                </button>
              </div>

              <p class="text-xs text-[#4A607A] leading-relaxed">
                {{ selectedResource().description }}
              </p>

              <!-- Structured Course Digest for Instant Mobile Reading -->
              <div class="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3 text-xs text-[#0F1E36]">
                <h4 class="font-extrabold text-[#2B6CA8]">Points Clés à Retenir (Code CEMAC / Cameroun) :</h4>
                <ul class="list-disc pl-4 space-y-1.5 text-[#334155]">
                  <li><strong>Priorité à droite :</strong> En l'absence de panneaux ou de feux, cédez toujours le passage aux véhicules venant de votre droite.</li>
                  <li><strong>Limitations de vitesse :</strong> 50 km/h en agglomération, 90 km/h sur route ordinaire, 110 km/h sur autoroute.</li>
                  <li><strong>Équipements obligatoires :</strong> Triangle de pré-signalisation, extincteur fonctionnel, boîte à pharmacie, gilet rétro-réfléchissant.</li>
                  <li><strong>Distances de sécurité :</strong> Laissez au minimum 2 secondes d'intervalle avec le véhicule qui vous précède (3 secondes sous la pluie).</li>
                </ul>
              </div>

              <div class="flex gap-2">
                <button
                  type="button"
                  (click)="downloadCourseOffline(selectedResource())"
                  class="flex-1 py-3 px-4 rounded-xl text-xs font-bold aem-btn-primary"
                >
                  {{ isCached(selectedResource().id) ? '✓ Enregistré Hors-Ligne' : '📥 Enregistrer Hors-Ligne' }}
                </button>
              </div>
            </div>
          } @else {
            <div class="space-y-3">
              @for (res of resources(); track res.id) {
                <div class="aem-card p-4 flex items-start justify-between gap-3">
                  <div class="space-y-1 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-[#E8F2FC] text-[#2B6CA8] uppercase">
                        {{ res.kind === 'pdf' ? 'PDF' : res.kind }}
                      </span>
                      @if (res.is_free_preview) {
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-[#ECFDF5] text-[#16A34A]">
                          Aperçu Gratuit
                        </span>
                      }
                      @if (isCached(res.id)) {
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-[#F0F9FF] text-[#0284C7]">
                          Hors-ligne ✓
                        </span>
                      }
                    </div>
                    <h3 class="text-sm font-extrabold text-[#0F1E36]">{{ res.title }}</h3>
                    <p class="text-xs text-[#4A607A]">{{ res.description }}</p>
                  </div>

                  <div class="flex flex-col gap-1.5 shrink-0">
                    <button
                      type="button"
                      (click)="openCourse(res)"
                      class="px-3.5 py-2 rounded-xl text-xs font-bold aem-btn-primary"
                    >
                      Lire
                    </button>
                    <button
                      type="button"
                      (click)="downloadCourseOffline(res)"
                      class="px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-[#F1F5F9] text-[#4A607A]"
                    >
                      {{ isCached(res.id) ? 'Sauvegardé' : 'Hors-ligne' }}
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        }

        <!-- ==================== TAB 3: QUIZ INTERACTIF & EXAMEN BLANC ==================== -->
        @if (activeTab() === 'quizzes') {
          @if (!activeQuiz()) {
            <div>
              <h2 class="text-base font-extrabold text-[#0F1E36]">Séries de Code & Examens Blancs</h2>
              <p class="text-xs text-[#4A607A]">Correction instantanée avec explication officielle</p>
            </div>

            <div class="space-y-3">
              @for (q of quizzes(); track q.id) {
                <div class="aem-card p-4 space-y-3">
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <span class="text-[10px] font-extrabold uppercase tracking-wider text-[#D94E28]">
                        ⏱ {{ q.time_limit_sec ? (q.time_limit_sec / 60 | number:'1.0-0') + ' min' : 'Libre' }} • Seuil réussite {{ q.pass_threshold }}%
                      </span>
                      <h3 class="text-sm font-extrabold text-[#0F1E36] mt-0.5">{{ q.title }}</h3>
                      <p class="text-xs text-[#4A607A]">{{ q.description }}</p>
                    </div>
                    <span class="px-2.5 py-1 rounded-xl text-xs font-extrabold bg-[#E8F2FC] text-[#2B6CA8] font-tabular shrink-0">
                      {{ q.questions?.length || 0 }} Q.
                    </span>
                  </div>

                  <button
                    type="button"
                    (click)="startQuiz(q)"
                    class="w-full py-3 rounded-xl text-xs font-bold aem-btn-primary"
                  >
                    Démarrer la série
                  </button>
                </div>
              }
            </div>
          } @else {
            <!-- Active Interactive Quiz Engine -->
            <div class="aem-card p-5 space-y-4">
              <div class="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
                <div>
                  <span class="text-[10px] font-bold uppercase text-[#3D8BCD]">
                    Question {{ currentQuestionIndex() + 1 }} / {{ activeQuiz().questions.length }}
                  </span>
                  <h3 class="text-sm font-extrabold text-[#0F1E36]">{{ activeQuiz().title }}</h3>
                </div>
                <button
                  type="button"
                  (click)="quitQuiz()"
                  class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#F1F5F9] text-[#4A607A]"
                >
                  Quitter
                </button>
              </div>

              @if (!quizCompleted()) {
                <!-- Progress Pills -->
                <div class="w-full h-2 rounded-full bg-[#E2E8F0] overflow-hidden">
                  <div
                    class="h-full bg-[#3D8BCD] transition-all duration-200"
                    [style.width.%]="((currentQuestionIndex() + 1) / activeQuiz().questions.length) * 100"
                  ></div>
                </div>

                @if (currentQuestion(); as q) {
                  <div class="space-y-3 pt-1">
                    <p class="text-sm font-extrabold text-[#0F1E36] leading-snug">
                      {{ q.prompt }}
                    </p>

                    <div class="space-y-2">
                      @for (opt of q.options; track opt.id) {
                        <button
                          type="button"
                          (click)="selectAnswer(opt.id)"
                          [class]="getOptionClass(opt.id, q.correct_option)"
                        >
                          <span class="w-6 h-6 rounded-full border flex items-center justify-center text-xs font-extrabold uppercase shrink-0">
                            {{ opt.id }}
                          </span>
                          <span class="text-xs font-semibold text-left flex-1">{{ opt.text }}</span>
                        </button>
                      }
                    </div>

                    @if (answerRevealed() && q.explanation) {
                      <div class="p-3.5 rounded-2xl bg-[#F0F7FF] border border-[#3D8BCD]/30 text-xs text-[#1E4F82]">
                        <strong class="block mb-0.5">💡 Explication pédagogique :</strong>
                        {{ q.explanation }}
                      </div>
                    }

                    @if (answerRevealed()) {
                      <button
                        type="button"
                        (click)="nextQuestion()"
                        class="w-full py-3.5 rounded-xl text-xs font-bold aem-btn-primary"
                      >
                        {{ currentQuestionIndex() + 1 < activeQuiz().questions.length ? 'Question suivante →' : 'Voir mon résultat final' }}
                      </button>
                    }
                  </div>
                }
              } @else {
                <!-- Quiz Final Score Summary -->
                <div class="text-center py-4 space-y-3">
                  <div
                    [class]="quizScorePercent() >= activeQuiz().pass_threshold
                      ? 'w-20 h-20 rounded-full mx-auto flex items-center justify-center text-2xl font-extrabold bg-[#ECFDF5] text-[#16A34A] border-2 border-[#16A34A]'
                      : 'w-20 h-20 rounded-full mx-auto flex items-center justify-center text-2xl font-extrabold bg-[#FFF7ED] text-[#D94E28] border-2 border-[#D94E28]'"
                  >
                    {{ quizScorePercent() }}%
                  </div>

                  <h4 class="text-base font-extrabold text-[#0F1E36]">
                    {{ quizScorePercent() >= activeQuiz().pass_threshold ? 'Félicitations ! Série réussie 🎉' : 'Continuez vos efforts 💪' }}
                  </h4>
                  <p class="text-xs text-[#4A607A]">
                    Seuil de validation requis : {{ activeQuiz().pass_threshold }}%
                  </p>

                  <div class="flex gap-2 pt-2">
                    <button
                      type="button"
                      (click)="startQuiz(activeQuiz())"
                      class="flex-1 py-3 rounded-xl text-xs font-bold bg-[#E8F2FC] text-[#2B6CA8]"
                    >
                      Recommencer
                    </button>
                    <button
                      type="button"
                      (click)="quitQuiz()"
                      class="flex-1 py-3 rounded-xl text-xs font-bold aem-btn-primary"
                    >
                      Retour aux séries
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        }

        <!-- ==================== TAB 4: PAIEMENTS, TRANCHES & REÇUS PDF ==================== -->
        @if (activeTab() === 'payments') {
          <div>
            <h2 class="text-base font-extrabold text-[#0F1E36]">Mon Dossier Financier & Reçus</h2>
            <p class="text-xs text-[#4A607A]">Suivi en temps réel de vos tranches et reçus officiels</p>
          </div>

          <!-- Installment Plan Schedule -->
          <div class="aem-card p-4 space-y-3">
            <h3 class="text-sm font-extrabold text-[#0F1E36]">Échéancier des Tranches</h3>
            <div class="space-y-2">
              @for (inst of installments(); track inst.installment_number) {
                <div class="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
                  <div>
                    <p class="text-xs font-extrabold text-[#0F1E36]">
                      Tranche {{ inst.installment_number }} : {{ inst.label }}
                    </p>
                    <p class="text-[11px] text-[#64748B]">
                      Échéance : {{ inst.due_date | date:'dd/MM/yyyy' }} • Montant : {{ inst.amount_due | number }} FCFA
                    </p>
                  </div>
                  <span
                    [class]="inst.status === 'paid'
                      ? 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-[#ECFDF5] text-[#16A34A]'
                      : inst.status === 'overdue'
                        ? 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-[#FEF2F2] text-[#DC2626]'
                        : 'px-2.5 py-1 rounded-lg text-[11px] font-extrabold bg-[#E8F2FC] text-[#2B6CA8]'"
                  >
                    {{ inst.status === 'paid' ? 'Payé ✓' : inst.status === 'overdue' ? 'En retard' : 'À venir' }}
                  </span>
                </div>
              }
            </div>
          </div>

          <!-- Official Receipts History -->
          <div class="aem-card p-4 space-y-3">
            <h3 class="text-sm font-extrabold text-[#0F1E36]">Mes Reçus Officiels</h3>
            @if (payments().length === 0) {
              <p class="text-xs text-[#64748B] py-2">
                Aucun versement enregistré pour le moment.
              </p>
            } @else {
              <div class="space-y-2.5">
                @for (p of payments(); track p.id) {
                  <div class="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between gap-2">
                    <div>
                      <span class="text-[10px] font-mono font-bold text-[#3D8BCD] block">
                        Reçu N° {{ p.receipt_number }}
                      </span>
                      <p class="text-xs font-extrabold text-[#0F1E36] font-tabular">
                        {{ p.amount | number }} FCFA • {{ formatMethod(p.method) }}
                      </p>
                      <p class="text-[10px] text-[#64748B]">
                        {{ p.paid_at | date:'dd/MM/yyyy HH:mm' }}
                      </p>
                    </div>

                    @if (p.cancelled_at) {
                      <span class="px-2 py-1 rounded text-[10px] font-bold bg-[#FEF2F2] text-[#DC2626]">
                        Annulé
                      </span>
                    } @else {
                      <button
                        type="button"
                        (click)="downloadReceiptPdf(p)"
                        class="px-3 py-2 rounded-xl text-xs font-bold bg-[#E8F2FC] text-[#2B6CA8] border border-[#3D8BCD]/25"
                      >
                        📄 Reçu PDF
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </main>

      <!-- ==================== ANDROID / IOS PWA INSTALL GUIDE SHEET ==================== -->
      @if (showInstallSheet()) {
        <div class="fixed inset-0 z-50 bg-[#0F1E36]/40 backdrop-blur-xs flex items-end justify-center p-4">
          <div class="w-full max-w-md bg-white rounded-3xl p-5 space-y-4 shadow-xl">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-extrabold text-[#0F1E36]">Installer l'Application AEM</h3>
              <button
                type="button"
                (click)="showInstallSheet.set(false)"
                class="w-8 h-8 rounded-full bg-[#F1F5F9] text-[#0F1E36] font-bold"
              >
                ×
              </button>
            </div>
            <p class="text-xs text-[#4A607A]">
              Installez Auto-École La Marseillaise sur l'écran d'accueil de votre téléphone pour réviser vos cours et quiz même sans connexion Internet :
            </p>
            <div class="space-y-2.5 text-xs">
              <div class="p-3 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <strong class="text-[#3D8BCD] block mb-1">🤖 Sur Android (Chrome) :</strong>
                Appuyez sur le menu <strong>⋮</strong> en haut à droite, puis sélectionnez <strong>« Installer l'application »</strong> ou <strong>« Ajouter à l'écran d'accueil »</strong>.
              </div>
              <div class="p-3 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <strong class="text-[#D94E28] block mb-1">🍎 Sur iPhone / iOS (Safari) :</strong>
                Appuyez sur le bouton <strong>Partager (⬆️)</strong> en bas de l'écran, puis choisissez <strong>« Sur l'écran d'accueil »</strong>.
              </div>
            </div>
            <button
              type="button"
              (click)="showInstallSheet.set(false)"
              class="w-full py-3 rounded-xl text-xs font-bold aem-btn-primary"
            >
              J'ai compris
            </button>
          </div>
        </div>
      }

      <!-- ==================== FROSTED BOTTOM TAB BAR (4 TABS) ==================== -->
      <nav class="fixed bottom-0 left-0 right-0 z-30 aem-frosted-bottom-nav pb-safe">
        <div class="max-w-md mx-auto grid grid-cols-4 px-2 py-1.5">
          <button
            type="button"
            (click)="activeTab.set('home')"
            [class]="activeTab() === 'home' ? 'flex flex-col items-center py-1 text-[#3D8BCD]' : 'flex flex-col items-center py-1 text-[#64748B]'"
          >
            <span class="text-base">🏠</span>
            <span class="text-[10px] font-bold mt-0.5">Accueil</span>
          </button>

          <button
            type="button"
            (click)="activeTab.set('courses')"
            [class]="activeTab() === 'courses' ? 'flex flex-col items-center py-1 text-[#3D8BCD]' : 'flex flex-col items-center py-1 text-[#64748B]'"
          >
            <span class="text-base">📘</span>
            <span class="text-[10px] font-bold mt-0.5">Cours</span>
          </button>

          <button
            type="button"
            (click)="activeTab.set('quizzes')"
            [class]="activeTab() === 'quizzes' ? 'flex flex-col items-center py-1 text-[#3D8BCD]' : 'flex flex-col items-center py-1 text-[#64748B]'"
          >
            <span class="text-base">🎯</span>
            <span class="text-[10px] font-bold mt-0.5">Quiz</span>
          </button>

          <button
            type="button"
            (click)="activeTab.set('payments')"
            [class]="activeTab() === 'payments' ? 'flex flex-col items-center py-1 text-[#3D8BCD]' : 'flex flex-col items-center py-1 text-[#64748B]'"
          >
            <span class="text-base">🧾</span>
            <span class="text-[10px] font-bold mt-0.5">Paiements</span>
          </button>
        </div>
      </nav>
    </div>
  `,
})
export class StudentPortalComponent implements OnInit {
  api = inject(ApiService);
  private localDb = inject(LocalDbService);
  private receiptExport = inject(ReceiptExportService);

  @Output() logout = new EventEmitter<void>();

  activeTab = signal<'home' | 'courses' | 'quizzes' | 'payments'>('home');
  showInstallSheet = signal<boolean>(false);
  clockTampered = signal<boolean>(false);

  profile = signal<any>(null);
  enrollment = signal<any>(null);
  installments = signal<any[]>([]);
  payments = signal<any[]>([]);
  attempts = signal<any[]>([]);
  resources = signal<any[]>([]);
  quizzes = signal<any[]>([]);
  cachedResourceIds = signal<Set<string>>(new Set());

  selectedResource = signal<any>(null);

  // Interactive Quiz State
  activeQuiz = signal<any>(null);
  currentQuestionIndex = signal<number>(0);
  selectedAnswers = signal<Record<string, string>>({});
  answerRevealed = signal<boolean>(false);
  quizCompleted = signal<boolean>(false);
  quizScorePercent = signal<number>(0);

  async ngOnInit() {
    const clockOk = await this.localDb.checkAndAdvanceClock();
    if (!clockOk) {
      this.clockTampered.set(true);
    }
    await this.loadData();
  }

  async loadData() {
    try {
      const me = await this.api.getStudentMe();
      if (me) {
        this.profile.set(me.profile);
        this.enrollment.set(me.enrollment);
        this.installments.set(me.installments || []);
        this.payments.set(me.payments || []);
        this.attempts.set(me.recentAttempts || []);
      }
      const resList = await this.api.getStudentResources();
      this.resources.set(resList || []);

      const cached = await this.localDb.resources.toArray();
      this.cachedResourceIds.set(new Set(cached.filter((c: any) => c.blobData).map((c: any) => c.id)));

      const quizList = await this.api.getStudentQuizzes();
      this.quizzes.set(quizList || []);
    } catch {
      // Handled gracefully by offline caches
    }
  }

  paymentPercent(): number {
    const e = this.enrollment();
    if (!e || !e.total_fee) return 0;
    return Math.min(100, Math.round((Number(e.total_paid || 0) / Number(e.total_fee)) * 100));
  }

  isCached(id: string): boolean {
    return this.cachedResourceIds().has(id);
  }

  openCourse(res: any) {
    this.selectedResource.set(res);
  }

  async downloadCourseOffline(res: any) {
    await this.localDb.resources.put({
      id: res.id,
      category_id: res.category_id,
      title: res.title,
      description: res.description || '',
      kind: res.kind,
      storage_path: res.storage_path,
      is_free_preview: !!res.is_free_preview,
      blobData: new Blob([JSON.stringify(res)], { type: 'application/json' }),
      cachedAt: Date.now(),
    });
    const next = new Set(this.cachedResourceIds());
    next.add(res.id);
    this.cachedResourceIds.set(next);
  }

  // Quiz Methods
  currentQuestion() {
    const q = this.activeQuiz();
    if (!q || !q.questions) return null;
    return q.questions[this.currentQuestionIndex()];
  }

  startQuiz(quiz: any) {
    if (!quiz.questions || quiz.questions.length === 0) return;
    this.activeQuiz.set(quiz);
    this.currentQuestionIndex.set(0);
    this.selectedAnswers.set({});
    this.answerRevealed.set(false);
    this.quizCompleted.set(false);
  }

  selectAnswer(optionId: string) {
    if (this.answerRevealed()) return;
    const q = this.currentQuestion();
    if (!q) return;
    this.selectedAnswers.set({ ...this.selectedAnswers(), [q.id]: optionId });
    this.answerRevealed.set(true);
  }

  getOptionClass(optionId: string, correctOption: string): string {
    const q = this.currentQuestion();
    const chosen = q ? this.selectedAnswers()[q.id] : undefined;
    const base = 'w-full p-3.5 rounded-xl border flex items-center gap-3 transition-all ';

    if (!this.answerRevealed()) {
      return base + 'bg-white border-[#CBD5E1] text-[#0F1E36] hover:border-[#3D8BCD]';
    }
    if (optionId === correctOption) {
      return base + 'bg-[#ECFDF5] border-[#16A34A] text-[#15803D]';
    }
    if (chosen === optionId && optionId !== correctOption) {
      return base + 'bg-[#FEF2F2] border-[#DC2626] text-[#DC2626]';
    }
    return base + 'bg-[#F8FAFC] border-[#E2E8F0] text-[#94A3B8]';
  }

  async nextQuestion() {
    const quiz = this.activeQuiz();
    if (!quiz) return;
    if (this.currentQuestionIndex() + 1 < quiz.questions.length) {
      this.currentQuestionIndex.set(this.currentQuestionIndex() + 1);
      this.answerRevealed.set(false);
    } else {
      // Compute score & save
      let correct = 0;
      const ans = this.selectedAnswers();
      for (const q of quiz.questions) {
        if (ans[q.id] === q.correct_option) correct++;
      }
      const pct = Math.round((correct / quiz.questions.length) * 100);
      this.quizScorePercent.set(pct);
      this.quizCompleted.set(true);

      await this.api.submitQuizAttempt(quiz.id, ans, pct, pct >= (quiz.pass_threshold || 80));
      await this.loadData();
    }
  }

  quitQuiz() {
    this.activeQuiz.set(null);
  }

  formatMethod(method: string): string {
    const map: Record<string, string> = {
      cash: 'Espèces',
      orange_money: 'Orange Money',
      mtn_momo: 'MTN MoMo',
      bank_transfer: 'Virement',
      other: 'Autre',
    };
    return map[method] || method;
  }

  downloadReceiptPdf(p: any) {
    const e = this.enrollment();
    const prof = this.profile();
    this.receiptExport.generateReceiptPdf({
      receiptNumber: p.receipt_number,
      studentName: prof?.full_name || 'Élève AEM',
      studentPhone: prof?.phone || '',
      categoryName: e?.category_name || 'Permis B',
      groupName: e?.group_name || 'Session AEM',
      amountPaid: Number(p.amount),
      totalFee: Number(e?.total_fee || 85000),
      totalPaidAfter: Number(e?.total_paid || p.amount),
      balanceRemaining: Number(e?.balance_due || 0),
      method: p.method,
      reference: p.reference,
      paidAt: p.paid_at,
      recordedBy: 'Direction Auto-École La Marseillaise',
    });
  }
}
