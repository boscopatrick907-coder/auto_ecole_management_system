import { Component, EventEmitter, Output, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';
import { ReceiptExportService } from '../services/receipt-export.service';

@Component({
  selector: 'app-admin-portal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-[100dvh] bg-[#F4F7FB] pb-24 max-w-2xl mx-auto relative">
      <!-- ==================== FROSTED LIGHT HEADER ==================== -->
      <header class="sticky top-0 z-30 aem-frosted-chrome px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <img src="/aem-icon.svg" alt="AEM" class="w-9 h-9 rounded-xl shadow-xs" />
          <div>
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-[#D94E28]">
                AEM • DIRECTION & CAISSE
              </span>
              @if (!api.isOnline()) {
                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#FEF3C7] text-[#D97706]">
                  MODE CAISSE HORS-LIGNE
                </span>
              }
            </div>
            <h1 class="text-sm font-extrabold text-[#0F1E36]">Auto-École La Marseillaise</h1>
          </div>
        </div>

        <div class="flex items-center gap-2">
          @if (api.pendingSyncCount() > 0) {
            <button
              type="button"
              (click)="api.flushSyncQueue()"
              class="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-[#FEF3C7] text-[#D97706] font-tabular"
            >
              🔄 {{ api.pendingSyncCount() }} en attente
            </button>
          }
          <button
            type="button"
            (click)="refreshAll()"
            class="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-[#E8F2FC] text-[#2B6CA8]"
          >
            Actualiser
          </button>
          <button
            type="button"
            (click)="logout.emit()"
            class="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-[#F1F5F9] text-[#4A607A]"
          >
            Sortir
          </button>
        </div>
      </header>

      <!-- ==================== MAIN CONTENT ==================== -->
      <main class="px-4 pt-4 space-y-4">
        @if (toastMsg()) {
          <div class="p-3.5 rounded-2xl bg-[#ECFDF5] border border-[#16A34A]/30 text-xs font-bold text-[#15803D] flex items-center justify-between">
            <span>{{ toastMsg() }}</span>
            <button type="button" (click)="toastMsg.set('')">×</button>
          </div>
        }

        @if (errorMsg()) {
          <div class="p-3.5 rounded-2xl bg-[#FEF2F2] border border-[#DC2626]/30 text-xs font-bold text-[#DC2626] flex items-center justify-between">
            <span>{{ errorMsg() }}</span>
            <button type="button" (click)="errorMsg.set('')">×</button>
          </div>
        }

        <!-- ==================== TAB 1: TABLEAU DE BORD DIRECTION ==================== -->
        @if (activeTab() === 'dashboard') {
          <!-- 4 KPI Cards (Zero Accounting Jargon, Tabular FCFA) -->
          <div class="grid grid-cols-2 gap-3">
            <div class="aem-card p-4 border-l-4 border-l-[#3D8BCD]">
              <span class="text-[11px] font-bold uppercase text-[#64748B] block">Encaissé ce mois</span>
              <p class="text-lg font-extrabold text-[#0F1E36] font-tabular mt-1">
                {{ kpis()?.collected_this_month || 0 | number }} <span class="text-xs font-bold text-[#3D8BCD]">FCFA</span>
              </p>
              <span class="text-[10px] font-semibold text-[#16A34A]">
                Aujourd'hui : {{ kpis()?.collected_today || 0 | number }} F
              </span>
            </div>

            <div class="aem-card p-4 border-l-4 border-l-[#D94E28]">
              <span class="text-[11px] font-bold uppercase text-[#64748B] block">Reste à recouvrer</span>
              <p class="text-lg font-extrabold text-[#D94E28] font-tabular mt-1">
                {{ kpis()?.total_outstanding || 0 | number }} <span class="text-xs font-bold">FCFA</span>
              </p>
              <span class="text-[10px] font-semibold text-[#64748B]">
                {{ kpis()?.overdue_installments_count || 0 }} tranche(s) en retard
              </span>
            </div>

            <div class="aem-card p-4">
              <span class="text-[11px] font-bold uppercase text-[#64748B] block">Élèves inscrits</span>
              <p class="text-lg font-extrabold text-[#0F1E36] font-tabular mt-1">
                {{ kpis()?.total_students || students().length }}
              </p>
              <span class="text-[10px] font-semibold text-[#3D8BCD]">
                {{ kpis()?.paid_students || 0 }} confirmés (payants)
              </span>
            </div>

            <div class="aem-card p-4">
              <span class="text-[11px] font-bold uppercase text-[#64748B] block">En essai gratuit (14j)</span>
              <p class="text-lg font-extrabold text-[#2B6CA8] font-tabular mt-1">
                {{ kpis()?.active_trials || 0 }}
              </p>
              <span class="text-[10px] font-semibold text-[#D97706]">
                {{ kpis()?.expired_unpaid_trials || 0 }} essai(s) expiré(s) à relancer
              </span>
            </div>
          </div>

          <!-- Quick Caisse CTA -->
          <div class="p-4 rounded-2xl bg-gradient-to-r from-[#3D8BCD] to-[#2B6CA8] text-white flex items-center justify-between shadow-sm">
            <div>
              <span class="text-[10px] font-extrabold uppercase tracking-wider text-white/80 block">
                GUICHET RAPIDE (&lt; 10 SECONDES)
              </span>
              <h3 class="text-sm font-extrabold">Encaisser un versement ou créer un élève</h3>
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                (click)="activeTab.set('cashier')"
                class="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-white text-[#2B6CA8]"
              >
                + Encaisser
              </button>
            </div>
          </div>

          <!-- Actionable "À traiter aujourd'hui" Overdue & Unpaid List -->
          <div class="aem-card p-4 space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-extrabold text-[#0F1E36]">À traiter aujourd'hui (Relances & Impayés)</h3>
                <p class="text-xs text-[#64748B]">1 clic pour relancer sur WhatsApp ou encaisser</p>
              </div>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-[#FFF7ED] text-[#D94E28] font-tabular">
                {{ actionableStudents().length }}
              </span>
            </div>

            @if (actionableStudents().length === 0) {
              <p class="text-xs text-[#16A34A] font-semibold py-2">
                ✓ Tous les élèves sont à jour dans leurs règlements !
              </p>
            } @else {
              <div class="space-y-2.5">
                @for (st of actionableStudents().slice(0, 6); track st.student_id) {
                  <div class="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <p class="text-xs font-extrabold text-[#0F1E36] truncate">{{ st.full_name }}</p>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#E8F2FC] text-[#2B6CA8]">
                          Permis {{ st.category_code || 'B' }}
                        </span>
                      </div>
                      <p class="text-[11px] font-bold text-[#D94E28] font-tabular">
                        Reste : {{ st.balance_due | number }} FCFA
                        <span class="text-[#64748B] font-normal">• {{ st.phone }}</span>
                      </p>
                    </div>

                    <div class="flex items-center gap-1.5 shrink-0">
                      <a
                        [href]="buildReminderWhatsApp(st)"
                        target="_blank"
                        rel="noopener"
                        class="px-2.5 py-2 rounded-xl text-[11px] font-bold bg-[#ECFDF5] text-[#16A34A] border border-[#16A34A]/25"
                        title="Relancer par WhatsApp"
                      >
                        💬 Relancer
                      </a>
                      <button
                        type="button"
                        (click)="openQuickCashierFor(st)"
                        class="px-3 py-2 rounded-xl text-[11px] font-bold aem-btn-primary"
                      >
                        Encaisser
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- ==================== TAB 2: ENCAISSER EN 3 CLICS (< 10 SEC) ==================== -->
        @if (activeTab() === 'cashier') {
          <div class="aem-card p-5 space-y-4">
            <div class="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div>
                <span class="text-[10px] font-extrabold uppercase tracking-wider text-[#3D8BCD]">
                  CAISSE OFFICIELLE • REÇU NUMÉROTÉ AUTO
                </span>
                <h2 class="text-base font-extrabold text-[#0F1E36]">Enregistrer un Versement</h2>
              </div>
              <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#ECFDF5] text-[#16A34A]">
                3 Étapes
              </span>
            </div>

            <!-- STEP 1: Select Student -->
            <div class="space-y-1.5">
              <label class="block text-xs font-extrabold text-[#0F1E36]">
                1. Rechercher ou sélectionner l'élève
              </label>
              <input
                type="text"
                [(ngModel)]="cashierSearch"
                placeholder="Tapez un nom ou téléphone (+237)..."
                class="aem-input text-xs mb-1.5"
              />
              <select
                [(ngModel)]="selectedEnrollmentId"
                (ngModelChange)="onSelectCashierStudent()"
                class="aem-input text-xs font-bold"
              >
                <option value="">— Choisir l'élève à encaisser —</option>
                @for (st of filteredCashierStudents(); track st.student_id) {
                  <option [value]="st.enrollment_id">
                    {{ st.full_name }} ({{ st.phone }}) — Reste : {{ st.balance_due | number }} FCFA
                  </option>
                }
              </select>
            </div>

            @if (selectedCashierStudent(); as st) {
              <div class="p-3 rounded-xl bg-[#F0F7FF] border border-[#3D8BCD]/25 flex items-center justify-between text-xs">
                <div>
                  <span class="font-extrabold text-[#0F1E36] block">{{ st.full_name }} • Permis {{ st.category_code }}</span>
                  <span class="text-[#4A607A]">Payé : {{ st.total_paid | number }} F / {{ st.total_fee | number }} F</span>
                </div>
                <span class="font-extrabold text-[#D94E28] font-tabular">
                  Reste : {{ st.balance_due | number }} F
                </span>
              </div>
            }

            <!-- STEP 2: Amount (with 1-Tap Cameroonian Tranche Presets) -->
            <div class="space-y-2">
              <label class="block text-xs font-extrabold text-[#0F1E36]">
                2. Montant versé (FCFA)
              </label>
              <div class="grid grid-cols-4 gap-2">
                @for (preset of [15000, 25000, 30000, 50000]; track preset) {
                  <button
                    type="button"
                    (click)="paymentAmount = preset"
                    [class]="paymentAmount === preset
                      ? 'py-2 rounded-xl text-xs font-extrabold bg-[#3D8BCD] text-white font-tabular'
                      : 'py-2 rounded-xl text-xs font-bold bg-[#F1F5F9] text-[#0F1E36] font-tabular'"
                  >
                    {{ preset | number }} F
                  </button>
                }
              </div>
              <input
                type="number"
                [(ngModel)]="paymentAmount"
                placeholder="Ex: 30000"
                class="aem-input font-tabular text-base font-extrabold"
              />
            </div>

            <!-- STEP 3: Payment Method -->
            <div class="space-y-2">
              <label class="block text-xs font-extrabold text-[#0F1E36]">
                3. Mode de règlement
              </label>
              <div class="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  (click)="paymentMethod = 'cash'"
                  [class]="paymentMethod === 'cash'
                    ? 'py-2.5 px-2 rounded-xl text-xs font-extrabold bg-[#3D8BCD] text-white shadow-xs'
                    : 'py-2.5 px-2 rounded-xl text-xs font-bold bg-[#F8FAFC] text-[#0F1E36] border border-[#CBD5E1]'"
                >
                  💵 Espèces
                </button>
                <button
                  type="button"
                  (click)="paymentMethod = 'orange_money'"
                  [class]="paymentMethod === 'orange_money'
                    ? 'py-2.5 px-2 rounded-xl text-xs font-extrabold bg-[#D94E28] text-white shadow-xs'
                    : 'py-2.5 px-2 rounded-xl text-xs font-bold bg-[#F8FAFC] text-[#0F1E36] border border-[#CBD5E1]'"
                >
                  🟧 Orange Money
                </button>
                <button
                  type="button"
                  (click)="paymentMethod = 'mtn_momo'"
                  [class]="paymentMethod === 'mtn_momo'
                    ? 'py-2.5 px-2 rounded-xl text-xs font-extrabold bg-[#EAB308] text-[#0F1E36] shadow-xs'
                    : 'py-2.5 px-2 rounded-xl text-xs font-bold bg-[#F8FAFC] text-[#0F1E36] border border-[#CBD5E1]'"
                >
                  🟨 MTN MoMo
                </button>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#4A607A] mb-1">
                Référence transaction / Note (optionnel)
              </label>
              <input
                type="text"
                [(ngModel)]="paymentReference"
                placeholder="Ex: ID Transaction OM / MoMo ou Tranche 1"
                class="aem-input text-xs"
              />
            </div>

            <button
              type="button"
              (click)="submitPayment()"
              [disabled]="loading()"
              class="w-full py-3.5 px-4 rounded-xl text-sm font-extrabold aem-btn-primary shadow-sm"
            >
              {{ loading() ? 'Validation & Génération du reçu...' : '✓ Valider l\\'encaissement & Générer le Reçu' }}
            </button>
          </div>

          <!-- ==================== RECEIPT CONFIRMATION MODAL ==================== -->
          @if (lastReceipt()) {
            <div class="aem-card p-5 border-2 border-[#16A34A] space-y-4 bg-[#F0FDF4]">
              <div class="flex items-center justify-between">
                <div>
                  <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#16A34A] text-white uppercase">
                    Versement Enregistré
                  </span>
                  <h3 class="text-base font-extrabold text-[#0F1E36] mt-1">
                    Reçu N° {{ lastReceipt().payment.receipt_number }}
                  </h3>
                </div>
                <button
                  type="button"
                  (click)="lastReceipt.set(null)"
                  class="text-xs font-bold text-[#4A607A]"
                >
                  Fermer
                </button>
              </div>

              <div class="p-3.5 rounded-xl bg-white border border-[#BBF7D0] text-xs space-y-1 font-tabular">
                <p><strong>Élève :</strong> {{ lastReceipt().student?.full_name }}</p>
                <p><strong>Montant encaissé :</strong> {{ lastReceipt().payment.amount | number }} FCFA</p>
                <p><strong>Nouveau solde restant :</strong> {{ lastReceipt().enrollment?.balance_due | number }} FCFA</p>
              </div>

              <div class="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  (click)="downloadLastReceiptPdf()"
                  class="py-3 px-3 rounded-xl text-xs font-extrabold aem-btn-primary"
                >
                  📄 Télécharger Reçu PDF
                </button>
                @if (lastReceipt().whatsappReceiptUrl) {
                  <a
                    [href]="lastReceipt().whatsappReceiptUrl"
                    target="_blank"
                    rel="noopener"
                    class="py-3 px-3 rounded-xl text-xs font-extrabold bg-[#16A34A] text-white text-center"
                  >
                    💬 Envoyer sur WhatsApp
                  </a>
                }
              </div>
            </div>
          }
        }

        <!-- ==================== TAB 3: ÉLÈVES, WALK-IN & EXPORTS EXCEL/PDF ==================== -->
        @if (activeTab() === 'students') {
          <!-- Top Actions Bar -->
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-base font-extrabold text-[#0F1E36]">Annuaire des Élèves ({{ students().length }})</h2>
              <p class="text-xs text-[#4A607A]">Inscriptions guichet, codes d'invitation & exports</p>
            </div>

            <div class="flex items-center gap-1.5">
              <button
                type="button"
                (click)="exportExcel()"
                class="px-3 py-2 rounded-xl text-[11px] font-bold bg-[#ECFDF5] text-[#15803D] border border-[#16A34A]/25"
              >
                📊 Excel
              </button>
              <button
                type="button"
                (click)="exportPdfRoster()"
                class="px-3 py-2 rounded-xl text-[11px] font-bold bg-[#E8F2FC] text-[#2B6CA8] border border-[#3D8BCD]/25"
              >
                📄 Liste PDF
              </button>
              <button
                type="button"
                (click)="showNewStudentModal.set(!showNewStudentModal())"
                class="px-3 py-2 rounded-xl text-[11px] font-extrabold aem-btn-primary"
              >
                + Nouvel Élève
              </button>
            </div>
          </div>

          <!-- Walk-In Student Creation Card -->
          @if (showNewStudentModal()) {
            <form (ngSubmit)="submitWalkInStudent()" class="aem-card p-4 space-y-3 border-2 border-[#3D8BCD]">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-extrabold text-[#0F1E36]">Inscrire un Élève au Guichet (Walk-in)</h3>
                <button type="button" (click)="showNewStudentModal.set(false)" class="text-xs font-bold">Fermer</button>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label class="block text-[11px] font-bold text-[#0F1E36] mb-1">Nom et Prénom</label>
                  <input
                    type="text"
                    name="walkinName"
                    [(ngModel)]="walkinName"
                    placeholder="Ex: Paul Biya Jr"
                    required
                    class="aem-input text-xs"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-bold text-[#0F1E36] mb-1">Téléphone (+237)</label>
                  <input
                    type="tel"
                    name="walkinPhone"
                    [(ngModel)]="walkinPhone"
                    placeholder="+237 6..."
                    required
                    class="aem-input text-xs"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-bold text-[#0F1E36] mb-1">Catégorie Permis</label>
                  <select name="walkinCategory" [(ngModel)]="walkinCategory" class="aem-input text-xs">
                    <option value="B">Permis B — Voiture (85 000 F)</option>
                    <option value="A">Permis A — Moto (55 000 F)</option>
                    <option value="C">Permis C — Poids Lourd (125 000 F)</option>
                    <option value="D">Permis D — Transport (140 000 F)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-bold text-[#0F1E36] mb-1">1er Versement immédiat (Optionnel)</label>
                  <input
                    type="number"
                    name="walkinInitialPayment"
                    [(ngModel)]="walkinInitialPayment"
                    placeholder="0 FCFA"
                    class="aem-input text-xs font-tabular"
                  />
                </div>
              </div>

              <button
                type="submit"
                [disabled]="loading()"
                class="w-full py-3 rounded-xl text-xs font-extrabold aem-btn-primary"
              >
                Créer le dossier & Générer le Code d'Invitation (8 car.)
              </button>
            </form>
          }

          <!-- Generated Invite Code Banner -->
          @if (generatedInvite()) {
            <div class="p-4 rounded-2xl bg-[#FFF7ED] border-2 border-[#D94E28] space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-extrabold uppercase text-[#D94E28]">
                  CODE D'INVITATION GÉNÉRÉ (VALABLE 14 JOURS)
                </span>
                <button type="button" (click)="generatedInvite.set(null)" class="text-xs font-bold">×</button>
              </div>
              <p class="text-xl font-mono font-extrabold tracking-widest text-[#0F1E36]">
                {{ generatedInvite().inviteCode }}
              </p>
              @if (generatedInvite().whatsappInviteUrl) {
                <a
                  [href]="generatedInvite().whatsappInviteUrl"
                  target="_blank"
                  rel="noopener"
                  class="inline-block py-2 px-3.5 rounded-xl text-xs font-extrabold bg-[#16A34A] text-white"
                >
                  💬 Envoyer le code par WhatsApp à l'élève
                </a>
              }
            </div>
          }

          <!-- Search & Filter -->
          <div class="flex gap-2">
            <input
              type="text"
              [(ngModel)]="studentSearch"
              placeholder="Rechercher par nom ou téléphone..."
              class="aem-input text-xs flex-1"
            />
            <select [(ngModel)]="studentFilter" class="aem-input text-xs w-36">
              <option value="all">Tous ({{ students().length }})</option>
              <option value="overdue">Impayés / Retard</option>
              <option value="trial">En Essai 14j</option>
              <option value="paid">Payants</option>
            </select>
          </div>

          <!-- Student Dossier Detail Drawer -->
          @if (selectedStudentDetail(); as detail) {
            <div class="aem-card p-5 space-y-4 border-2 border-[#3D8BCD]">
              <div class="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
                <div>
                  <span class="text-[10px] font-extrabold uppercase text-[#3D8BCD]">
                    FICHE ÉLÈVE 360° • PERMIS {{ detail.enrollment?.category_code || 'B' }}
                  </span>
                  <h3 class="text-base font-extrabold text-[#0F1E36]">{{ detail.student?.full_name }}</h3>
                  <p class="text-xs text-[#4A607A]">{{ detail.student?.phone }} • {{ detail.enrollment?.group_name || 'Sans vague' }}</p>
                </div>
                <button
                  type="button"
                  (click)="selectedStudentDetail.set(null)"
                  class="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#F1F5F9]"
                >
                  Fermer
                </button>
              </div>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  (click)="generateInviteForStudent(detail.student.student_id)"
                  class="px-3 py-2 rounded-xl text-xs font-bold bg-[#FFF7ED] text-[#D94E28] border border-[#D94E28]/30"
                >
                  🔑 Nouveau Code Invitation
                </button>
                <button
                  type="button"
                  (click)="openQuickCashierFor(detail.student)"
                  class="px-3 py-2 rounded-xl text-xs font-bold aem-btn-primary"
                >
                  + Encaisser un versement
                </button>
              </div>

              <!-- Payment History & Cancellation with Mandatory Reason -->
              <div class="space-y-2">
                <h4 class="text-xs font-extrabold uppercase text-[#64748B]">Historique des Versements & Reçus</h4>
                @if (!detail.payments?.length) {
                  <p class="text-xs text-[#64748B]">Aucun versement enregistré.</p>
                } @else {
                  @for (p of detail.payments; track p.id) {
                    <div class="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between gap-2">
                      <div>
                        <span class="text-[10px] font-mono font-bold text-[#3D8BCD] block">
                          {{ p.receipt_number }} • {{ p.paid_at | date:'dd/MM/yyyy HH:mm' }}
                        </span>
                        <span class="text-xs font-extrabold text-[#0F1E36] font-tabular">
                          {{ p.amount | number }} FCFA ({{ p.method }})
                        </span>
                        @if (p.cancelled_at) {
                          <span class="block text-[10px] font-bold text-[#DC2626]">
                            Annulé : {{ p.cancel_reason }}
                          </span>
                        }
                      </div>

                      @if (!p.cancelled_at) {
                        <button
                          type="button"
                          (click)="promptCancelPayment(p.id)"
                          class="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-[#FEF2F2] text-[#DC2626]"
                        >
                          Annuler reçu
                        </button>
                      }
                    </div>
                  }
                }
              </div>
            </div>
          }

          <!-- Student Cards List -->
          <div class="space-y-2.5">
            @for (st of filteredStudentsList(); track st.student_id) {
              <div class="aem-card p-3.5 flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1" (click)="openStudentDetail(st.student_id)">
                  <div class="flex items-center gap-1.5">
                    <p class="text-xs font-extrabold text-[#0F1E36] truncate cursor-pointer hover:text-[#3D8BCD]">
                      {{ st.full_name }}
                    </p>
                    <span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#E8F2FC] text-[#2B6CA8]">
                      Permis {{ st.category_code || 'B' }}
                    </span>
                  </div>
                  <p class="text-[11px] text-[#4A607A] font-tabular">
                    {{ st.phone }} • Payé : <strong>{{ st.total_paid || 0 | number }} F</strong> / Reste : <strong class="text-[#D94E28]">{{ st.balance_due || 0 | number }} F</strong>
                  </p>
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    (click)="openStudentDetail(st.student_id)"
                    class="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-[#F1F5F9] text-[#0F1E36]"
                  >
                    Dossier
                  </button>
                  <button
                    type="button"
                    (click)="openQuickCashierFor(st)"
                    class="px-2.5 py-1.5 rounded-xl text-[11px] font-bold aem-btn-primary"
                  >
                    Encaisser
                  </button>
                </div>
              </div>
            }
          </div>
        }

        <!-- ==================== TAB 4: COURS, VAGUES & JOURNAL D'AUDIT ==================== -->
        @if (activeTab() === 'settings') {
          <div class="space-y-4">
            <!-- Create Group / Vague -->
            <form (ngSubmit)="submitNewGroup()" class="aem-card p-4 space-y-3">
              <h3 class="text-sm font-extrabold text-[#0F1E36]">Créer une Nouvelle Vague / Session</h3>
              <div class="grid grid-cols-2 gap-2.5">
                <div>
                  <label class="block text-[11px] font-bold text-[#0F1E36] mb-1">Nom de la vague</label>
                  <input
                    type="text"
                    name="grpName"
                    [(ngModel)]="newGroupName"
                    placeholder="Ex: Vague Juin 2026 — Matin"
                    required
                    class="aem-input text-xs"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-bold text-[#0F1E36] mb-1">Catégorie</label>
                  <select name="grpCat" [(ngModel)]="newGroupCategory" class="aem-input text-xs">
                    <option value="B">Permis B</option>
                    <option value="A">Permis A</option>
                    <option value="C">Permis C</option>
                    <option value="D">Permis D</option>
                  </select>
                </div>
              </div>
              <button type="submit" class="py-2.5 px-4 rounded-xl text-xs font-bold aem-btn-primary">
                + Créer la vague (avec 3 tranches automatiques)
              </button>
            </form>

            <!-- Publish New Course Resource -->
            <form (ngSubmit)="submitNewResource()" class="aem-card p-4 space-y-3">
              <h3 class="text-sm font-extrabold text-[#0F1E36]">Publier un Nouveau Support de Cours PDF</h3>
              <input
                type="text"
                name="resTitle"
                [(ngModel)]="newResTitle"
                placeholder="Titre du cours (ex: Chapitre 5 — Croisements et dépassements)"
                required
                class="aem-input text-xs"
              />
              <input
                type="text"
                name="resDesc"
                [(ngModel)]="newResDesc"
                placeholder="Résumé pédagogique du chapitre"
                class="aem-input text-xs"
              />
              <button type="submit" class="py-2.5 px-4 rounded-xl text-xs font-bold aem-btn-primary">
                📘 Publier pour les élèves
              </button>
            </form>

            <!-- Immutable Financial Audit Log -->
            <div class="aem-card p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-extrabold text-[#0F1E36]">Journal d'Audit Financier (Inaltérable)</h3>
                <button
                  type="button"
                  (click)="loadAuditLogs()"
                  class="text-xs font-bold text-[#3D8BCD]"
                >
                  Actualiser
                </button>
              </div>
              <div class="space-y-2 max-h-64 overflow-y-auto">
                @for (log of auditLogs(); track log.id) {
                  <div class="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] flex items-center justify-between">
                    <div>
                      <span class="font-extrabold text-[#0F1E36] uppercase">{{ log.action }}</span>
                      <span class="text-[#64748B]"> • Par {{ log.actor_name || 'Système' }}</span>
                    </div>
                    <span class="text-[10px] text-[#64748B] font-tabular">
                      {{ log.created_at | date:'dd/MM HH:mm' }}
                    </span>
                  </div>
                }
              </div>
            </div>
          </div>
        }
      </main>

      <!-- ==================== FROSTED BOTTOM TAB BAR (4 TABS) ==================== -->
      <nav class="fixed bottom-0 left-0 right-0 z-30 aem-frosted-bottom-nav pb-safe">
        <div class="max-w-2xl mx-auto grid grid-cols-4 px-2 py-1.5">
          <button
            type="button"
            (click)="activeTab.set('dashboard')"
            [class]="activeTab() === 'dashboard' ? 'flex flex-col items-center py-1 text-[#3D8BCD]' : 'flex flex-col items-center py-1 text-[#64748B]'"
          >
            <span class="text-base">📊</span>
            <span class="text-[10px] font-bold mt-0.5">Pilotage</span>
          </button>

          <button
            type="button"
            (click)="activeTab.set('cashier')"
            [class]="activeTab() === 'cashier' ? 'flex flex-col items-center py-1 text-[#3D8BCD]' : 'flex flex-col items-center py-1 text-[#64748B]'"
          >
            <span class="text-base">💳</span>
            <span class="text-[10px] font-bold mt-0.5">Encaisser</span>
          </button>

          <button
            type="button"
            (click)="activeTab.set('students')"
            [class]="activeTab() === 'students' ? 'flex flex-col items-center py-1 text-[#3D8BCD]' : 'flex flex-col items-center py-1 text-[#64748B]'"
          >
            <span class="text-base">👥</span>
            <span class="text-[10px] font-bold mt-0.5">Élèves</span>
          </button>

          <button
            type="button"
            (click)="switchToSettings()"
            [class]="activeTab() === 'settings' ? 'flex flex-col items-center py-1 text-[#3D8BCD]' : 'flex flex-col items-center py-1 text-[#64748B]'"
          >
            <span class="text-base">⚙️</span>
            <span class="text-[10px] font-bold mt-0.5">Gestion</span>
          </button>
        </div>
      </nav>
    </div>
  `,
})
export class AdminPortalComponent implements OnInit {
  api = inject(ApiService);
  private receiptExport = inject(ReceiptExportService);

  @Output() logout = new EventEmitter<void>();

  activeTab = signal<'dashboard' | 'cashier' | 'students' | 'settings'>('dashboard');
  loading = signal<boolean>(false);
  toastMsg = signal<string>('');
  errorMsg = signal<string>('');

  kpis = signal<any>(null);
  students = signal<any[]>([]);
  auditLogs = signal<any[]>([]);

  // Cashier state
  cashierSearch = '';
  selectedEnrollmentId = '';
  paymentAmount = 30000;
  paymentMethod = 'cash';
  paymentReference = '';
  lastReceipt = signal<any>(null);

  // Students state
  studentSearch = '';
  studentFilter = 'all';
  showNewStudentModal = signal<boolean>(false);
  walkinName = '';
  walkinPhone = '+237 6';
  walkinCategory = 'B';
  walkinInitialPayment = 0;
  generatedInvite = signal<any>(null);
  selectedStudentDetail = signal<any>(null);

  // Settings state
  newGroupName = '';
  newGroupCategory = 'B';
  newResTitle = '';
  newResDesc = '';

  async ngOnInit() {
    await this.refreshAll();
  }

  async refreshAll() {
    try {
      const [dash, stuList] = await Promise.all([
        this.api.getAdminDashboard(),
        this.api.getAdminStudents(),
      ]);
      this.kpis.set(dash);
      this.students.set(stuList || []);
      if (!this.selectedEnrollmentId && stuList?.length) {
        const firstWithEnrollment = stuList.find((s: any) => s.enrollment_id);
        if (firstWithEnrollment) {
          this.selectedEnrollmentId = firstWithEnrollment.enrollment_id;
        }
      }
    } catch {
      // Handled by offline cache
    }
  }

  actionableStudents() {
    return this.students().filter((s) => Number(s.balance_due || 0) > 0);
  }

  filteredCashierStudents() {
    const q = this.cashierSearch.trim().toLowerCase();
    return this.students().filter((s) => {
      if (!s.enrollment_id) return false;
      if (!q) return true;
      return (
        s.full_name?.toLowerCase().includes(q) ||
        s.phone?.toLowerCase().includes(q)
      );
    });
  }

  selectedCashierStudent() {
    return this.students().find((s) => s.enrollment_id === this.selectedEnrollmentId) || null;
  }

  onSelectCashierStudent() {
    const st = this.selectedCashierStudent();
    if (st && Number(st.balance_due) > 0) {
      this.paymentAmount = Math.min(30000, Number(st.balance_due));
    }
  }

  openQuickCashierFor(st: any) {
    if (st.enrollment_id) {
      this.selectedEnrollmentId = st.enrollment_id;
      this.onSelectCashierStudent();
    }
    this.activeTab.set('cashier');
  }

  async submitPayment() {
    this.errorMsg.set('');
    this.toastMsg.set('');
    if (!this.selectedEnrollmentId || !this.paymentAmount || this.paymentAmount <= 0) {
      this.errorMsg.set('Veuillez choisir un élève et saisir un montant valide (> 0 FCFA).');
      return;
    }

    const st = this.selectedCashierStudent();
    this.loading.set(true);
    try {
      const res = await this.api.recordPayment({
        enrollmentId: this.selectedEnrollmentId,
        amount: Number(this.paymentAmount),
        method: this.paymentMethod,
        reference: this.paymentReference || undefined,
        studentName: st?.full_name,
        studentPhone: st?.phone,
        categoryName: `Permis ${st?.category_code || 'B'}`,
        groupName: st?.group_name || 'Session AEM',
      });
      this.lastReceipt.set(res);
      this.paymentReference = '';
      this.toastMsg.set(`Reçu ${res.payment.receipt_number} généré avec succès.`);
      await this.refreshAll();
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || "Erreur lors de l'enregistrement du paiement.");
    } finally {
      this.loading.set(false);
    }
  }

  downloadLastReceiptPdf() {
    const r = this.lastReceipt();
    if (!r) return;
    this.receiptExport.generateReceiptPdf({
      receiptNumber: r.payment.receipt_number,
      studentName: r.student?.full_name || 'Élève AEM',
      studentPhone: r.student?.phone || '',
      categoryName: r.enrollment?.category_name || 'Permis B',
      groupName: r.enrollment?.group_name || 'Session AEM',
      amountPaid: Number(r.payment.amount),
      totalFee: Number(r.enrollment?.total_fee || 85000),
      totalPaidAfter: Number(r.enrollment?.total_paid || r.payment.amount),
      balanceRemaining: Number(r.enrollment?.balance_due || 0),
      method: r.payment.method,
      reference: r.payment.reference,
      paidAt: r.payment.paid_at || new Date().toISOString(),
      recordedBy: 'Direction Auto-École La Marseillaise',
    });
  }

  buildReminderWhatsApp(st: any): string {
    const cleanPhone = (st.phone || '').replace(/[^0-9]/g, '');
    const msg =
      `Bonjour *${st.full_name}*, ici la Direction de l'*Auto-École La Marseillaise (AEM)*.\n` +
      `Pour rappel, le solde restant de votre formation (${st.category_name || 'Permis B'}) est de *${Number(st.balance_due || 0).toLocaleString('fr-FR')} FCFA*.\n` +
      `Merci de passer au secrétariat ou de régler par Orange Money / MTN MoMo.`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  }

  filteredStudentsList() {
    const q = this.studentSearch.trim().toLowerCase();
    const f = this.studentFilter;
    return this.students().filter((s) => {
      if (q && !s.full_name?.toLowerCase().includes(q) && !s.phone?.toLowerCase().includes(q)) {
        return false;
      }
      if (f === 'overdue') return Number(s.balance_due || 0) > 0;
      if (f === 'trial') return !s.has_paid && s.trial_active;
      if (f === 'paid') return !!s.has_paid;
      return true;
    });
  }

  async submitWalkInStudent() {
    this.errorMsg.set('');
    if (!this.walkinName.trim() || !this.walkinPhone.trim()) {
      this.errorMsg.set('Veuillez remplir le nom et le téléphone.');
      return;
    }
    this.loading.set(true);
    try {
      const res = await this.api.createWalkInStudent({
        fullName: this.walkinName.trim(),
        phone: this.walkinPhone.trim(),
        categoryCode: this.walkinCategory,
        initialPaymentAmount: this.walkinInitialPayment > 0 ? this.walkinInitialPayment : undefined,
        initialPaymentMethod: 'cash',
      });
      this.generatedInvite.set(res);
      this.showNewStudentModal.set(false);
      this.walkinName = '';
      this.walkinPhone = '+237 6';
      this.walkinInitialPayment = 0;
      this.toastMsg.set('Dossier élève créé avec succès !');
      await this.refreshAll();
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || 'Impossible de créer le dossier élève.');
    } finally {
      this.loading.set(false);
    }
  }

  async openStudentDetail(studentId: string) {
    try {
      const detail = await this.api.getAdminStudentDetail(studentId);
      this.selectedStudentDetail.set(detail);
    } catch {
      this.errorMsg.set('Détails indisponibles hors-ligne.');
    }
  }

  async generateInviteForStudent(studentId: string) {
    try {
      const res = await this.api.generateStudentInvite(studentId);
      this.generatedInvite.set(res);
      this.toastMsg.set(`Nouveau code généré : ${res.inviteCode}`);
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || 'Erreur lors de la génération du code.');
    }
  }

  async promptCancelPayment(paymentId: string) {
    const reason = window.prompt('Motif obligatoire pour annuler ce reçu (min. 4 caractères) :');
    if (!reason || reason.trim().length < 4) return;
    try {
      await this.api.cancelPayment(paymentId, reason.trim());
      this.toastMsg.set('Reçu annulé et inscrit au journal d’audit.');
      if (this.selectedStudentDetail()) {
        await this.openStudentDetail(this.selectedStudentDetail().student.student_id);
      }
      await this.refreshAll();
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || "Erreur lors de l'annulation.");
    }
  }

  exportExcel() {
    this.receiptExport.exportStudentsToExcel(this.students());
  }

  exportPdfRoster() {
    this.receiptExport.exportStudentsToPdf(this.students());
  }

  async switchToSettings() {
    this.activeTab.set('settings');
    await this.loadAuditLogs();
  }

  async loadAuditLogs() {
    try {
      const logs = await this.api.getAdminAuditLog();
      this.auditLogs.set(logs || []);
    } catch {
      // Ignore offline
    }
  }

  async submitNewGroup() {
    if (!this.newGroupName.trim()) return;
    try {
      await this.api.createGroup({
        name: this.newGroupName.trim(),
        categoryCode: this.newGroupCategory,
        capacity: 30,
      });
      this.newGroupName = '';
      this.toastMsg.set('Nouvelle vague créée avec échéancier en 3 tranches.');
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || 'Erreur lors de la création de la vague.');
    }
  }

  async submitNewResource() {
    if (!this.newResTitle.trim()) return;
    try {
      await this.api.createResource({
        title: this.newResTitle.trim(),
        description: this.newResDesc.trim(),
        categoryCode: 'B',
        kind: 'pdf',
        isFreePreview: true,
      });
      this.newResTitle = '';
      this.newResDesc = '';
      this.toastMsg.set('Support de cours publié.');
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || 'Erreur lors de la publication.');
    }
  }
}
