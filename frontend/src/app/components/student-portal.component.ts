import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-student-portal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen bg-surface pb-28 text-on-surface font-body">
      <!-- Top App Bar (Stitch Clarté Routière) -->
      <header class="sticky top-0 z-50 bg-surface-container-lowest/90 backdrop-blur-xl px-4 py-3 flex items-center justify-between border-b border-outline-variant/20 shadow-[0_12px_32px_-4px_rgba(24,28,34,0.06)]">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-white font-headline font-bold text-lg shadow-sm relative">
            <span>AEM</span>
            <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-aem-orange border-2 border-white"></span>
          </div>
          <div>
            <p class="font-headline font-bold text-[#00376f] text-sm leading-tight">Auto-école La Marseillaise</p>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="w-2 h-2 rounded-full" [ngClass]="activeTab === 'expired' ? 'bg-error' : 'bg-tertiary'"></span>
              <span class="text-[11px] text-on-surface-variant font-medium">
                {{ activeTab === 'expired' ? 'Accès suspendu • Réactivation' : 'Candidat Permis ' + (user?.license_type || 'B') }}
              </span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Toggle to preview Stitch Screen 05 (Accès Expiré - Réactivation) -->
          <button
            (click)="activeTab = activeTab === 'expired' ? 'home' : 'expired'"
            class="px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all border"
            [ngClass]="activeTab === 'expired' ? 'bg-error text-white border-error' : 'bg-secondary-fixed/50 text-secondary border-secondary/20 hover:bg-secondary-fixed'"
            title="Aperçu Écran Stitch 05 : Accès Expiré"
          >
            <span class="material-symbols-outlined text-sm">timer_off</span>
            <span class="hidden sm:inline">{{ activeTab === 'expired' ? 'Quitter Aperçu Expiré' : 'Écran Essai Expiré' }}</span>
          </button>

          <button
            (click)="logout.emit()"
            class="w-10 h-10 rounded-full bg-surface-container-low hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors"
            title="Déconnexion"
          >
            <span class="material-symbols-outlined text-xl">logout</span>
          </button>
        </div>
      </header>

      <main class="max-w-lg mx-auto px-4 pt-5 space-y-6">

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 02 : ACCUEIL APPRENANT                    -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeTab === 'home'">
          <!-- Candidate Hero Greeting & Status Banner -->
          <section class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Espace Candidat • Yaoundé</p>
                <h1 class="font-headline text-2xl font-extrabold text-on-surface tracking-tight">
                  Bonjour, {{ firstName }} 👋
                </h1>
              </div>
              <span class="px-3 py-1 rounded-full bg-primary/10 text-primary font-headline font-bold text-xs">
                Dossier #LM-4092
              </span>
            </div>

            <!-- Trial / Status Alert Banner -->
            <div class="bg-secondary-fixed/60 border border-secondary/20 rounded-xl p-3.5 flex items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-secondary-container/40 flex items-center justify-center text-secondary shrink-0">
                  <span class="material-symbols-outlined">schedule</span>
                </div>
                <div>
                  <p class="text-xs font-bold text-on-secondary-fixed">Période d'essai gratuite active</p>
                  <p class="text-[11px] text-on-secondary-fixed-variant">
                    Validez votre 1ère tranche ({{ formatFcfa(40000) }} FCFA) pour débloquer les 40h de cours.
                  </p>
                </div>
              </div>
              <button
                (click)="activeTab = 'payments'"
                class="shrink-0 px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold shadow-sm active:scale-95 transition-transform"
              >
                Régler
              </button>
            </div>
          </section>

          <!-- Primary CTA Card: Reprendre ma formation -->
          <section class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary-container text-white p-6 shadow-lg">
            <div class="relative z-10 space-y-4">
              <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-xs font-semibold">
                <span class="material-symbols-outlined text-sm text-secondary-container">menu_book</span>
                <span>Module 2 • Signalisation Routière CEMAC</span>
              </div>

              <div>
                <h2 class="font-headline text-xl font-extrabold leading-snug">
                  Les panneaux d'interdiction et de priorité à Yaoundé
                </h2>
                <p class="text-xs text-on-primary-container mt-1">
                  Chapitre 4 sur 8 • Temps estimé : 12 min
                </p>
              </div>

              <!-- Progress bar -->
              <div class="space-y-1.5">
                <div class="flex justify-between text-xs font-semibold">
                  <span>Progression globale du Code</span>
                  <span class="tabular-nums">{{ progressPercent }}%</span>
                </div>
                <div class="w-full h-2.5 bg-white/20 rounded-full overflow-hidden">
                  <div class="h-full bg-secondary-container rounded-full transition-all duration-500" [style.width.%]="progressPercent"></div>
                </div>
              </div>

              <div class="flex flex-wrap gap-2.5 pt-1">
                <button
                  (click)="activeTab = 'courses'"
                  class="flex-1 min-h-[48px] bg-white text-primary font-headline font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-transform"
                >
                  <span class="material-symbols-outlined text-lg">play_arrow</span>
                  <span>Reprendre le cours</span>
                </button>
                <button
                  (click)="activeTab = 'quiz'"
                  class="min-h-[48px] bg-white/15 hover:bg-white/25 text-white font-headline font-bold text-sm px-4 py-3 rounded-xl flex items-center justify-center gap-1.5 border border-white/20 active:scale-[0.98] transition-transform"
                >
                  <span class="material-symbols-outlined text-lg">quiz</span>
                  <span>Quiz Express</span>
                </button>
              </div>
            </div>
          </section>

          <!-- 2x2 Bento Pedagogical KPIs -->
          <section class="grid grid-cols-2 gap-3.5">
            <div class="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/20 shadow-sm space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-on-surface-variant">Heures de Code</span>
                <span class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <span class="material-symbols-outlined text-lg">school</span>
                </span>
              </div>
              <p class="font-headline text-2xl font-extrabold text-on-surface tabular-nums">18h <span class="text-xs font-normal text-on-surface-variant">/ 40h</span></p>
              <p class="text-[11px] text-tertiary font-semibold flex items-center gap-1">
                <span class="material-symbols-outlined text-xs">check_circle</span> Assiduité régulière
              </p>
            </div>

            <div class="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/20 shadow-sm space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-on-surface-variant">Moyenne Quiz</span>
                <span class="w-8 h-8 rounded-lg bg-tertiary/10 text-tertiary flex items-center justify-center">
                  <span class="material-symbols-outlined text-lg">workspace_premium</span>
                </span>
              </div>
              <p class="font-headline text-2xl font-extrabold text-on-surface tabular-nums">{{ lastScore || 16 }} <span class="text-xs font-normal text-on-surface-variant">/ 20</span></p>
              <p class="text-[11px] text-on-surface-variant">Seuil examen MINTRANS : 16/20</p>
            </div>
          </section>

          <!-- Situation Financière Card (3 Tranches) -->
          <section class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-headline font-bold text-base text-on-surface">Situation Financière (3 Tranches)</h3>
                <p class="text-xs text-on-surface-variant">Forfait Permis {{ user?.license_type || 'B' }} • Total {{ formatFcfa(totalDue) }} FCFA</p>
              </div>
              <button (click)="activeTab = 'payments'" class="text-xs font-bold text-primary flex items-center gap-0.5">
                <span>Détails</span>
                <span class="material-symbols-outlined text-base">chevron_right</span>
              </button>
            </div>

            <div class="grid grid-cols-3 gap-2">
              <div class="p-3 rounded-xl bg-tertiary-fixed/40 border border-tertiary/20">
                <div class="flex items-center justify-between text-[11px] font-bold text-tertiary">
                  <span>Tranche 1</span>
                  <span class="material-symbols-outlined text-sm">check_circle</span>
                </div>
                <p class="font-headline font-extrabold text-sm text-on-surface mt-1 tabular-nums">40 000 F</p>
                <p class="text-[10px] text-tertiary font-semibold">Inscription</p>
              </div>

              <div class="p-3 rounded-xl bg-secondary-fixed/50 border border-secondary/30">
                <div class="flex items-center justify-between text-[11px] font-bold text-secondary">
                  <span>Tranche 2</span>
                  <span class="material-symbols-outlined text-sm">pending</span>
                </div>
                <p class="font-headline font-extrabold text-sm text-on-surface mt-1 tabular-nums">35 000 F</p>
                <p class="text-[10px] text-secondary font-semibold">En cours</p>
              </div>

              <div class="p-3 rounded-xl bg-surface-container-low border border-outline-variant/20">
                <div class="flex items-center justify-between text-[11px] font-bold text-on-surface-variant">
                  <span>Tranche 3</span>
                  <span class="material-symbols-outlined text-sm">lock</span>
                </div>
                <p class="font-headline font-extrabold text-sm text-on-surface mt-1 tabular-nums">20 000 F</p>
                <p class="text-[10px] text-on-surface-variant">Avant examen</p>
              </div>
            </div>
          </section>

          <!-- Prochain Cours en Salle / Pratique -->
          <section class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm flex items-center justify-between gap-4">
            <div class="flex items-center gap-3.5">
              <div class="w-12 h-12 rounded-xl bg-primary-fixed flex flex-col items-center justify-center text-primary font-headline">
                <span class="text-[10px] font-bold uppercase">Jeu</span>
                <span class="text-lg font-extrabold leading-none">18h</span>
              </div>
              <div>
                <span class="inline-block px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold mb-1">Vague du Soir • Bastos</span>
                <h4 class="font-headline font-bold text-sm text-on-surface">Pratique Créneau & Démarrage en côte</h4>
                <p class="text-xs text-on-surface-variant">Moniteur : M. Essomba • Toyota Yaris #04</p>
              </div>
            </div>
            <a
              href="https://wa.me/237677000000"
              target="_blank"
              class="w-11 h-11 rounded-xl bg-[#25D366]/15 text-[#128C7E] flex items-center justify-center shrink-0"
              title="Contacter le secrétariat WhatsApp"
            >
              <span class="material-symbols-outlined">chat</span>
            </a>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 03 : MES COURS (CATALOGUE & LEÇON)        -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeTab === 'courses'">
          <section class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-bold uppercase tracking-wider text-primary">Programme Officiel MINTRANS</p>
                <h1 class="font-headline text-2xl font-extrabold text-on-surface">Mes Cours de Code & Conduite</h1>
              </div>
              <span class="px-3 py-1.5 rounded-xl bg-surface-container-low text-xs font-bold text-on-surface-variant tabular-nums">
                {{ courses.length }} modules
              </span>
            </div>

            <!-- Filter Pills -->
            <div class="flex gap-2 overflow-x-auto pb-1">
              <button
                *ngFor="let cat of courseCategories"
                (click)="selectedCategory = cat.id"
                class="px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all"
                [ngClass]="selectedCategory === cat.id ? 'bg-primary text-white shadow-sm' : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/25'"
              >
                {{ cat.label }}
              </button>
            </div>

            <!-- Course List -->
            <div class="space-y-3">
              <div
                *ngFor="let course of filteredCourses; let i = index"
                (click)="selectedCourse = course"
                class="bg-surface-container-lowest rounded-2xl p-4 border transition-all cursor-pointer"
                [ngClass]="selectedCourse?.id === course.id ? 'border-primary ring-2 ring-primary/15 shadow-md' : 'border-outline-variant/25 hover:border-primary/40 shadow-sm'"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-start gap-3.5">
                    <div
                      class="w-11 h-11 rounded-xl flex items-center justify-center font-headline font-extrabold text-sm shrink-0"
                      [ngClass]="i === 0 ? 'bg-tertiary-fixed text-tertiary' : i === 1 ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant'"
                    >
                      <span class="material-symbols-outlined text-xl">
                        {{ i === 0 ? 'check_circle' : i === 1 ? 'menu_book' : 'play_lesson' }}
                      </span>
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-primary/10 text-primary">
                          Module {{ course.order_index || (i + 1) }}
                        </span>
                        <span class="text-[11px] text-on-surface-variant font-medium">• {{ course.duration_minutes || 25 }} min</span>
                      </div>
                      <h3 class="font-headline font-bold text-base text-on-surface mt-1">{{ course.title_fr }}</h3>
                      <p class="text-xs text-on-surface-variant line-clamp-2 mt-1">{{ course.summary_fr }}</p>
                    </div>
                  </div>
                  <span class="material-symbols-outlined text-on-surface-variant">
                    {{ selectedCourse?.id === course.id ? 'expand_less' : 'chevron_right' }}
                  </span>
                </div>

                <!-- Expanded Reader View -->
                <div *ngIf="selectedCourse?.id === course.id" class="mt-4 pt-4 border-t border-outline-variant/25 space-y-4">
                  <div class="p-4 rounded-xl bg-surface-container-low text-sm text-on-surface leading-relaxed space-y-2">
                    <p class="font-semibold text-primary flex items-center gap-1.5">
                      <span class="material-symbols-outlined text-base">lightbulb</span>
                      <span>Points clés à retenir pour l'examen :</span>
                    </p>
                    <p>{{ course.content_markdown }}</p>
                  </div>

                  <div class="flex items-center justify-between gap-3">
                    <button
                      (click)="activeTab = 'quiz'; $event.stopPropagation()"
                      class="flex-1 min-h-[46px] bg-primary text-white font-headline font-bold text-xs px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm"
                    >
                      <span class="material-symbols-outlined text-base">quiz</span>
                      <span>Tester mes connaissances sur ce module</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 04 : ENTRAÎNEMENT QUIZ INTERACTIF         -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeTab === 'quiz'">
          <section class="space-y-4" *ngIf="questions.length > 0 && !quizSubmitted">
            <!-- Quiz Top Progress Bar -->
            <div class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/25 shadow-sm space-y-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="px-2.5 py-1 rounded-lg bg-primary text-white font-headline font-bold text-xs tabular-nums">
                    Question {{ currentQuestionIndex + 1 }} / {{ questions.length }}
                  </span>
                  <span class="text-xs font-semibold text-on-surface-variant">Code CEMAC • Examen Blanc</span>
                </div>
                <div class="flex items-center gap-1 text-secondary font-headline font-bold text-xs tabular-nums bg-secondary-fixed/50 px-2.5 py-1 rounded-lg">
                  <span class="material-symbols-outlined text-sm">timer</span>
                  <span>00:28</span>
                </div>
              </div>

              <div class="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  class="h-full bg-primary transition-all duration-300 rounded-full"
                  [style.width.%]="((currentQuestionIndex + 1) / questions.length) * 100"
                ></div>
              </div>
            </div>

            <!-- Question Visual Card -->
            <div class="bg-surface-container-lowest rounded-2xl overflow-hidden border border-outline-variant/25 shadow-sm">
              <!-- Simulated Road Scenario Banner -->
              <div class="bg-gradient-to-r from-[#00376f] via-[#1f4e8c] to-[#00376f] p-5 text-white relative">
                <div class="flex items-center justify-between mb-3">
                  <span class="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white/15">
                    Situation Routière #{{ currentQuestionIndex + 1 }}
                  </span>
                  <span class="material-symbols-outlined text-2xl text-secondary-container">traffic</span>
                </div>
                <h2 class="font-headline font-bold text-lg leading-snug">
                  {{ currentQuestion.question_fr }}
                </h2>
              </div>

              <!-- Answer Choices (48px+ Tactile Targets) -->
              <div class="p-4 space-y-2.5">
                <button
                  *ngFor="let opt of currentQuestion.options; let idx = index"
                  (click)="selectOption(idx)"
                  class="w-full min-h-[56px] p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-all"
                  [ngClass]="getOptionClass(idx)"
                >
                  <div class="flex items-center gap-3">
                    <span
                      class="w-8 h-8 rounded-lg font-headline font-extrabold text-xs flex items-center justify-center shrink-0"
                      [ngClass]="selectedAnswers[currentQuestion.id] === idx ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface'"
                    >
                      {{ ['A', 'B', 'C', 'D'][idx] }}
                    </span>
                    <span class="text-sm font-medium text-on-surface">{{ opt }}</span>
                  </div>
                  <span *ngIf="selectedAnswers[currentQuestion.id] === idx" class="material-symbols-outlined text-primary">
                    check_circle
                  </span>
                </button>
              </div>

              <!-- Instant Pedagogical Explanation (shown once option picked) -->
              <div
                *ngIf="selectedAnswers[currentQuestion.id] !== undefined && currentQuestion.explanation_fr"
                class="mx-4 mb-4 p-3.5 rounded-xl bg-primary-fixed/40 border border-primary/20 text-xs text-on-primary-fixed space-y-1"
              >
                <p class="font-bold flex items-center gap-1 text-primary">
                  <span class="material-symbols-outlined text-sm">info</span>
                  <span>Rappel réglementaire MINTRANS :</span>
                </p>
                <p>{{ currentQuestion.explanation_fr }}</p>
              </div>

              <!-- Bottom Navigation -->
              <div class="px-4 py-3.5 bg-surface-container-low border-t border-outline-variant/20 flex items-center justify-between gap-3">
                <button
                  (click)="prevQuestion()"
                  [disabled]="currentQuestionIndex === 0"
                  class="min-h-[48px] px-4 rounded-xl font-headline font-bold text-xs text-on-surface-variant bg-surface-container-lowest border border-outline-variant/30 disabled:opacity-40 flex items-center gap-1"
                >
                  <span class="material-symbols-outlined text-base">arrow_back</span>
                  <span>Précédent</span>
                </button>

                <button
                  *ngIf="currentQuestionIndex < questions.length - 1"
                  (click)="nextQuestion()"
                  class="flex-1 min-h-[48px] bg-primary text-white font-headline font-bold text-sm rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span>Question suivante</span>
                  <span class="material-symbols-outlined text-base">arrow_forward</span>
                </button>

                <button
                  *ngIf="currentQuestionIndex === questions.length - 1"
                  (click)="submitQuiz()"
                  class="flex-1 min-h-[48px] bg-tertiary text-white font-headline font-bold text-sm rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span class="material-symbols-outlined text-base">task_alt</span>
                  <span>Valider ma série</span>
                </button>
              </div>
            </div>
          </section>

          <!-- Quiz Result Card -->
          <section *ngIf="quizSubmitted" class="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/25 shadow-sm text-center space-y-5">
            <div
              class="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
              [ngClass]="quizResult.passed ? 'bg-tertiary-fixed text-tertiary' : 'bg-secondary-fixed text-secondary'"
            >
              <span class="material-symbols-outlined text-4xl">
                {{ quizResult.passed ? 'emoji_events' : 'Menu_book' }}
              </span>
            </div>

            <div>
              <span
                class="px-3 py-1 rounded-full text-xs font-bold"
                [ngClass]="quizResult.passed ? 'bg-tertiary-fixed text-tertiary' : 'bg-secondary-fixed text-secondary'"
              >
                {{ quizResult.passed ? "FÉLICITATIONS • APTE À L'EXAMEN BLANC" : "EN PROGRESSION • CONTINUEZ L'ENTRAÎNEMENT" }}
              </span>
              <h2 class="font-headline text-3xl font-extrabold text-on-surface mt-3 tabular-nums">
                {{ quizResult.score }} / {{ quizResult.total }}
              </h2>
              <p class="text-xs text-on-surface-variant mt-1">
                Soit {{ quizResult.percentage }}% de bonnes réponses • Score enregistré dans votre dossier #LM-4092
              </p>
            </div>

            <div class="flex gap-3 pt-2">
              <button
                (click)="resetQuiz()"
                class="flex-1 min-h-[48px] bg-primary text-white font-headline font-bold text-sm rounded-xl flex items-center justify-center gap-2"
              >
                <span class="material-symbols-outlined text-lg">replay</span>
                <span>Nouvelle série</span>
              </button>
              <button
                (click)="activeTab = 'home'"
                class="flex-1 min-h-[48px] bg-surface-container-low text-on-surface font-headline font-bold text-sm rounded-xl"
              >
                Retour à l'accueil
              </button>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- MES PAIEMENTS & REÇUS OFFICIELS                         -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeTab === 'payments'">
          <section class="space-y-4">
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-primary">Trésorerie & Quittances</p>
              <h1 class="font-headline text-2xl font-extrabold text-on-surface">Mes Paiements & Reçus</h1>
            </div>

            <div class="bg-gradient-to-br from-primary to-primary-container text-white rounded-2xl p-5 shadow-md space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-xs uppercase tracking-wider text-on-primary-container font-semibold">Solde Restant à Payer</span>
                <span class="px-2.5 py-1 rounded-full bg-white/15 text-xs font-bold">Permis {{ user?.license_type || 'B' }}</span>
              </div>
              <p class="font-headline text-3xl font-extrabold tabular-nums">
                {{ formatFcfa(remainingBalance) }} <span class="text-sm font-normal">FCFA</span>
              </p>
              <div class="grid grid-cols-2 gap-3 pt-2 border-t border-white/15 text-xs">
                <div>
                  <span class="text-on-primary-container block">Total Versé</span>
                  <span class="font-headline font-bold text-base tabular-nums">{{ formatFcfa(totalPaid) }} FCFA</span>
                </div>
                <div>
                  <span class="text-on-primary-container block">Coût Formation</span>
                  <span class="font-headline font-bold text-base tabular-nums">{{ formatFcfa(totalDue) }} FCFA</span>
                </div>
              </div>
            </div>

            <!-- Mobile Money USSD Quick Instructions -->
            <div class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-3">
              <h3 class="font-headline font-bold text-sm text-on-surface flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">smartphone</span>
                <span>Payer ma tranche par Mobile Money ou au Guichet</span>
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div class="p-3 rounded-xl bg-[#FFCC00]/15 border border-[#FFCC00]/40">
                  <p class="font-bold text-on-surface">MTN Mobile Money</p>
                  <p class="font-mono font-bold text-primary mt-0.5">*126# • Code Marchand 40921</p>
                </div>
                <div class="p-3 rounded-xl bg-[#FF6600]/15 border border-[#FF6600]/40">
                  <p class="font-bold text-on-surface">Orange Money Cameroun</p>
                  <p class="font-mono font-bold text-primary mt-0.5">#150# • Auto-École Marseillaise</p>
                </div>
              </div>
              <button
                (click)="activeTab = 'expired'"
                class="w-full min-h-[46px] rounded-xl bg-surface-container-low hover:bg-surface-container-high text-primary font-headline font-bold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <span class="material-symbols-outlined text-base">upload_file</span>
                <span>Soumettre une capture de paiement Mobile Money</span>
              </button>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 05 : ACCÈS EXPIRÉ - RÉACTIVATION          -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeTab === 'expired'">
          <section class="space-y-5">
            <!-- Status Alert Card -->
            <div class="bg-surface-container-lowest rounded-2xl p-6 border-2 border-secondary-container shadow-md text-center space-y-3">
              <div class="w-16 h-16 rounded-2xl bg-secondary-fixed text-secondary mx-auto flex items-center justify-center">
                <span class="material-symbols-outlined text-4xl">lock_clock</span>
              </div>
              <span class="inline-block px-3 py-1 rounded-full bg-secondary-fixed text-secondary font-headline font-bold text-xs uppercase tracking-wider">
                Période d'essai de 14 jours terminée
              </span>
              <h1 class="font-headline text-2xl font-extrabold text-on-surface">
                Réactivez votre accès complet
              </h1>
              <p class="text-xs text-on-surface-variant leading-relaxed max-w-sm mx-auto">
                Rassurez-vous, toute votre progression pédagogique est intacte. Réglez votre 1ère tranche d'inscription pour débloquer immédiatement vos cours et examens blancs.
              </p>
            </div>

            <!-- Saved Progress Reassurance Card (Stitch Screen 05) -->
            <div class="bg-primary-fixed/40 rounded-2xl p-4 border border-primary/20 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-primary flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-base">cloud_done</span>
                  <span>Votre progression sauvegardée</span>
                </span>
                <span class="text-[11px] font-bold text-tertiary bg-tertiary-fixed px-2 py-0.5 rounded-full">100% sécurisée</span>
              </div>
              <div class="grid grid-cols-3 gap-2 text-center">
                <div class="bg-surface-container-lowest p-2.5 rounded-xl">
                  <p class="font-headline font-extrabold text-base text-primary tabular-nums">6 / 12</p>
                  <p class="text-[10px] text-on-surface-variant">Cours validés</p>
                </div>
                <div class="bg-surface-container-lowest p-2.5 rounded-xl">
                  <p class="font-headline font-extrabold text-base text-primary tabular-nums">16/20</p>
                  <p class="text-[10px] text-on-surface-variant">Meilleur Quiz</p>
                </div>
                <div class="bg-surface-container-lowest p-2.5 rounded-xl">
                  <p class="font-headline font-extrabold text-base text-primary tabular-nums">#LM-4092</p>
                  <p class="text-[10px] text-on-surface-variant">Dossier actif</p>
                </div>
              </div>
            </div>

            <!-- Payment Method Selector (MTN MoMo / Orange Money / Guichet) -->
            <div class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-4">
              <div class="flex items-center justify-between">
                <h2 class="font-headline font-bold text-base text-on-surface">Choisir un mode de réactivation</h2>
                <span class="font-headline font-extrabold text-sm text-primary tabular-nums">40 000 FCFA</span>
              </div>

              <div class="space-y-2.5">
                <!-- MTN MoMo -->
                <button
                  type="button"
                  (click)="reactivationMethod = 'MTN_MOMO'"
                  class="w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all"
                  [ngClass]="reactivationMethod === 'MTN_MOMO' ? 'border-primary bg-primary-fixed/25 ring-2 ring-primary/15' : 'border-outline-variant/30'"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-[#FFCC00] text-black font-headline font-extrabold text-xs flex items-center justify-center">
                      MoMo
                    </div>
                    <div>
                      <p class="font-headline font-bold text-sm text-on-surface">MTN Mobile Money (*126#)</p>
                      <p class="text-[11px] text-on-surface-variant">Validation rapide par code marchand ou photo reçu</p>
                    </div>
                  </div>
                  <span class="material-symbols-outlined text-primary">
                    {{ reactivationMethod === 'MTN_MOMO' ? 'radio_button_checked' : 'radio_button_unchecked' }}
                  </span>
                </button>

                <!-- Orange Money -->
                <button
                  type="button"
                  (click)="reactivationMethod = 'ORANGE_MONEY'"
                  class="w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all"
                  [ngClass]="reactivationMethod === 'ORANGE_MONEY' ? 'border-primary bg-primary-fixed/25 ring-2 ring-primary/15' : 'border-outline-variant/30'"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-[#FF6600] text-white font-headline font-extrabold text-xs flex items-center justify-center">
                      OM
                    </div>
                    <div>
                      <p class="font-headline font-bold text-sm text-on-surface">Orange Money Cameroun (#150#)</p>
                      <p class="text-[11px] text-on-surface-variant">Paiement instantané sécurisé</p>
                    </div>
                  </div>
                  <span class="material-symbols-outlined text-primary">
                    {{ reactivationMethod === 'ORANGE_MONEY' ? 'radio_button_checked' : 'radio_button_unchecked' }}
                  </span>
                </button>

                <!-- Paiement au Guichet -->
                <button
                  type="button"
                  (click)="reactivationMethod = 'CASH'"
                  class="w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all"
                  [ngClass]="reactivationMethod === 'CASH' ? 'border-primary bg-primary-fixed/25 ring-2 ring-primary/15' : 'border-outline-variant/30'"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center">
                      <span class="material-symbols-outlined">storefront</span>
                    </div>
                    <div>
                      <p class="font-headline font-bold text-sm text-on-surface">Paiement physique au Guichet</p>
                      <p class="text-[11px] text-on-surface-variant">Agence Yaoundé Centre (Bastos / Poste Centrale)</p>
                    </div>
                  </div>
                  <span class="material-symbols-outlined text-primary">
                    {{ reactivationMethod === 'CASH' ? 'radio_button_checked' : 'radio_button_unchecked' }}
                  </span>
                </button>
              </div>

              <!-- Upload Receipt Photo Trigger -->
              <div class="pt-2 space-y-2.5">
                <button
                  type="button"
                  (click)="showUploadModal = true"
                  class="w-full min-h-[52px] bg-primary text-white font-headline font-bold text-sm rounded-xl flex items-center justify-center gap-2 shadow-md active:scale-[0.99] transition-transform"
                >
                  <span class="material-symbols-outlined">add_a_photo</span>
                  <span>Soumettre la photo du reçu / SMS de paiement</span>
                </button>
              </div>
            </div>

            <!-- Mama Célestine Secrétariat Contact Card -->
            <div class="bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/25 shadow-sm flex items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-full bg-secondary-fixed text-secondary font-headline font-extrabold flex items-center justify-center text-base">
                  MC
                </div>
                <div>
                  <p class="font-headline font-bold text-sm text-on-surface">Mama Célestine • Secrétariat</p>
                  <p class="text-xs text-on-surface-variant">Caisse Principale Yaoundé • Lun-Sam 07h30-18h30</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <a
                  href="tel:+237677000000"
                  class="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
                  title="Appeler le secrétariat"
                >
                  <span class="material-symbols-outlined text-lg">call</span>
                </a>
                <a
                  href="https://wa.me/237677000000"
                  target="_blank"
                  class="w-10 h-10 rounded-xl bg-[#25D366] text-white flex items-center justify-center"
                  title="WhatsApp Direct"
                >
                  <span class="material-symbols-outlined text-lg">chat</span>
                </a>
              </div>
            </div>
          </section>

          <!-- Modal Upload Reçu Photo (Stitch Screen 05) -->
          <div
            *ngIf="showUploadModal"
            class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          >
            <div class="bg-surface-container-lowest w-full max-w-md rounded-2xl p-6 space-y-4 shadow-2xl">
              <div class="flex items-center justify-between">
                <h3 class="font-headline font-bold text-lg text-on-surface">Envoyer le justificatif</h3>
                <button (click)="showUploadModal = false" class="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center">
                  <span class="material-symbols-outlined text-base">close</span>
                </button>
              </div>
              <p class="text-xs text-on-surface-variant">
                Saisissez la référence SMS Mobile Money ou joignez la photo de votre reçu. Mama Célestine débloquera votre compte en moins de 15 minutes.
              </p>
              <div class="space-y-3">
                <div>
                  <label class="text-xs font-bold text-on-surface block mb-1">Référence Transaction (ID SMS)</label>
                  <input
                    type="text"
                    [(ngModel)]="txReferenceInput"
                    placeholder="Ex: MP260511.1420.A09412"
                    class="w-full h-12 px-3.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm font-mono"
                  />
                </div>
                <div class="border-2 border-dashed border-primary/30 rounded-xl p-5 text-center bg-primary-fixed/15">
                  <span class="material-symbols-outlined text-3xl text-primary">cloud_upload</span>
                  <p class="text-xs font-bold text-primary mt-1">Appuyez pour prendre en photo le reçu</p>
                  <p class="text-[10px] text-on-surface-variant">JPG, PNG ou capture d'écran SMS (Max 5 Mo)</p>
                </div>
              </div>
              <div class="flex gap-2.5 pt-2">
                <button
                  (click)="submitReactivationProof()"
                  class="flex-1 min-h-[48px] bg-tertiary text-white font-headline font-bold text-sm rounded-xl flex items-center justify-center gap-1.5"
                >
                  <span class="material-symbols-outlined text-base">send</span>
                  <span>Envoyer à la caisse</span>
                </button>
              </div>
              <p *ngIf="reactivationSent" class="text-xs font-bold text-tertiary text-center">
                ✓ Justificatif transmis au guichet Yaoundé Centre !
              </p>
            </div>
          </div>
        </ng-container>

      </main>

      <!-- Bottom Navigation Bar (Stitch Mobile-First 4 Tabs + Expired Preview) -->
      <nav class="fixed bottom-0 inset-x-0 z-40 bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant/25 px-2 py-1.5">
        <div class="max-w-lg mx-auto grid grid-cols-4 gap-1">
          <button
            (click)="activeTab = 'home'"
            class="flex flex-col items-center justify-center py-2 rounded-xl transition-colors"
            [ngClass]="activeTab === 'home' ? 'text-primary bg-primary-fixed/40 font-bold' : 'text-on-surface-variant'"
          >
            <span class="material-symbols-outlined text-xl">home</span>
            <span class="text-[11px] mt-0.5">Accueil</span>
          </button>

          <button
            (click)="activeTab = 'courses'"
            class="flex flex-col items-center justify-center py-2 rounded-xl transition-colors"
            [ngClass]="activeTab === 'courses' ? 'text-primary bg-primary-fixed/40 font-bold' : 'text-on-surface-variant'"
          >
            <span class="material-symbols-outlined text-xl">menu_book</span>
            <span class="text-[11px] mt-0.5">Mes Cours</span>
          </button>

          <button
            (click)="activeTab = 'quiz'"
            class="flex flex-col items-center justify-center py-2 rounded-xl transition-colors"
            [ngClass]="activeTab === 'quiz' ? 'text-primary bg-primary-fixed/40 font-bold' : 'text-on-surface-variant'"
          >
            <span class="material-symbols-outlined text-xl">quiz</span>
            <span class="text-[11px] mt-0.5">Quiz Code</span>
          </button>

          <button
            (click)="activeTab = 'payments'"
            class="flex flex-col items-center justify-center py-2 rounded-xl transition-colors"
            [ngClass]="activeTab === 'payments' || activeTab === 'expired' ? 'text-primary bg-primary-fixed/40 font-bold' : 'text-on-surface-variant'"
          >
            <span class="material-symbols-outlined text-xl">receipt_long</span>
            <span class="text-[11px] mt-0.5">Paiements</span>
          </button>
        </div>
      </nav>
    </div>
  `
})
export class StudentPortalComponent implements OnInit {
  @Input() user: any;
  @Output() logout = new EventEmitter<void>();

  activeTab: 'home' | 'courses' | 'quiz' | 'payments' | 'expired' = 'home';

  courses: any[] = [];
  selectedCourse: any = null;
  selectedCategory = 'ALL';
  courseCategories = [
    { id: 'ALL', label: 'Tous les modules (12)' },
    { id: 'CODE', label: 'Code CEMAC' },
    { id: 'PRATIQUE', label: 'Conduite Pratique' },
    { id: 'SECOURISME', label: 'Secourisme & Mécanique' }
  ];

  questions: any[] = [];
  currentQuestionIndex = 0;
  selectedAnswers: Record<string, number> = {};
  quizSubmitted = false;
  quizResult: any = { score: 0, total: 0, percentage: 0, passed: false };
  lastScore = 17;

  totalDue = 95000;
  totalPaid = 40000;
  progressPercent = 45;

  reactivationMethod: 'MTN_MOMO' | 'ORANGE_MONEY' | 'CASH' = 'MTN_MOMO';
  showUploadModal = false;
  txReferenceInput = '';
  reactivationSent = false;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadStudentData();
  }

  get firstName(): string {
    const full = this.user?.full_name || 'Jean-Paul Mbarga';
    return full.split(' ')[0];
  }

  get remainingBalance(): number {
    return Math.max(0, this.totalDue - this.totalPaid);
  }

  get filteredCourses(): any[] {
    if (this.selectedCategory === 'ALL') return this.courses;
    return this.courses.filter((c) => (c.category || 'CODE').toUpperCase().includes(this.selectedCategory));
  }

  get currentQuestion(): any {
    return this.questions[this.currentQuestionIndex] || {
      id: 'q1',
      question_fr: 'À une intersection sans signalisation à Yaoundé, quelle règle appliquez-vous ?',
      options: [
        'Priorité au véhicule venant de droite',
        'Priorité au véhicule le plus rapide',
        'Priorité aux taxis uniquement',
        'Arrêt obligatoire même sans panneau'
      ],
      correct_index: 0,
      explanation_fr: 'En l\'absence de signalisation routière, la règle générale du Code CEMAC impose la priorité à droite.'
    };
  }

  loadStudentData(): void {
    this.api.getCourses().subscribe((list) => {
      if (list && list.length > 0) {
        this.courses = list;
        this.selectedCourse = list[0];
      } else {
        this.courses = [
          {
            id: 'c1',
            order_index: 1,
            category: 'CODE',
            duration_minutes: 25,
            title_fr: 'Signalisation verticale & Panneaux de priorité CEMAC',
            summary_fr: 'Maîtrisez les panneaux de danger, d\'interdiction et les règles de priorité aux ronds-points de Yaoundé.',
            content_markdown: 'Les panneaux triangulaires à bordure rouge annoncent un danger à 150m en rase campagne et 50m en agglomération. Au rond-point de la Poste Centrale, cédez le passage aux usagers déjà engagés sur l\'anneau.'
          },
          {
            id: 'c2',
            order_index: 2,
            category: 'CODE',
            duration_minutes: 30,
            title_fr: 'Règles de croisement, dépassement et distances de sécurité',
            summary_fr: 'Calculer la distance d\'arrêt par temps de pluie et visibilité réduite sur l\'axe Yaoundé-Douala.',
            content_markdown: 'Sur chaussée mouillée, la distance de freinage est multipliée par 2. Gardez toujours un intervalle d\'au moins 2 secondes derrière le véhicule qui vous précède.'
          },
          {
            id: 'c3',
            order_index: 3,
            category: 'PRATIQUE',
            duration_minutes: 45,
            title_fr: 'Maîtrise du point de patinage, démarrage en côte et créneau',
            summary_fr: 'Techniques pratiques sur véhicule double commande Toyota Yaris pour réussir l\'épreuve pratique MINTRANS.',
            content_markdown: 'Maintenez le frein à main enclenché, cherchez le point de patinage jusqu\'à sentir une légère vibration du capot, puis relâchez progressivement le frein à main tout en stabilisant l\'accélérateur.'
          }
        ];
        this.selectedCourse = this.courses[0];
      }
    });

    this.api.getQuizQuestions().subscribe((qs) => {
      if (qs && qs.length > 0) {
        this.questions = qs;
      } else {
        this.questions = [
          {
            id: 'q1',
            question_fr: 'En agglomération à Yaoundé, quelle est la vitesse maximale autorisée par défaut ?',
            options: ['50 km/h', '60 km/h', '70 km/h', '80 km/h'],
            correct_index: 0,
            explanation_fr: 'Sauf indication contraire, la vitesse maximale en agglomération dans la zone CEMAC est limitée à 50 km/h.'
          },
          {
            id: 'q2',
            question_fr: 'Quel document est obligatoire lors d\'un contrôle routier pour un élève en cours d\'apprentissage ?',
            options: [
              'Le livret d\'apprentissage validé par l\'auto-école agréée MINTRANS',
              'Uniquement la photocopie de la CNI',
              'Le reçu de caisse seul',
              'Aucun document si le moniteur est présent'
            ],
            correct_index: 0,
            explanation_fr: 'Tout apprenti conducteur doit pouvoir présenter son livret d\'apprentissage et l\'agrément de l\'auto-école.'
          },
          {
            id: 'q3',
            question_fr: 'Face à un feu jaune fixe, que devez-vous faire ?',
            options: [
              'Vous arrêter, sauf si l\'arrêt ne peut plus se faire dans des conditions de sécurité suffisantes',
              'Accélérer systématiquement pour passer avant le rouge',
              'Klaxonner et passer',
              'Allumer les feux de détresse'
            ],
            correct_index: 0,
            explanation_fr: 'Le feu jaune annonce l\'allumage imminent du feu rouge : l\'arrêt est obligatoire sauf danger immédiat de collision arrière.'
          }
        ];
      }
    });
  }

  selectOption(idx: number): void {
    this.selectedAnswers[this.currentQuestion.id] = idx;
  }

  getOptionClass(idx: number): string {
    const picked = this.selectedAnswers[this.currentQuestion.id];
    if (picked === idx) {
      return 'border-primary bg-primary-fixed/30 ring-2 ring-primary/20 font-semibold';
    }
    return 'border-outline-variant/30 bg-surface-container-lowest hover:bg-surface-container-low';
  }

  prevQuestion(): void {
    if (this.currentQuestionIndex > 0) {
      this.currentQuestionIndex--;
    }
  }

  nextQuestion(): void {
    if (this.currentQuestionIndex < this.questions.length - 1) {
      this.currentQuestionIndex++;
    }
  }

  submitQuiz(): void {
    this.api.submitQuiz(this.selectedAnswers).subscribe((res) => {
      this.quizResult = res;
      this.lastScore = Math.round((res.percentage / 100) * 20);
      this.quizSubmitted = true;
    });
  }

  resetQuiz(): void {
    this.selectedAnswers = {};
    this.currentQuestionIndex = 0;
    this.quizSubmitted = false;
  }

  submitReactivationProof(): void {
    this.reactivationSent = true;
    setTimeout(() => {
      this.showUploadModal = false;
      this.reactivationSent = false;
      this.activeTab = 'home';
    }, 1200);
  }

  formatFcfa(amount: number): string {
    return Math.round(amount || 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
}
