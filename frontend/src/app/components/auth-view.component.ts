import { Component, EventEmitter, Output, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-auth-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-[100dvh] bg-[#F4F7FB] flex flex-col justify-between px-4 py-6 max-w-md mx-auto">
      <!-- Top Brand Hero (AEM Clair — Bleu Marseillaise) -->
      <div>
        <div class="flex items-center justify-between mb-5">
          <div class="flex items-center gap-3">
            <img src="/aem-icon.svg" alt="AEM Logo" class="w-12 h-12 rounded-2xl shadow-sm" />
            <div>
              <div class="flex items-center gap-1.5">
                <span class="text-[11px] font-bold tracking-wider uppercase text-[#D94E28]">LA MARSEILLAISE</span>
                <span class="text-[#EAB308] text-xs">★</span>
              </div>
              <h1 class="text-xl font-extrabold text-[#0F1E36] tracking-tight leading-none">
                Auto-École <span class="text-[#3D8BCD]">AEM</span>
              </h1>
              <p class="text-xs text-[#4A607A] mt-0.5">Cameroun • Permis A, B, C, D</p>
            </div>
          </div>

          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#E8F2FC] text-[#2B6CA8] border border-[#3D8BCD]/20">
            <span class="w-1.5 h-1.5 rounded-full bg-[#3D8BCD]"></span>
            14j Essai Gratuit
          </span>
        </div>

        <!-- Mode Segmented Control (Apple Light Style) -->
        <div class="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-[#E8EEF6] border border-[#CBD5E1]/70 mb-5">
          <button
            type="button"
            (click)="switchMode('login')"
            [class]="mode() === 'login'
              ? 'py-2.5 px-2 rounded-xl text-xs font-bold bg-white text-[#0F1E36] shadow-sm transition-all'
              : 'py-2.5 px-2 rounded-xl text-xs font-semibold text-[#4A607A] transition-all'"
          >
            Connexion
          </button>
          <button
            type="button"
            (click)="switchMode('register')"
            [class]="mode() === 'register'
              ? 'py-2.5 px-2 rounded-xl text-xs font-bold bg-white text-[#3D8BCD] shadow-sm transition-all'
              : 'py-2.5 px-2 rounded-xl text-xs font-semibold text-[#4A607A] transition-all'"
          >
            Inscription (14j)
          </button>
          <button
            type="button"
            (click)="switchMode('invite')"
            [class]="mode() === 'invite'
              ? 'py-2.5 px-2 rounded-xl text-xs font-bold bg-white text-[#D94E28] shadow-sm transition-all'
              : 'py-2.5 px-2 rounded-xl text-xs font-semibold text-[#4A607A] transition-all'"
          >
            Code Agence
          </button>
        </div>

        <!-- Error / Info Banner -->
        @if (errorMsg()) {
          <div class="mb-4 p-3.5 rounded-2xl bg-[#FEF2F2] border border-[#DC2626]/20 text-xs font-medium text-[#DC2626] flex items-start justify-between gap-2">
            <span>{{ errorMsg() }}</span>
            <button type="button" (click)="errorMsg.set('')" class="font-bold text-sm leading-none">×</button>
          </div>
        }

        @if (infoMsg()) {
          <div class="mb-4 p-3.5 rounded-2xl bg-[#E8F2FC] border border-[#3D8BCD]/30 text-xs font-medium text-[#1E4F82]">
            {{ infoMsg() }}
          </div>
        }

        <!-- ==================== 1. CONNEXION ==================== -->
        @if (mode() === 'login') {
          <form (ngSubmit)="submitLogin()" class="aem-card p-5 space-y-4">
            <div>
              <h2 class="text-base font-bold text-[#0F1E36]">Bon retour parmi nous</h2>
              <p class="text-xs text-[#4A607A]">Connectez-vous avec votre numéro (+237) ou email.</p>
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#0F1E36] mb-1.5">Téléphone ou Email</label>
              <input
                type="text"
                name="identifier"
                [(ngModel)]="loginIdentifier"
                placeholder="+237 699 00 00 01"
                required
                class="aem-input"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#0F1E36] mb-1.5">Mot de passe</label>
              <input
                type="password"
                name="password"
                [(ngModel)]="loginPassword"
                placeholder="••••••••"
                required
                class="aem-input"
              />
            </div>

            <button
              type="submit"
              [disabled]="loading()"
              class="w-full py-3.5 px-4 rounded-xl font-bold text-sm aem-btn-primary shadow-sm disabled:opacity-50"
            >
              {{ loading() ? 'Connexion en cours...' : 'Se connecter' }}
            </button>

            <!-- Demo Quick Access (1-Tap Evaluation) -->
            <div class="pt-3 border-t border-[#E2E8F0]">
              <p class="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-2">
                Accès rapide démo (1 clic)
              </p>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  (click)="fillAdminDemo()"
                  class="py-2.5 px-3 rounded-xl text-xs font-bold bg-[#F0F6FC] text-[#2B6CA8] border border-[#3D8BCD]/25 text-left"
                >
                  <span class="block text-[10px] text-[#D94E28] font-extrabold">DIRECTION / CAISSE</span>
                  Admin Démo
                </button>
                <button
                  type="button"
                  (click)="switchMode('register')"
                  class="py-2.5 px-3 rounded-xl text-xs font-bold bg-[#F8FAFC] text-[#0F1E36] border border-[#CBD5E1] text-left"
                >
                  <span class="block text-[10px] text-[#3D8BCD] font-extrabold">NOUVEL ÉLÈVE</span>
                  Créer en 30 sec
                </button>
              </div>
            </div>
          </form>
        }

        <!-- ==================== 2. INSCRIPTION ÉLÈVE (14J ESSAI GRATUIT) ==================== -->
        @if (mode() === 'register') {
          <div class="aem-card p-5 space-y-4">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h2 class="text-base font-bold text-[#0F1E36]">Inscription Élève en ligne</h2>
                <p class="text-xs text-[#4A607A]">14 jours d'accès gratuit aux cours & quiz du Code.</p>
              </div>
              <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#ECFDF5] text-[#16A34A]">
                Étape {{ otpSent() ? '2/2' : '1/2' }}
              </span>
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#0F1E36] mb-1">Nom complet</label>
              <input
                type="text"
                [(ngModel)]="regFullName"
                placeholder="Ex: Jean-marc Ngono"
                class="aem-input"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#0F1E36] mb-1">Téléphone WhatsApp / SMS (+237)</label>
              <div class="flex gap-2">
                <input
                  type="tel"
                  [(ngModel)]="regPhone"
                  placeholder="+237 690 12 34 56"
                  class="aem-input flex-1"
                />
                <button
                  type="button"
                  (click)="requestOtp()"
                  [disabled]="loading() || !regPhone"
                  class="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-[#E8F2FC] text-[#2B6CA8] border border-[#3D8BCD]/30 shrink-0"
                >
                  {{ otpSent() ? 'Renvoyer' : 'Recevoir code' }}
                </button>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2.5">
              <div>
                <label class="block text-xs font-semibold text-[#0F1E36] mb-1">Catégorie Permis</label>
                <select
                  [(ngModel)]="regCategoryCode"
                  (ngModelChange)="onCategoryChange()"
                  class="aem-input text-sm"
                >
                  @for (cat of categories(); track cat.id) {
                    <option [value]="cat.code">Permis {{ cat.code }} ({{ cat.default_fee | number }} F)</option>
                  }
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#0F1E36] mb-1">Vague / Session</label>
                <select [(ngModel)]="regGroupId" class="aem-input text-sm">
                  <option value="">Choisir plus tard</option>
                  @for (grp of filteredGroups(); track grp.id) {
                    <option [value]="grp.id">{{ grp.name }} ({{ grp.available_seats }} pl.)</option>
                  }
                </select>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#0F1E36] mb-1">Créer un mot de passe (min. 6 car.)</label>
              <input
                type="password"
                [(ngModel)]="regPassword"
                placeholder="••••••••"
                class="aem-input"
              />
            </div>

            @if (otpSent()) {
              <div class="p-3.5 rounded-2xl bg-[#F0F7FF] border border-[#3D8BCD]/30 space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-bold text-[#1E4F82]">Code de vérification à 6 chiffres</label>
                  @if (devOtpPreview()) {
                    <span class="px-2 py-0.5 rounded bg-[#3D8BCD] text-white text-[11px] font-mono font-bold">
                      Code : {{ devOtpPreview() }}
                    </span>
                  }
                </div>
                <input
                  type="text"
                  maxlength="6"
                  [(ngModel)]="regOtpCode"
                  placeholder="123456"
                  class="aem-input text-center font-mono text-lg font-bold tracking-widest"
                />
              </div>

              <button
                type="button"
                (click)="submitRegister()"
                [disabled]="loading()"
                class="w-full py-3.5 px-4 rounded-xl font-bold text-sm aem-btn-primary shadow-sm"
              >
                {{ loading() ? 'Activation en cours...' : 'Activer mes 14 jours gratuits' }}
              </button>
            } @else {
              <button
                type="button"
                (click)="requestOtp()"
                [disabled]="loading()"
                class="w-full py-3.5 px-4 rounded-xl font-bold text-sm aem-btn-primary shadow-sm"
              >
                {{ loading() ? 'Envoi du code...' : 'Continuer & vérifier mon numéro' }}
              </button>
            }
          </div>
        }

        <!-- ==================== 3. CODE INVITATION AGENCE (WALK-IN) ==================== -->
        @if (mode() === 'invite') {
          <form (ngSubmit)="submitClaimInvite()" class="aem-card p-5 space-y-4">
            <div>
              <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[#FFF7ED] text-[#D94E28] mb-1">
                INSCRIT AU SECRÉTARIAT
              </span>
              <h2 class="text-base font-bold text-[#0F1E36]">Activer mon Code Agence</h2>
              <p class="text-xs text-[#4A607A]">
                Saisissez le code à 8 caractères remis sur votre fiche ou par WhatsApp.
              </p>
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#0F1E36] mb-1">Code d'invitation (8 caractères)</label>
              <input
                type="text"
                name="inviteCode"
                maxlength="8"
                [(ngModel)]="inviteCode"
                placeholder="AB3K9M2P"
                required
                class="aem-input text-center font-mono text-lg font-extrabold uppercase tracking-widest"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#0F1E36] mb-1">Votre numéro de téléphone (+237)</label>
              <input
                type="tel"
                name="invitePhone"
                [(ngModel)]="invitePhone"
                placeholder="+237 6..."
                required
                class="aem-input"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#0F1E36] mb-1">Choisissez votre mot de passe</label>
              <input
                type="password"
                name="invitePassword"
                [(ngModel)]="invitePassword"
                placeholder="Minimum 6 caractères"
                required
                class="aem-input"
              />
            </div>

            <button
              type="submit"
              [disabled]="loading()"
              class="w-full py-3.5 px-4 rounded-xl font-bold text-sm aem-btn-coral shadow-sm"
            >
              {{ loading() ? 'Vérification...' : 'Activer mon compte élève' }}
            </button>
          </form>
        }
      </div>

      <!-- Footer -->
      <div class="pt-6 text-center">
        <p class="text-[11px] font-medium text-[#64748B]">
          Auto-École La Marseillaise (AEM) • Application Officielle Hors-Ligne
        </p>
      </div>
    </div>
  `,
})
export class AuthViewComponent implements OnInit {
  private api = inject(ApiService);
  @Output() authenticated = new EventEmitter<void>();

  mode = signal<'login' | 'register' | 'invite'>('login');
  loading = signal<boolean>(false);
  errorMsg = signal<string>('');
  infoMsg = signal<string>('');

  // Catalogue
  categories = signal<any[]>([
    { id: '1', code: 'B', name: 'Permis B — Voiture légère', default_fee: 85000 },
    { id: '2', code: 'A', name: 'Permis A — Moto', default_fee: 55000 },
    { id: '3', code: 'C', name: 'Permis C — Poids lourd', default_fee: 125000 },
    { id: '4', code: 'D', name: 'Permis D — Transport en commun', default_fee: 140000 },
  ]);
  groups = signal<any[]>([]);

  // Login form
  loginIdentifier = '';
  loginPassword = '';

  // Register form
  regFullName = '';
  regPhone = '+237 6';
  regCategoryCode = 'B';
  regGroupId = '';
  regPassword = '';
  regOtpCode = '';
  otpSent = signal<boolean>(false);
  devOtpPreview = signal<string>('');

  // Invite form
  inviteCode = '';
  invitePhone = '+237 6';
  invitePassword = '';

  async ngOnInit() {
    try {
      const cat = await this.api.getCatalogue();
      if (cat?.categories?.length) {
        this.categories.set(cat.categories);
      }
      if (cat?.groups?.length) {
        this.groups.set(cat.groups);
      }
      this.onCategoryChange();
    } catch {
      // Keep default offline categories
    }
  }

  filteredGroups() {
    return this.groups().filter((g) => g.category_code === this.regCategoryCode);
  }

  onCategoryChange() {
    const matching = this.filteredGroups();
    this.regGroupId = matching.length > 0 ? matching[0].id : '';
  }

  switchMode(newMode: 'login' | 'register' | 'invite') {
    this.mode.set(newMode);
    this.errorMsg.set('');
    this.infoMsg.set('');
  }

  async fillAdminDemo() {
    this.loginIdentifier = '+237699000001';
    this.loginPassword = 'Admin@Marseillaise2026!';
    await this.submitLogin();
  }

  async submitLogin() {
    this.errorMsg.set('');
    if (!this.loginIdentifier || !this.loginPassword) {
      this.errorMsg.set('Veuillez renseigner votre identifiant et votre mot de passe.');
      return;
    }
    this.loading.set(true);
    try {
      await this.api.login(this.loginIdentifier.trim(), this.loginPassword);
      this.authenticated.emit();
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || 'Identifiants incorrects ou connexion indisponible.');
    } finally {
      this.loading.set(false);
    }
  }

  async requestOtp() {
    this.errorMsg.set('');
    if (!this.regFullName.trim() || this.regFullName.trim().length < 2) {
      this.errorMsg.set('Veuillez entrer votre nom complet.');
      return;
    }
    if (!this.regPhone.trim()) {
      this.errorMsg.set('Veuillez entrer votre numéro de téléphone (+237).');
      return;
    }
    if (!this.regPassword || this.regPassword.length < 6) {
      this.errorMsg.set('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }

    this.loading.set(true);
    try {
      const res = await this.api.requestOtp(this.regPhone.trim());
      this.otpSent.set(true);
      if (res?.devOtp) {
        this.devOtpPreview.set(res.devOtp);
        this.regOtpCode = res.devOtp;
      }
      this.infoMsg.set(res?.message || 'Code envoyé par WhatsApp / SMS.');
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || "Impossible d'envoyer le code OTP.");
    } finally {
      this.loading.set(false);
    }
  }

  async submitRegister() {
    this.errorMsg.set('');
    if (!this.regOtpCode || this.regOtpCode.trim().length !== 6) {
      this.errorMsg.set('Veuillez saisir le code à 6 chiffres.');
      return;
    }
    this.loading.set(true);
    try {
      await this.api.registerStudent({
        fullName: this.regFullName.trim(),
        phone: this.regPhone.trim(),
        password: this.regPassword,
        otpCode: this.regOtpCode.trim(),
        categoryCode: this.regCategoryCode,
        groupId: this.regGroupId || undefined,
      });
      this.authenticated.emit();
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || "Erreur lors de l'inscription.");
    } finally {
      this.loading.set(false);
    }
  }

  async submitClaimInvite() {
    this.errorMsg.set('');
    if (!this.inviteCode.trim() || !this.invitePhone.trim() || this.invitePassword.length < 6) {
      this.errorMsg.set('Veuillez remplir le code à 8 caractères, votre téléphone et un mot de passe (min 6 car.).');
      return;
    }
    this.loading.set(true);
    try {
      await this.api.claimInvite({
        code: this.inviteCode.trim().toUpperCase(),
        phone: this.invitePhone.trim(),
        password: this.invitePassword,
      });
      this.authenticated.emit();
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || "Code d'invitation invalide ou expiré.");
    } finally {
      this.loading.set(false);
    }
  }
}
