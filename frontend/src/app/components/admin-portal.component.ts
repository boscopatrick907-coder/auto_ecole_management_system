import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';
import { ReceiptPdfService } from '../services/receipt-pdf.service';

export type AdminScreen =
  | 'dashboard'      // Screen 06: Tableau de bord Admin
  | 'cashier'        // Screen 07: Enregistrer un paiement
  | 'receipt'        // Screen 08: Aperçu & Export Reçu Officiel PDF
  | 'students'       // Screen 09: Liste des Élèves
  | 'new-student'    // Screen 10: Inscrire un nouvel élève
  | 'student-detail' // Screen 11: Fiche Détaillée Élève
  | 'groups'         // Screen 12: Gestion des Groupes
  | 'journal'        // Screen 13: Journal des Reçus du Jour
  | 'monthly-report';// Screen 14: Rapport Mensuel des Recettes

@Component({
  selector: 'app-admin-portal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen bg-surface pb-28 text-on-surface font-body">
      <!-- Top App Bar (Stitch Clarté Routière Admin) -->
      <header class="sticky top-0 z-50 bg-surface-container-lowest/90 backdrop-blur-xl px-4 py-3 flex items-center justify-between border-b border-outline-variant/20 shadow-[0_12px_32px_-4px_rgba(24,28,34,0.06)]">
        <div class="flex items-center gap-3">
          <button
            *ngIf="activeScreen !== 'dashboard'"
            (click)="activeScreen = 'dashboard'"
            class="w-10 h-10 rounded-full hover:bg-surface-container-low flex items-center justify-center text-primary transition-colors"
            title="Retour Tableau de bord"
          >
            <span class="material-symbols-outlined">arrow_back</span>
          </button>

          <div *ngIf="activeScreen === 'dashboard'" class="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-white font-headline font-bold text-lg shadow-sm relative">
            <span>AEM</span>
            <span class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-aem-orange border-2 border-white"></span>
          </div>

          <div>
            <p class="font-headline font-bold text-[#00376f] text-sm leading-tight">
              {{ getScreenTitle() }}
            </p>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="w-2 h-2 rounded-full bg-tertiary"></span>
              <span class="text-[11px] text-on-surface-variant font-medium">
                Agence Yaoundé Centre • Agrément N° 00412/MINT/DTT
              </span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Screen Switcher Pill for testing all 9 Admin Stitch Screens -->
          <select
            [(ngModel)]="activeScreen"
            class="h-9 px-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs font-headline font-bold text-primary focus:outline-none"
            title="Naviguer entre les 9 écrans Admin Stitch"
          >
            <option value="dashboard">06 • Tableau de bord</option>
            <option value="cashier">07 • Enregistrer paiement</option>
            <option value="receipt">08 • Aperçu Reçu PDF</option>
            <option value="students">09 • Liste des Élèves</option>
            <option value="new-student">10 • Inscrire un élève</option>
            <option value="student-detail">11 • Fiche Détaillée Élève</option>
            <option value="groups">12 • Gestion des Groupes</option>
            <option value="journal">13 • Journal Reçus du Jour</option>
            <option value="monthly-report">14 • Rapport Mensuel Recettes</option>
          </select>

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
        <!-- STITCH SCREEN 06 : TABLEAU DE BORD ADMIN                -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeScreen === 'dashboard'">
          <section class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-bold uppercase tracking-wider text-primary">Guichet Principal • Bastos</p>
                <h1 class="font-headline text-2xl font-extrabold text-on-surface tracking-tight">
                  Bonjour Mama Célestine 👋
                </h1>
              </div>
              <button
                (click)="activeScreen = 'monthly-report'"
                class="px-3 py-1.5 rounded-xl bg-primary-fixed text-primary font-headline font-bold text-xs flex items-center gap-1"
              >
                <span class="material-symbols-outlined text-sm">bar_chart</span>
                <span>Bilan Mensuel</span>
              </button>
            </div>

            <!-- Giant Primary CTA: Enregistrer un paiement -->
            <button
              (click)="activeScreen = 'cashier'"
              class="w-full min-h-[64px] rounded-2xl bg-gradient-to-r from-primary to-primary-container text-white p-4 shadow-lg flex items-center justify-between active:scale-[0.99] transition-transform"
            >
              <div class="flex items-center gap-3.5 text-left">
                <div class="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center">
                  <span class="material-symbols-outlined text-2xl text-secondary-container">point_of_sale</span>
                </div>
                <div>
                  <span class="font-headline font-extrabold text-base block">Enregistrer un paiement</span>
                  <span class="text-xs text-on-primary-container">Espèces, MTN MoMo, Orange Money • Quittance PDF</span>
                </div>
              </div>
              <span class="material-symbols-outlined text-2xl">arrow_forward_ios</span>
            </button>

            <!-- 2x2 Bento KPI Grid -->
            <div class="grid grid-cols-2 gap-3.5">
              <div
                (click)="activeScreen = 'journal'"
                class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/25 shadow-sm space-y-1.5 cursor-pointer hover:border-primary/40 transition-all"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs font-semibold text-on-surface-variant">Encaissé Aujourd'hui</span>
                  <span class="w-8 h-8 rounded-lg bg-tertiary-fixed text-tertiary flex items-center justify-center">
                    <span class="material-symbols-outlined text-lg">payments</span>
                  </span>
                </div>
                <p class="font-headline text-xl font-extrabold text-on-surface tabular-nums">
                  {{ formatFcfa(todayCollected) }} <span class="text-xs font-normal">F</span>
                </p>
                <p class="text-[11px] text-tertiary font-bold flex items-center gap-1">
                  <span class="material-symbols-outlined text-xs">trending_up</span>
                  <span>{{ payments.length }} reçus émis</span>
                </p>
              </div>

              <div
                (click)="activeScreen = 'students'"
                class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/25 shadow-sm space-y-1.5 cursor-pointer hover:border-primary/40 transition-all"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs font-semibold text-on-surface-variant">Élèves Actifs</span>
                  <span class="w-8 h-8 rounded-lg bg-primary-fixed text-primary flex items-center justify-center">
                    <span class="material-symbols-outlined text-lg">groups</span>
                  </span>
                </div>
                <p class="font-headline text-xl font-extrabold text-on-surface tabular-nums">
                  {{ students.length || 48 }} <span class="text-xs font-normal">inscrits</span>
                </p>
                <p class="text-[11px] text-primary font-semibold">4 vagues en cours</p>
              </div>

              <div
                (click)="activeScreen = 'students'"
                class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/25 shadow-sm space-y-1.5 cursor-pointer hover:border-primary/40 transition-all"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs font-semibold text-on-surface-variant">Essais (14 jours)</span>
                  <span class="w-8 h-8 rounded-lg bg-secondary-fixed text-secondary flex items-center justify-center">
                    <span class="material-symbols-outlined text-lg">hourglass_top</span>
                  </span>
                </div>
                <p class="font-headline text-xl font-extrabold text-on-surface tabular-nums">7 <span class="text-xs font-normal">élèves</span></p>
                <p class="text-[11px] text-secondary font-bold">3 expirent sous 48h</p>
              </div>

              <div
                (click)="activeScreen = 'monthly-report'"
                class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/25 shadow-sm space-y-1.5 cursor-pointer hover:border-primary/40 transition-all"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs font-semibold text-on-surface-variant">Reste à Recouvrer</span>
                  <span class="w-8 h-8 rounded-lg bg-error-container text-error flex items-center justify-center">
                    <span class="material-symbols-outlined text-lg">account_balance_wallet</span>
                  </span>
                </div>
                <p class="font-headline text-xl font-extrabold text-on-surface tabular-nums">1 420 000 <span class="text-xs font-normal">F</span></p>
                <p class="text-[11px] text-error font-semibold">Tranches 2 & 3 attendues</p>
              </div>
            </div>

            <!-- Quick Action Tiles -->
            <div class="grid grid-cols-3 gap-2.5">
              <button
                (click)="activeScreen = 'new-student'"
                class="p-3 rounded-xl bg-surface-container-lowest border border-outline-variant/25 shadow-sm flex flex-col items-center gap-1.5 text-center hover:border-primary/40"
              >
                <span class="material-symbols-outlined text-primary text-2xl">person_add</span>
                <span class="font-headline font-bold text-xs text-on-surface">Inscrire Élève</span>
              </button>

              <button
                (click)="activeScreen = 'groups'"
                class="p-3 rounded-xl bg-surface-container-lowest border border-outline-variant/25 shadow-sm flex flex-col items-center gap-1.5 text-center hover:border-primary/40"
              >
                <span class="material-symbols-outlined text-primary text-2xl">calendar_month</span>
                <span class="font-headline font-bold text-xs text-on-surface">Vagues / Groupes</span>
              </button>

              <button
                (click)="activeScreen = 'journal'"
                class="p-3 rounded-xl bg-surface-container-lowest border border-outline-variant/25 shadow-sm flex flex-col items-center gap-1.5 text-center hover:border-primary/40"
              >
                <span class="material-symbols-outlined text-primary text-2xl">receipt_long</span>
                <span class="font-headline font-bold text-xs text-on-surface">Journal Caisse</span>
              </button>
            </div>

            <!-- À traiter en priorité (Stitch Screen 06) -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <h2 class="font-headline font-bold text-base text-on-surface">À traiter en priorité</h2>
                <button (click)="activeScreen = 'students'" class="text-xs font-bold text-primary">Voir tout</button>
              </div>

              <div
                *ngFor="let st of students.slice(0, 3)"
                class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/25 shadow-sm flex items-center justify-between gap-3"
              >
                <div class="flex items-center gap-3 cursor-pointer" (click)="openStudentDetail(st)">
                  <div class="w-11 h-11 rounded-xl bg-primary-fixed text-primary font-headline font-extrabold text-sm flex items-center justify-center">
                    {{ getInitials(st.full_name) }}
                  </div>
                  <div>
                    <p class="font-headline font-bold text-sm text-on-surface">{{ st.full_name }}</p>
                    <p class="text-xs text-on-surface-variant tabular-nums">
                      Permis {{ st.license_type || 'B' }} • Reste : <strong class="text-error">{{ formatFcfa((st.total_due || 95000) - (st.total_paid || 40000)) }} FCFA</strong>
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-1.5">
                  <button
                    (click)="prefillCashierForStudent(st)"
                    class="px-3 py-2 rounded-xl bg-primary text-white font-headline font-bold text-xs shadow-sm"
                  >
                    Encaisser
                  </button>
                </div>
              </div>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 07 : ENREGISTRER UN PAIEMENT (CAISSE)     -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeScreen === 'cashier'">
          <section class="space-y-5">
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-primary">Guichet Caisse #1 • Bastos</p>
              <h1 class="font-headline text-2xl font-extrabold text-on-surface">Enregistrer un paiement</h1>
            </div>

            <div class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-4">
              <!-- Select Student -->
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">
                  1. Sélectionner l'élève
                </label>
                <select
                  [(ngModel)]="paymentForm.student_id"
                  (change)="onSelectPaymentStudent()"
                  class="w-full h-12 px-3.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm font-semibold text-on-surface"
                >
                  <option *ngFor="let s of students" [value]="s.id">
                    {{ s.full_name }} ({{ s.phone }}) — Permis {{ s.license_type || 'B' }}
                  </option>
                </select>
              </div>

              <!-- Selected Student Balance Summary -->
              <div *ngIf="selectedPaymentStudent" class="p-3.5 rounded-xl bg-primary-fixed/30 border border-primary/20 flex items-center justify-between text-xs">
                <div>
                  <span class="text-on-surface-variant block">Déjà versé</span>
                  <strong class="font-headline text-sm text-tertiary tabular-nums">{{ formatFcfa(selectedPaymentStudent.total_paid || 40000) }} FCFA</strong>
                </div>
                <div class="text-right">
                  <span class="text-on-surface-variant block">Reste à solder</span>
                  <strong class="font-headline text-sm text-error tabular-nums">
                    {{ formatFcfa((selectedPaymentStudent.total_due || 95000) - (selectedPaymentStudent.total_paid || 40000)) }} FCFA
                  </strong>
                </div>
              </div>

              <!-- Quick Installment Presets (Tranche 1 / 2 / 3) -->
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">
                  2. Choisir la tranche ou saisir le montant (FCFA)
                </label>
                <div class="grid grid-cols-3 gap-2 mb-2.5">
                  <button
                    type="button"
                    (click)="setTranche(1, 40000, '1ère Tranche - Inscription & Code')"
                    class="p-2.5 rounded-xl border text-center transition-all"
                    [ngClass]="paymentForm.installment_number === 1 ? 'border-primary bg-primary text-white font-bold' : 'border-outline-variant/30 bg-surface-container-low'"
                  >
                    <span class="text-[10px] block uppercase">Tranche 1</span>
                    <span class="font-headline font-extrabold text-xs tabular-nums">40 000 F</span>
                  </button>
                  <button
                    type="button"
                    (click)="setTranche(2, 35000, '2ème Tranche - Conduite Pratique')"
                    class="p-2.5 rounded-xl border text-center transition-all"
                    [ngClass]="paymentForm.installment_number === 2 ? 'border-primary bg-primary text-white font-bold' : 'border-outline-variant/30 bg-surface-container-low'"
                  >
                    <span class="text-[10px] block uppercase">Tranche 2</span>
                    <span class="font-headline font-extrabold text-xs tabular-nums">35 000 F</span>
                  </button>
                  <button
                    type="button"
                    (click)="setTranche(3, 20000, '3ème Tranche - Dossier Examen MINTRANS')"
                    class="p-2.5 rounded-xl border text-center transition-all"
                    [ngClass]="paymentForm.installment_number === 3 ? 'border-primary bg-primary text-white font-bold' : 'border-outline-variant/30 bg-surface-container-low'"
                  >
                    <span class="text-[10px] block uppercase">Tranche 3</span>
                    <span class="font-headline font-extrabold text-xs tabular-nums">20 000 F</span>
                  </button>
                </div>

                <input
                  type="number"
                  [(ngModel)]="paymentForm.amount"
                  class="w-full h-14 px-4 rounded-xl bg-surface-container-low border border-outline-variant/40 font-headline font-extrabold text-xl text-primary tabular-nums"
                />
              </div>

              <!-- Payment Channel Selector -->
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">
                  3. Canal d'encaissement
                </label>
                <div class="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    (click)="paymentForm.payment_method = 'CASH'"
                    class="p-3 rounded-xl border flex flex-col items-center gap-1 transition-all"
                    [ngClass]="paymentForm.payment_method === 'CASH' ? 'border-primary bg-primary-fixed/40 font-bold text-primary' : 'border-outline-variant/30'"
                  >
                    <span class="material-symbols-outlined">payments</span>
                    <span class="text-xs">Espèces</span>
                  </button>
                  <button
                    type="button"
                    (click)="paymentForm.payment_method = 'MTN_MOMO'"
                    class="p-3 rounded-xl border flex flex-col items-center gap-1 transition-all"
                    [ngClass]="paymentForm.payment_method === 'MTN_MOMO' ? 'border-primary bg-primary-fixed/40 font-bold text-primary' : 'border-outline-variant/30'"
                  >
                    <span class="material-symbols-outlined">smartphone</span>
                    <span class="text-xs">MTN MoMo</span>
                  </button>
                  <button
                    type="button"
                    (click)="paymentForm.payment_method = 'ORANGE_MONEY'"
                    class="p-3 rounded-xl border flex flex-col items-center gap-1 transition-all"
                    [ngClass]="paymentForm.payment_method === 'ORANGE_MONEY' ? 'border-primary bg-primary-fixed/40 font-bold text-primary' : 'border-outline-variant/30'"
                  >
                    <span class="material-symbols-outlined">account_balance_wallet</span>
                    <span class="text-xs">Orange OM</span>
                  </button>
                </div>
              </div>

              <!-- Submit & Generate Official Receipt -->
              <button
                type="button"
                (click)="submitCashierPayment()"
                class="w-full min-h-[54px] rounded-xl bg-tertiary text-white font-headline font-bold text-base shadow-md flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
              >
                <span class="material-symbols-outlined">verified</span>
                <span>Valider & Émettre le Reçu Officiel</span>
              </button>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 08 : APERÇU & EXPORT REÇU OFFICIEL PDF    -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeScreen === 'receipt'">
          <section class="space-y-5">
            <!-- Official Document Preview Card (Stitch Screen 08) -->
            <div class="bg-surface-container-lowest rounded-2xl p-6 shadow-[0_12px_32px_-4px_rgba(24,28,34,0.08)] relative overflow-hidden border border-outline-variant/30">
              <!-- Top Tri-color Accent Strip -->
              <div class="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-[#00376f] via-[#1f4e8c] to-[#feae2c]"></div>

              <!-- Watermark Stamp -->
              <div class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04] select-none">
                <div class="border-8 border-primary rounded-full p-8 -rotate-12 flex flex-col items-center">
                  <span class="font-headline font-black text-4xl tracking-widest text-primary">LA MARSEILLAISE</span>
                  <span class="font-headline font-bold text-xl tracking-widest text-primary">OFFICIEL VALIDÉ</span>
                </div>
              </div>

              <!-- Bilingual Official Header -->
              <div class="flex justify-between items-start pt-2 pb-4 border-b border-dashed border-outline-variant">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 bg-primary-fixed text-primary font-headline font-bold text-[10px] rounded uppercase tracking-wider">
                      Agrément MINTRANS N° 00412/MINT/DTT
                    </span>
                  </div>
                  <h2 class="font-headline font-extrabold text-lg text-primary tracking-tight pt-1">
                    AUTO-ÉCOLE LA MARSEILLAISE
                  </h2>
                  <p class="text-xs text-on-surface-variant">
                    Direction Générale : Carrefour Bastos, Yaoundé • Tél : (+237) 677 82 91 04
                  </p>
                </div>
                <div class="text-right shrink-0">
                  <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-tertiary-fixed text-tertiary font-headline font-bold text-[11px]">
                    <span class="material-symbols-outlined text-xs">verified</span>
                    Payé & Validé
                  </span>
                  <p class="font-mono text-xs font-bold text-on-surface mt-1.5">{{ activeReceipt.receipt_number }}</p>
                  <p class="text-[10px] text-on-surface-variant">{{ activeReceipt.created_at }}</p>
                </div>
              </div>

              <!-- Candidate Identity & Tranche Progress -->
              <div class="py-4 grid grid-cols-2 gap-3 border-b border-dashed border-outline-variant text-xs">
                <div>
                  <span class="text-on-surface-variant block">Candidat(e)</span>
                  <strong class="font-headline text-sm text-on-surface">{{ activeReceipt.student_name }}</strong>
                  <span class="text-[11px] text-on-surface-variant block">{{ activeReceipt.student_phone }} • Dossier #LM-4092</span>
                </div>
                <div class="text-right">
                  <span class="text-on-surface-variant block">Catégorie & Vague</span>
                  <strong class="font-headline text-sm text-primary">Permis {{ activeReceipt.license_type }} (Voiture)</strong>
                  <span class="text-[11px] text-on-surface-variant block">Vague du Soir 18h-20h</span>
                </div>
              </div>

              <!-- Financial Breakdown -->
              <div class="py-4 space-y-3 border-b border-dashed border-outline-variant">
                <div class="flex justify-between items-center bg-primary-fixed/30 p-3.5 rounded-xl">
                  <div>
                    <span class="text-[11px] font-bold uppercase text-primary block">Objet du versement</span>
                    <strong class="font-headline text-sm text-on-surface">{{ activeReceipt.notes }}</strong>
                    <span class="text-[11px] text-on-surface-variant block">Mode : {{ activeReceipt.payment_method }}</span>
                  </div>
                  <div class="text-right">
                    <span class="text-[10px] uppercase font-bold text-on-surface-variant block">Montant Encaissé</span>
                    <span class="font-headline font-extrabold text-xl text-primary tabular-nums">
                      {{ formatFcfa(activeReceipt.amount) }} FCFA
                    </span>
                  </div>
                </div>

                <!-- 3-Tranche Visual Gauge -->
                <div class="space-y-1.5">
                  <div class="flex justify-between text-[11px] font-semibold">
                    <span class="text-on-surface-variant">Progression Financière Totale</span>
                    <span class="text-tertiary font-bold tabular-nums">
                      {{ formatFcfa(activeReceipt.total_paid) }} / {{ formatFcfa(activeReceipt.total_due) }} FCFA
                    </span>
                  </div>
                  <div class="w-full h-2.5 bg-surface-container-high rounded-full overflow-hidden">
                    <div
                      class="h-full bg-tertiary rounded-full"
                      [style.width.%]="(activeReceipt.total_paid / activeReceipt.total_due) * 100"
                    ></div>
                  </div>
                  <div class="flex justify-between text-[11px]">
                    <span class="text-on-surface-variant">Reste à payer avant examen :</span>
                    <strong class="text-error tabular-nums">
                      {{ formatFcfa(activeReceipt.total_due - activeReceipt.total_paid) }} FCFA
                    </strong>
                  </div>
                </div>
              </div>

              <!-- QR Code, Circular Stamp & Mama Célestine Signature -->
              <div class="pt-4 flex items-center justify-between gap-3">
                <div class="flex items-center gap-2.5">
                  <div class="w-14 h-14 rounded-lg bg-surface-container-low border border-outline-variant p-1.5 flex items-center justify-center">
                    <span class="material-symbols-outlined text-3xl text-primary">qr_code_2</span>
                  </div>
                  <div class="text-[10px] text-on-surface-variant leading-tight">
                    <strong class="text-on-surface block">Authenticité Vérifiée</strong>
                    <span>Scanner pour contrôler</span>
                    <span class="block font-mono">SHA-256 • AEM-YDE</span>
                  </div>
                </div>

                <div class="text-right">
                  <div class="inline-block border-2 border-primary/60 rounded-lg px-2.5 py-1 text-[10px] font-headline font-extrabold text-primary uppercase -rotate-3">
                    DIRECTION CAISSE • VALIDÉ
                  </div>
                  <p class="text-[11px] font-semibold text-on-surface mt-1">La Caissière : {{ activeReceipt.cashier_name }}</p>
                </div>
              </div>
            </div>

            <!-- Action Buttons: Download PDF & WhatsApp Share -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                (click)="downloadReceiptPdf()"
                class="min-h-[52px] rounded-xl bg-primary text-white font-headline font-bold text-sm flex items-center justify-center gap-2 shadow-md"
              >
                <span class="material-symbols-outlined">picture_as_pdf</span>
                <span>Télécharger le PDF Officiel</span>
              </button>

              <a
                [href]="getWhatsAppReceiptUrl()"
                target="_blank"
                class="min-h-[52px] rounded-xl bg-[#25D366] text-white font-headline font-bold text-sm flex items-center justify-center gap-2 shadow-md"
              >
                <span class="material-symbols-outlined">send</span>
                <span>Envoyer sur WhatsApp</span>
              </a>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 09 : LISTE DES ÉLÈVES                     -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeScreen === 'students'">
          <section class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-bold uppercase tracking-wider text-primary">Répertoire Académique</p>
                <h1 class="font-headline text-2xl font-extrabold text-on-surface">Liste des Élèves ({{ filteredStudents.length }})</h1>
              </div>
              <button
                (click)="activeScreen = 'new-student'"
                class="h-10 px-3.5 rounded-xl bg-primary text-white font-headline font-bold text-xs flex items-center gap-1.5 shadow-sm"
              >
                <span class="material-symbols-outlined text-base">person_add</span>
                <span>Nouvel élève</span>
              </button>
            </div>

            <!-- Search Input -->
            <div class="relative">
              <span class="material-symbols-outlined text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2">search</span>
              <input
                type="text"
                [(ngModel)]="studentSearch"
                placeholder="Rechercher par nom, téléphone ou dossier #LM..."
                class="w-full h-12 pl-11 pr-4 rounded-xl bg-surface-container-lowest border border-outline-variant/30 text-sm"
              />
            </div>

            <!-- Student Cards -->
            <div class="space-y-3">
              <div
                *ngFor="let st of filteredStudents"
                (click)="openStudentDetail(st)"
                class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/25 shadow-sm hover:border-primary/40 transition-all cursor-pointer space-y-3"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="w-11 h-11 rounded-xl bg-primary-fixed text-primary font-headline font-extrabold text-sm flex items-center justify-center">
                      {{ getInitials(st.full_name) }}
                    </div>
                    <div>
                      <h3 class="font-headline font-bold text-sm text-on-surface">{{ st.full_name }}</h3>
                      <p class="text-xs text-on-surface-variant">{{ st.phone }} • Permis {{ st.license_type || 'B' }}</p>
                    </div>
                  </div>
                  <span
                    class="px-2.5 py-1 rounded-full text-[10px] font-bold"
                    [ngClass]="(st.total_paid || 0) >= (st.total_due || 95000) ? 'bg-tertiary-fixed text-tertiary' : 'bg-secondary-fixed text-secondary'"
                  >
                    {{ (st.total_paid || 0) >= (st.total_due || 95000) ? 'Soldé' : 'En cours' }}
                  </span>
                </div>

                <div class="flex items-center justify-between text-xs pt-2 border-t border-outline-variant/15">
                  <span class="text-on-surface-variant">
                    Versé : <strong class="text-tertiary tabular-nums">{{ formatFcfa(st.total_paid || 40000) }} F</strong> / {{ formatFcfa(st.total_due || 95000) }} F
                  </span>
                  <span class="text-primary font-bold flex items-center gap-0.5">
                    <span>Voir fiche</span>
                    <span class="material-symbols-outlined text-sm">chevron_right</span>
                  </span>
                </div>
              </div>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 10 : INSCRIRE UN NOUVEL ÉLÈVE             -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeScreen === 'new-student'">
          <section class="space-y-5">
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-primary">Nouveau Dossier MINTRANS</p>
              <h1 class="font-headline text-2xl font-extrabold text-on-surface">Inscrire un nouvel élève</h1>
            </div>

            <div class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">Nom complet (comme sur la CNI)</label>
                <input
                  type="text"
                  [(ngModel)]="newStudent.full_name"
                  placeholder="Ex: Ngono Marie-Claire"
                  class="w-full h-12 px-3.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm"
                />
              </div>

              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">Téléphone WhatsApp (+237)</label>
                <input
                  type="tel"
                  [(ngModel)]="newStudent.phone"
                  placeholder="Ex: 699 12 34 56"
                  class="w-full h-12 px-3.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm font-mono"
                />
              </div>

              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1.5">Catégorie de Permis</label>
                <div class="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    *ngFor="let lic of ['B', 'A', 'C', 'D']"
                    (click)="newStudent.license_type = lic"
                    class="p-3 rounded-xl border text-left transition-all"
                    [ngClass]="newStudent.license_type === lic ? 'border-primary bg-primary-fixed/30 font-bold text-primary' : 'border-outline-variant/30'"
                  >
                    <span class="font-headline text-sm block">Permis {{ lic }}</span>
                    <span class="text-[11px] text-on-surface-variant">95 000 FCFA</span>
                  </button>
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">1er Versement à l'inscription (FCFA)</label>
                <input
                  type="number"
                  [(ngModel)]="newStudent.initial_payment"
                  class="w-full h-12 px-3.5 rounded-xl bg-surface-container-low border border-outline-variant/40 font-headline font-bold text-base text-primary tabular-nums"
                />
              </div>

              <button
                type="button"
                (click)="saveNewStudent()"
                class="w-full min-h-[52px] rounded-xl bg-primary text-white font-headline font-bold text-sm flex items-center justify-center gap-2 shadow-md"
              >
                <span class="material-symbols-outlined">how_to_reg</span>
                <span>Créer le dossier & Émettre le reçu</span>
              </button>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 11 : FICHE DÉTAILLÉE ÉLÈVE                -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeScreen === 'student-detail'">
          <section class="space-y-5">
            <!-- Alerte Caisse Banner -->
            <div class="bg-secondary-fixed/70 border border-secondary/30 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <span class="material-symbols-outlined text-secondary text-2xl">warning</span>
                <div>
                  <p class="font-headline font-bold text-xs text-on-secondary-fixed uppercase">Alerte Caisse • 2ème Tranche</p>
                  <p class="text-xs text-on-secondary-fixed-variant">
                    Reste à régler : <strong>{{ formatFcfa((selectedStudent.total_due || 95000) - (selectedStudent.total_paid || 40000)) }} FCFA</strong> avant examen pratique.
                  </p>
                </div>
              </div>
              <button
                (click)="prefillCashierForStudent(selectedStudent)"
                class="px-3 py-2 rounded-xl bg-primary text-white font-headline font-bold text-xs shrink-0"
              >
                Encaisser
              </button>
            </div>

            <!-- Candidate Identity Card -->
            <div class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3.5">
                  <div class="w-14 h-14 rounded-2xl bg-primary text-white font-headline font-extrabold text-lg flex items-center justify-center">
                    {{ getInitials(selectedStudent.full_name) }}
                  </div>
                  <div>
                    <span class="px-2 py-0.5 rounded bg-primary-fixed text-primary font-mono font-bold text-[10px]">Dossier #LM-4092</span>
                    <h2 class="font-headline font-extrabold text-lg text-on-surface mt-0.5">{{ selectedStudent.full_name }}</h2>
                    <p class="text-xs text-on-surface-variant">{{ selectedStudent.phone }} • Permis {{ selectedStudent.license_type || 'B' }}</p>
                  </div>
                </div>
              </div>

              <!-- Quick Contact & Cashier Actions -->
              <div class="grid grid-cols-3 gap-2 pt-2 border-t border-outline-variant/20">
                <a
                  [href]="'https://wa.me/237' + (selectedStudent.phone || '677000000')"
                  target="_blank"
                  class="py-2.5 rounded-xl bg-[#25D366]/15 text-[#128C7E] font-headline font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <span class="material-symbols-outlined text-base">chat</span>
                  <span>WhatsApp</span>
                </a>
                <a
                  [href]="'tel:+237' + (selectedStudent.phone || '677000000')"
                  class="py-2.5 rounded-xl bg-primary-fixed/50 text-primary font-headline font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <span class="material-symbols-outlined text-base">call</span>
                  <span>Appeler</span>
                </a>
                <button
                  (click)="prefillCashierForStudent(selectedStudent)"
                  class="py-2.5 rounded-xl bg-primary text-white font-headline font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <span class="material-symbols-outlined text-base">payments</span>
                  <span>Encaisser</span>
                </button>
              </div>
            </div>

            <!-- Pédagogie & Assiduité (Theory 18/40h & Practical) -->
            <div class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-4">
              <h3 class="font-headline font-bold text-base text-on-surface">Pédagogie & Assiduité</h3>
              <div class="space-y-3">
                <div>
                  <div class="flex justify-between text-xs font-semibold mb-1">
                    <span>Cours de Code en Salle (Théorie)</span>
                    <span class="text-primary font-bold tabular-nums">18h / 40h</span>
                  </div>
                  <div class="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                    <div class="h-full bg-primary rounded-full" style="width: 45%"></div>
                  </div>
                </div>
                <div>
                  <div class="flex justify-between text-xs font-semibold mb-1">
                    <span>Heures de Conduite (Toyota Yaris #04)</span>
                    <span class="text-tertiary font-bold tabular-nums">8h / 20h</span>
                  </div>
                  <div class="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                    <div class="h-full bg-tertiary rounded-full" style="width: 40%"></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 12 : GESTION DES GROUPES (VAGUES)         -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeScreen === 'groups'">
          <section class="space-y-5">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-bold uppercase tracking-wider text-primary">Organisation des Vagues</p>
                <h1 class="font-headline text-2xl font-extrabold text-on-surface">Gestion des Groupes</h1>
              </div>
              <button
                (click)="showCreateGroup = !showCreateGroup"
                class="h-10 px-3.5 rounded-xl bg-primary text-white font-headline font-bold text-xs flex items-center gap-1"
              >
                <span class="material-symbols-outlined text-base">{{ showCreateGroup ? 'expand_less' : 'add' }}</span>
                <span>Nouvelle Vague</span>
              </button>
            </div>

            <!-- Collapsible Creation Form (Stitch Screen 12) -->
            <div *ngIf="showCreateGroup" class="bg-surface-container-lowest rounded-2xl p-5 border border-primary/30 shadow-md space-y-4">
              <h3 class="font-headline font-bold text-sm text-primary">Créer une nouvelle vague de formation</h3>
              <input
                type="text"
                [(ngModel)]="newGroup.name"
                placeholder="Ex: Vague Novembre Soir (18h-20h)"
                class="w-full h-12 px-3.5 rounded-xl bg-surface-container-low border border-outline-variant/40 text-sm"
              />
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-on-surface">Capacité maximale (places)</span>
                <div class="flex items-center gap-2">
                  <button (click)="newGroup.capacity = Math.max(5, newGroup.capacity - 5)" class="w-9 h-9 rounded-lg bg-surface-container-low font-bold">-</button>
                  <span class="font-headline font-extrabold text-base w-10 text-center tabular-nums">{{ newGroup.capacity }}</span>
                  <button (click)="newGroup.capacity = newGroup.capacity + 5" class="w-9 h-9 rounded-lg bg-surface-container-low font-bold">+</button>
                </div>
              </div>
              <button
                (click)="addGroup()"
                class="w-full min-h-[48px] rounded-xl bg-primary text-white font-headline font-bold text-xs"
              >
                Enregistrer la vague
              </button>
            </div>

            <!-- Active Groups List -->
            <div class="space-y-3.5">
              <div
                *ngFor="let grp of groups"
                class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-3"
              >
                <div class="flex items-start justify-between">
                  <div>
                    <span class="px-2.5 py-0.5 rounded-full bg-primary-fixed text-primary font-headline font-bold text-[10px]">
                      Permis {{ grp.license_type }} • {{ grp.schedule }}
                    </span>
                    <h3 class="font-headline font-extrabold text-base text-on-surface mt-1">{{ grp.name }}</h3>
                    <p class="text-xs text-on-surface-variant">Formateur : {{ grp.instructor }}</p>
                  </div>
                  <span class="font-headline font-extrabold text-sm text-primary tabular-nums">
                    {{ grp.enrolled }} / {{ grp.capacity }} places
                  </span>
                </div>

                <div class="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                  <div class="h-full bg-primary rounded-full" [style.width.%]="(grp.enrolled / grp.capacity) * 100"></div>
                </div>

                <div class="flex items-center justify-between text-xs pt-1">
                  <span class="text-on-surface-variant">Taux de recouvrement caisse :</span>
                  <strong class="text-tertiary tabular-nums">{{ grp.collectionRate }}% encaissé</strong>
                </div>
              </div>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 13 : JOURNAL DES REÇUS DU JOUR            -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeScreen === 'journal'">
          <section class="space-y-5">
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-primary">Guichet #1 (Bastos) • Mama Célestine</p>
              <h1 class="font-headline text-2xl font-extrabold text-on-surface">Journal des Reçus du Jour</h1>
            </div>

            <!-- Hero Cash Drawer Card -->
            <div class="bg-gradient-to-br from-primary to-primary-container text-white rounded-2xl p-5 shadow-lg space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-on-primary-container uppercase">Total Encaissé Aujourd'hui</span>
                <span class="px-2.5 py-1 rounded-full bg-white/15 text-xs font-bold">Caisse Ouverte</span>
              </div>
              <p class="font-headline text-3xl font-extrabold tabular-nums">
                {{ formatFcfa(todayCollected) }} <span class="text-sm font-normal">FCFA</span>
              </p>
              <div class="grid grid-cols-2 gap-3 pt-3 border-t border-white/15 text-xs">
                <div>
                  <span class="text-on-primary-container block">Fond de caisse initial</span>
                  <strong class="font-headline text-sm tabular-nums">25 000 FCFA</strong>
                </div>
                <div>
                  <span class="text-on-primary-container block">Total Tiroir Réel</span>
                  <strong class="font-headline text-sm tabular-nums">{{ formatFcfa(todayCollected + 25000) }} FCFA</strong>
                </div>
              </div>
            </div>

            <!-- 3-Channel Bento Breakdown (Espèces / MTN MoMo / Orange OM) -->
            <div class="grid grid-cols-3 gap-2.5">
              <div class="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant/25 text-center">
                <span class="text-[10px] font-bold uppercase text-on-surface-variant block">Espèces</span>
                <strong class="font-headline text-sm text-on-surface tabular-nums">115 000 F</strong>
              </div>
              <div class="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant/25 text-center">
                <span class="text-[10px] font-bold uppercase text-on-surface-variant block">MTN MoMo</span>
                <strong class="font-headline text-sm text-primary tabular-nums">80 000 F</strong>
              </div>
              <div class="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant/25 text-center">
                <span class="text-[10px] font-bold uppercase text-on-surface-variant block">Orange OM</span>
                <strong class="font-headline text-sm text-secondary tabular-nums">40 000 F</strong>
              </div>
            </div>

            <!-- Chronological Receipt List -->
            <div class="space-y-3">
              <div
                *ngFor="let p of payments"
                class="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/25 shadow-sm flex items-center justify-between gap-3"
              >
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-mono font-bold text-xs text-primary">{{ p.receipt_number }}</span>
                    <span class="px-2 py-0.5 rounded bg-surface-container-low text-[10px] font-bold">{{ p.payment_method }}</span>
                  </div>
                  <p class="font-headline font-bold text-sm text-on-surface mt-0.5">{{ p.student_name }}</p>
                  <p class="text-[11px] text-on-surface-variant">{{ p.notes }}</p>
                </div>

                <div class="text-right space-y-1.5">
                  <p class="font-headline font-extrabold text-sm text-tertiary tabular-nums">+{{ formatFcfa(p.amount) }} F</p>
                  <button
                    (click)="previewReceipt(p)"
                    class="px-2.5 py-1 rounded-lg bg-primary-fixed text-primary font-headline font-bold text-[11px]"
                  >
                    Aperçu PDF
                  </button>
                </div>
              </div>
            </div>
          </section>
        </ng-container>

        <!-- ======================================================= -->
        <!-- STITCH SCREEN 14 : RAPPORT MENSUEL DES RECETTES         -->
        <!-- ======================================================= -->
        <ng-container *ngIf="activeScreen === 'monthly-report'">
          <section class="space-y-5">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-bold uppercase tracking-wider text-primary">Agrément MINTRANS N° 00412/MINT/DTT</p>
                <h1 class="font-headline text-2xl font-extrabold text-on-surface">Rapport Mensuel des Recettes</h1>
              </div>
              <span class="px-3 py-1.5 rounded-xl bg-primary-fixed text-primary font-headline font-bold text-xs">
                Novembre 2026
              </span>
            </div>

            <!-- Monthly Hero Card -->
            <div class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold uppercase text-on-surface-variant">Total Recettes Encaissées</span>
                <span class="px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-tertiary font-bold text-xs">+18.4% vs Oct</span>
              </div>
              <p class="font-headline text-3xl font-extrabold text-primary tabular-nums">
                4 850 000 <span class="text-sm font-normal text-on-surface-variant">FCFA</span>
              </p>
              <div class="space-y-1">
                <div class="flex justify-between text-xs font-semibold">
                  <span>Objectif Mensuel Direction (5 500 000 FCFA)</span>
                  <span class="tabular-nums">88%</span>
                </div>
                <div class="w-full h-2.5 bg-surface-container-high rounded-full overflow-hidden">
                  <div class="h-full bg-primary rounded-full" style="width: 88%"></div>
                </div>
              </div>
            </div>

            <!-- Fleet & Certified Instructors Banner -->
            <div class="bg-primary-fixed/40 border border-primary/20 rounded-2xl p-4 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <span class="material-symbols-outlined text-primary text-2xl">directions_car</span>
                <div>
                  <p class="font-headline font-bold text-xs text-primary">Parc Automobile & Encadrement DTT</p>
                  <p class="text-xs text-on-surface-variant">12 Véhicules Double Commande • 8 Moniteurs certifiés DTT</p>
                </div>
              </div>
              <span class="px-2.5 py-1 rounded-lg bg-tertiary-fixed text-tertiary font-bold text-[11px]">BICEC Approfondi</span>
            </div>

            <!-- Chiffre d'Affaires par Permis -->
            <div class="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/25 shadow-sm space-y-3">
              <h3 class="font-headline font-bold text-base text-on-surface">Chiffre d'Affaires par Catégorie de Permis</h3>
              <div class="space-y-2.5 text-xs">
                <div class="flex justify-between items-center p-3 rounded-xl bg-surface-container-low">
                  <span class="font-bold">Permis B (Tourisme • 38 élèves)</span>
                  <strong class="font-headline text-sm text-primary tabular-nums">3 610 000 FCFA</strong>
                </div>
                <div class="flex justify-between items-center p-3 rounded-xl bg-surface-container-low">
                  <span class="font-bold">Permis A (Moto • 12 élèves)</span>
                  <strong class="font-headline text-sm text-primary tabular-nums">540 000 FCFA</strong>
                </div>
                <div class="flex justify-between items-center p-3 rounded-xl bg-surface-container-low">
                  <span class="font-bold">Permis C & D (Poids Lourd / Transport)</span>
                  <strong class="font-headline text-sm text-primary tabular-nums">700 000 FCFA</strong>
                </div>
              </div>
            </div>
          </section>
        </ng-container>

      </main>

      <!-- Bottom Navigation Bar (Admin 5 Key Destinations) -->
      <nav class="fixed bottom-0 inset-x-0 z-40 bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant/25 px-2 py-1.5">
        <div class="max-w-lg mx-auto grid grid-cols-5 gap-1">
          <button
            (click)="activeScreen = 'dashboard'"
            class="flex flex-col items-center justify-center py-2 rounded-xl transition-colors"
            [ngClass]="activeScreen === 'dashboard' ? 'text-primary bg-primary-fixed/40 font-bold' : 'text-on-surface-variant'"
          >
            <span class="material-symbols-outlined text-xl">dashboard</span>
            <span class="text-[10px] mt-0.5">Accueil</span>
          </button>

          <button
            (click)="activeScreen = 'cashier'"
            class="flex flex-col items-center justify-center py-2 rounded-xl transition-colors"
            [ngClass]="activeScreen === 'cashier' || activeScreen === 'receipt' ? 'text-primary bg-primary-fixed/40 font-bold' : 'text-on-surface-variant'"
          >
            <span class="material-symbols-outlined text-xl">point_of_sale</span>
            <span class="text-[10px] mt-0.5">Encaisser</span>
          </button>

          <button
            (click)="activeScreen = 'students'"
            class="flex flex-col items-center justify-center py-2 rounded-xl transition-colors"
            [ngClass]="activeScreen === 'students' || activeScreen === 'new-student' || activeScreen === 'student-detail' ? 'text-primary bg-primary-fixed/40 font-bold' : 'text-on-surface-variant'"
          >
            <span class="material-symbols-outlined text-xl">groups</span>
            <span class="text-[10px] mt-0.5">Élèves</span>
          </button>

          <button
            (click)="activeScreen = 'groups'"
            class="flex flex-col items-center justify-center py-2 rounded-xl transition-colors"
            [ngClass]="activeScreen === 'groups' ? 'text-primary bg-primary-fixed/40 font-bold' : 'text-on-surface-variant'"
          >
            <span class="material-symbols-outlined text-xl">calendar_month</span>
            <span class="text-[10px] mt-0.5">Groupes</span>
          </button>

          <button
            (click)="activeScreen = 'journal'"
            class="flex flex-col items-center justify-center py-2 rounded-xl transition-colors"
            [ngClass]="activeScreen === 'journal' || activeScreen === 'monthly-report' ? 'text-primary bg-primary-fixed/40 font-bold' : 'text-on-surface-variant'"
          >
            <span class="material-symbols-outlined text-xl">receipt_long</span>
            <span class="text-[10px] mt-0.5">Journal</span>
          </button>
        </div>
      </nav>
    </div>
  `
})
export class AdminPortalComponent implements OnInit {
  @Input() user: any;
  @Output() logout = new EventEmitter<void>();

  Math = Math;
  activeScreen: AdminScreen = 'dashboard';

  students: any[] = [];
  payments: any[] = [];
  studentSearch = '';

  selectedStudent: any = {
    id: 'st-1',
    full_name: 'Jean-Paul Mbarga',
    phone: '677829104',
    license_type: 'B',
    total_due: 95000,
    total_paid: 40000
  };

  selectedPaymentStudent: any = null;
  paymentForm = {
    student_id: '',
    amount: 35000,
    installment_number: 2,
    payment_method: 'CASH',
    notes: '2ème Tranche - Conduite Pratique'
  };

  activeReceipt: any = {
    receipt_number: 'AEM-2026-04092',
    student_name: 'Jean-Paul Mbarga',
    student_phone: '677 82 91 04',
    license_type: 'B',
    amount: 40000,
    total_paid: 40000,
    total_due: 95000,
    payment_method: 'MTN MoMo',
    notes: '1ère Tranche - Inscription & Code CEMAC',
    cashier_name: 'Mama Célestine',
    created_at: '05/11/2026 à 14:32'
  };

  newStudent = {
    full_name: '',
    phone: '',
    license_type: 'B',
    initial_payment: 40000
  };

  showCreateGroup = false;
  newGroup = { name: '', capacity: 25 };
  groups = [
    {
      name: 'Vague Bastos Soir (Novembre)',
      license_type: 'B',
      schedule: 'Lun-Ven • 18h00 - 20h00',
      instructor: 'M. Essomba Jean',
      enrolled: 22,
      capacity: 25,
      collectionRate: 84
    },
    {
      name: 'Vague Matinale Intensive',
      license_type: 'B',
      schedule: 'Lun-Sam • 08h00 - 10h00',
      instructor: 'Mme Ngo Biyong',
      enrolled: 18,
      capacity: 20,
      collectionRate: 92
    },
    {
      name: 'Vague Spéciale Moto & Poids Lourd',
      license_type: 'A / C',
      schedule: 'Mar-Jeu-Sam • 14h00 - 16h30',
      instructor: 'M. Kamga Paul',
      enrolled: 12,
      capacity: 15,
      collectionRate: 78
    }
  ];

  constructor(
    private api: ApiService,
    private pdfService: ReceiptPdfService
  ) {}

  ngOnInit(): void {
    this.loadAdminData();
  }

  get todayCollected(): number {
    return this.payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  }

  get filteredStudents(): any[] {
    const q = (this.studentSearch || '').toLowerCase().trim();
    if (!q) return this.students;
    return this.students.filter(
      (s) =>
        (s.full_name || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q)
    );
  }

  getScreenTitle(): string {
    const titles: Record<AdminScreen, string> = {
      dashboard: 'Tableau de bord Admin',
      cashier: 'Enregistrer un paiement',
      receipt: 'Aperçu & Export Reçu PDF',
      students: 'Liste des Élèves',
      'new-student': 'Inscrire un nouvel élève',
      'student-detail': 'Fiche Détaillée Élève',
      groups: 'Gestion des Groupes',
      journal: 'Journal des Reçus du Jour',
      'monthly-report': 'Rapport Mensuel des Recettes'
    };
    return titles[this.activeScreen] || 'Administration AEM';
  }

  loadAdminData(): void {
    this.api.getAdminStudentsObservable().subscribe((list) => {
      if (list && list.length > 0) {
        this.students = list;
      } else {
        this.students = [
          {
            id: 'st-1',
            full_name: 'Jean-Paul Mbarga',
            phone: '677829104',
            license_type: 'B',
            total_due: 95000,
            total_paid: 40000
          },
          {
            id: 'st-2',
            full_name: 'Aïssatou Bello',
            phone: '699410288',
            license_type: 'B',
            total_due: 95000,
            total_paid: 75000
          },
          {
            id: 'st-3',
            full_name: 'Franck Ndjock',
            phone: '655198320',
            license_type: 'A',
            total_due: 60000,
            total_paid: 60000
          }
        ];
      }
      this.selectedPaymentStudent = this.students[0];
      this.paymentForm.student_id = this.students[0].id;
    });

    this.api.getAdminPayments().subscribe((list) => {
      if (list && list.length > 0) {
        this.payments = list;
      } else {
        this.payments = [
          {
            receipt_number: 'AEM-2026-04092',
            student_name: 'Jean-Paul Mbarga',
            student_phone: '677829104',
            license_type: 'B',
            amount: 40000,
            total_paid: 40000,
            total_due: 95000,
            payment_method: 'MTN MoMo',
            notes: '1ère Tranche - Inscription & Code',
            cashier_name: 'Mama Célestine',
            created_at: 'Aujourd\'hui • 09:15'
          },
          {
            receipt_number: 'AEM-2026-04093',
            student_name: 'Aïssatou Bello',
            student_phone: '699410288',
            license_type: 'B',
            amount: 35000,
            total_paid: 75000,
            total_due: 95000,
            payment_method: 'Espèces',
            notes: '2ème Tranche - Conduite Pratique',
            cashier_name: 'Mama Célestine',
            created_at: 'Aujourd\'hui • 11:42'
          }
        ];
      }
    });
  }

  onSelectPaymentStudent(): void {
    this.selectedPaymentStudent =
      this.students.find((s) => String(s.id) === String(this.paymentForm.student_id)) || this.students[0];
  }

  setTranche(num: number, amount: number, notes: string): void {
    this.paymentForm.installment_number = num;
    this.paymentForm.amount = amount;
    this.paymentForm.notes = notes;
  }

  prefillCashierForStudent(st: any): void {
    this.selectedPaymentStudent = st;
    this.paymentForm.student_id = st.id;
    this.activeScreen = 'cashier';
  }

  openStudentDetail(st: any): void {
    this.selectedStudent = st;
    this.activeScreen = 'student-detail';
  }

  submitCashierPayment(): void {
    const student = this.selectedPaymentStudent || this.students[0];
    const amount = Number(this.paymentForm.amount) || 35000;
    const newTotalPaid = Number(student?.total_paid || 40000) + amount;
    const receiptNo = 'AEM-2026-' + Math.floor(10000 + Math.random() * 89999);

    const createdReceipt = {
      receipt_number: receiptNo,
      student_name: student?.full_name || 'Jean-Paul Mbarga',
      student_phone: student?.phone || '677829104',
      license_type: student?.license_type || 'B',
      amount,
      total_paid: newTotalPaid,
      total_due: Number(student?.total_due || 95000),
      payment_method: this.paymentForm.payment_method,
      notes: this.paymentForm.notes,
      cashier_name: 'Mama Célestine',
      created_at: new Date().toLocaleString('fr-FR')
    };

    if (student) {
      student.total_paid = newTotalPaid;
    }

    this.payments = [createdReceipt, ...this.payments];
    this.activeReceipt = createdReceipt;
    this.activeScreen = 'receipt';
  }

  previewReceipt(p: any): void {
    this.activeReceipt = p;
    this.activeScreen = 'receipt';
  }

  downloadReceiptPdf(): void {
    this.pdfService.generateOfficialReceipt({
      receiptNumber: this.activeReceipt.receipt_number,
      studentName: this.activeReceipt.student_name,
      studentPhone: this.activeReceipt.student_phone,
      licenseType: this.activeReceipt.license_type || 'B',
      amountPaid: Number(this.activeReceipt.amount || 40000),
      totalPaidSoFar: Number(this.activeReceipt.total_paid || 40000),
      totalCourseFee: Number(this.activeReceipt.total_due || 95000),
      paymentMethod: this.activeReceipt.payment_method || 'Espèces',
      cashierName: this.activeReceipt.cashier_name || 'Mama Célestine',
      dateFormatted: this.activeReceipt.created_at || new Date().toLocaleDateString('fr-FR'),
      notes: this.activeReceipt.notes || 'Versement scolarité Auto-École La Marseillaise'
    });
  }

  getWhatsAppReceiptUrl(): string {
    return this.pdfService.buildWhatsAppShareUrl({
      receiptNumber: this.activeReceipt.receipt_number,
      studentName: this.activeReceipt.student_name,
      studentPhone: this.activeReceipt.student_phone || '677000000',
      licenseType: this.activeReceipt.license_type || 'B',
      amountPaid: Number(this.activeReceipt.amount || 40000),
      totalPaidSoFar: Number(this.activeReceipt.total_paid || 40000),
      totalCourseFee: Number(this.activeReceipt.total_due || 95000),
      paymentMethod: this.activeReceipt.payment_method || 'Espèces',
      cashierName: this.activeReceipt.cashier_name || 'Mama Célestine',
      dateFormatted: this.activeReceipt.created_at || new Date().toLocaleDateString('fr-FR')
    });
  }

  saveNewStudent(): void {
    if (!this.newStudent.full_name) return;
    const created = {
      id: 'st-' + Date.now(),
      full_name: this.newStudent.full_name,
      phone: this.newStudent.phone || '677000000',
      license_type: this.newStudent.license_type,
      total_due: 95000,
      total_paid: Number(this.newStudent.initial_payment || 40000)
    };
    this.students = [created, ...this.students];
    this.selectedPaymentStudent = created;
    this.activeReceipt = {
      receipt_number: 'AEM-2026-' + Math.floor(10000 + Math.random() * 89999),
      student_name: created.full_name,
      student_phone: created.phone,
      license_type: created.license_type,
      amount: created.total_paid,
      total_paid: created.total_paid,
      total_due: 95000,
      payment_method: 'Espèces',
      notes: '1ère Tranche - Inscription & Ouverture Dossier MINTRANS',
      cashier_name: 'Mama Célestine',
      created_at: new Date().toLocaleString('fr-FR')
    };
    this.newStudent = { full_name: '', phone: '', license_type: 'B', initial_payment: 40000 };
    this.activeScreen = 'receipt';
  }

  addGroup(): void {
    if (!this.newGroup.name) return;
    this.groups = [
      {
        name: this.newGroup.name,
        license_type: 'B',
        schedule: 'Lun-Ven • 18h00 - 20h00',
        instructor: 'M. Essomba Jean',
        enrolled: 1,
        capacity: this.newGroup.capacity,
        collectionRate: 100
      },
      ...this.groups
    ];
    this.newGroup = { name: '', capacity: 25 };
    this.showCreateGroup = false;
  }

  getInitials(name: string): string {
    return (name || 'AE')
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  formatFcfa(amount: number): string {
    return Math.round(amount || 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
}
