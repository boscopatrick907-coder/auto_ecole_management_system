import { Component, EventEmitter, Output, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-auth-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-[100dvh] bg-surface text-on-surface flex flex-col justify-between max-w-md mx-auto pb-safe">
      <!-- Top Frosted Header (Clarté Routière + Bleu Marseillaise) -->
      <header class="sticky top-0 z-40 bg-surface-container-lowest/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <img src="/aem-icon.svg" alt="AEM Logo" class="w-10 h-10 rounded-xl shadow-xs" />
          <div>
            <div class="flex items-center gap-1">
              <span class="material-symbols-outlined text-primary text-[16px]">verified</span>
              <span class="text-[11px] font-bold uppercase tracking-wider text-primary">Auto-école La Marseillaise</span>
            </div>
            <h1 class="text-sm font-extrabold text-on-surface leading-tight">
              Yaoundé Bastos &amp; Douala Akwa
            </h1>
          </div>
        </div>
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-primary-fixed text-on-primary-fixed-variant">
          <span class="material-symbols-outlined text-[14px]">timer</span>
          14j Gratuits
        </span>
      </header>

      <main class="flex-1 px-4 pt-4 space-y-4">
        <!-- Segmented Switcher -->
        <div class="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-surface-container border border-outline-variant/40">
          <button
            type="button"
            (click)="switchMode('login')"
            [class]="mode() === 'login'
              ? 'min-h-[44px] px-2 rounded-xl text-xs font-bold bg-surface-container-lowest text-primary shadow-sm flex items-center justify-center gap-1 transition-all'
              : 'min-h-[44px] px-2 rounded-xl text-xs font-semibold text-on-surface-variant flex items-center justify-center gap-1 transition-all'"
          >
            <span class="material-symbols-outlined text-[16px]">login</span>
            <span>Connexion</span>
          </button>
          <button
            type="button"
            (click)="switchMode('register')"
            [class]="mode() === 'register'
              ? 'min-h-[44px] px-2 rounded-xl text-xs font-bold bg-surface-container-lowest text-primary shadow-sm flex items-center justify-center gap-1 transition-all'
              : 'min-h-[44px] px-2 rounded-xl text-xs font-semibold text-on-surface-variant flex items-center justify-center gap-1 transition-all'"
          >
            <span class="material-symbols-outlined text-[16px]">person_add</span>
            <span>Inscription</span>
          </button>
          <button
            type="button"
            (click)="switchMode('invite')"
            [class]="mode() === 'invite'
              ? 'min-h-[44px] px-2 rounded-xl text-xs font-bold bg-surface-container-lowest text-secondary shadow-sm flex items-center justify-center gap-1 transition-all'
              : 'min-h-[44px] px-2 rounded-xl text-xs font-semibold text-on-surface-variant flex items-center justify-center gap-1 transition-all'"
          >
            <span class="material-symbols-outlined text-[16px]">key</span>
            <span>Code Agence</span>
          </button>
        </div>

        <!-- Feedback Banners -->
        @if (errorMsg()) {
          <div class="p-3.5 rounded-xl bg-error-container text-on-error-container text-xs font-bold flex items-start justify-between gap-2 shadow-xs">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-[18px]">error</span>
              <span>{{ errorMsg() }}</span>
            </div>
            <button type="button" (click)="errorMsg.set('')" class="font-bold text-base leading-none">×</button>
          </div>
        }

        @if (infoMsg()) {
          <div class="p-3.5 rounded-xl bg-primary-fixed text-on-primary-fixed text-xs font-semibold flex items-center gap-2 shadow-xs">
            <span class="material-symbols-outlined text-[18px]">info</span>
            <span>{{ infoMsg() }}</span>
          </div>
        }

        <!-- ==================== 1. CONNEXION ==================== -->
        @if (mode() === 'login') {
          <form (ngSubmit)="submitLogin()" class="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/30 space-y-4">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-primary-fixed text-primary flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-[24px]">directions_car</span>
              </div>
              <div>
                <h2 class="text-base font-bold text-on-surface">Espace Apprenant &amp; Direction</h2>
                <p class="text-xs text-on-surface-variant">Connectez-vous avec votre numéro (+237) ou email</p>
              </div>
            </div>

            <div>
              <label class="block text-xs font-bold text-on-surface mb-1.5">Numéro de téléphone (+237) ou Email</label>
              <div class="relative">
                <span class="material-symbols-outlined text-outline text-[20px] absolute left-3.5 top-1/2 -translate-y-1/2">call</span>
                <input
                  type="text"
                  name="identifier"
                  [(ngModel)]="loginIdentifier"
                  placeholder="+237 699 00 00 01"
                  required
                  class="aem-input pl-11"
                />
              </div>
            </div>

            <div>
              <label class="block text-xs font-bold text-on-surface mb-1.5">Mot de passe</label>
              <div class="relative">
                <span class="material-symbols-outlined text-outline text-[20px] absolute left-3.5 top-1/2 -translate-y-1/2">lock</span>
                <input
                  type="password"
                  name="password"
                  [(ngModel)]="loginPassword"
                  placeholder="••••••••"
                  required
                  class="aem-input pl-11"
                />
              </div>
            </div>

            <button
              type="submit"
              [disabled]="loading()"
              class="w-full min-h-[52px] px-4 rounded-xl font-bold text-sm bg-primary text-on-primary shadow-md flex items-center justify-center gap-2 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              <span class="material-symbols-outlined text-[20px]">login</span>
              <span>{{ loading() ? 'Connexion en cours...' : 'Accéder à mon espace' }}</span>
            </button>

            <!-- 1-Tap Demo Access (Mama Célestine Admin & New Student) -->
            <div class="pt-3 border-t border-surface-container-high space-y-2">
              <span class="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                Accès rapide Démonstration (1 clic)
              </span>
              <div class="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  (click)="fillAdminDemo()"
                  class="p-3 rounded-xl bg-primary-fixed/60 hover:bg-primary-fixed text-left transition-colors border border-primary/15"
                >
                  <div class="flex items-center gap-1.5 text-primary font-bold text-xs">
                    <span class="material-symbols-outlined text-[18px]">admin_panel_settings</span>
                    <span>Mama Célestine</span>
                  </div>
                  <span class="block text-[10px] text-on-surface-variant mt-0.5">Direction &amp; Caisse Bastos</span>
                </button>
                <button
                  type="button"
                  (click)="switchMode('register')"
                  class="p-3 rounded-xl bg-secondary-fixed/60 hover:bg-secondary-fixed text-left transition-colors border border-secondary/15"
                >
                  <div class="flex items-center gap-1.5 text-on-secondary-fixed font-bold text-xs">
                    <span class="material-symbols-outlined text-[18px]">school</span>
                    <span>Nouvel Élève</span>
                  </div>
                  <span class="block text-[10px] text-on-secondary-fixed-variant mt-0.5">Essai 14j gratuit immédiat</span>
                </button>
              </div>
            </div>
          </form>
        }

        <!-- ==================== 2. INSCRIPTION ÉLÈVE (Screen 01 Stitch) ==================== -->
        @if (mode() === 'register') {
          <div class="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/30 space-y-4">
            <!-- Hero Trial Badge -->
            <div class="bg-secondary-fixed/60 text-on-secondary-fixed p-3.5 rounded-xl flex items-center justify-between gap-2">
              <div class="flex items-center gap-2.5">
                <span class="material-symbols-outlined text-secondary text-[24px]">timer</span>
                <div>
                  <span class="text-xs font-extrabold block">14 Jours d'Essai Gratuit Inclus</span>
                  <span class="text-[11px] text-on-secondary-fixed-variant">Code CEMAC, cours PDF hors-ligne &amp; examens blancs</span>
                </div>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-container-lowest text-secondary">
                Étape {{ otpSent() ? '2/2' : '1/2' }}
              </span>
            </div>

            <!-- 1. Tactile Permit Category Tiles (Stitch Design) -->
            <div class="space-y-1.5">
              <label class="block text-xs font-bold text-on-surface">1. Choisir votre catégorie de permis</label>
              <div class="grid grid-cols-2 gap-2">
                @for (cat of categories(); track cat.code) {
                  <button
                    type="button"
                    (click)="selectCategory(cat.code)"
                    [class]="regCategoryCode === cat.code
                      ? 'p-3 rounded-xl bg-primary text-on-primary flex items-center gap-2.5 text-left shadow-sm transition-all'
                      : 'p-3 rounded-xl bg-surface-container-low text-on-surface hover:bg-surface-container flex items-center gap-2.5 text-left transition-all'"
                  >
                    <span class="material-symbols-outlined text-[24px]">
                      {{ cat.code === 'A' ? 'two_wheeler' : cat.code === 'C' ? 'local_shipping' : cat.code === 'D' ? 'directions_bus' : 'directions_car' }}
                    </span>
                    <div class="min-w-0">
                      <span class="text-xs font-bold block leading-tight">Permis {{ cat.code }}</span>
                      <span class="text-[10px] opacity-80 block truncate font-tabular">{{ cat.default_fee | number }} FCFA</span>
                    </div>
                  </button>
                }
              </div>
            </div>

            <!-- 2. Group / Session Selection -->
            <div>
              <label class="block text-xs font-bold text-on-surface mb-1">2. Vague / Session souhaitée</label>
              <select [(ngModel)]="regGroupId" class="aem-input text-xs font-semibold">
                <option value="">Attribution automatique (Session ouverte)</option>
                @for (grp of filteredGroups(); track grp.id) {
                  <option [value]="grp.id">{{ grp.name }} ({{ grp.available_seats }} places)</option>
                }
              </select>
            </div>

            <!-- 3. Student Identity & Phone -->
            <div>
              <label class="block text-xs font-bold text-on-surface mb-1">3. Nom et Prénoms (comme sur la CNI)</label>
              <input
                type="text"
                [(ngModel)]="regFullName"
                placeholder="Ex: Jean-Paul Mvondo"
                class="aem-input"
              />
            </div>

            <div>
              <label class="block text-xs font-bold text-on-surface mb-1">4. Numéro WhatsApp / SMS (+237)</label>
              <div class="flex gap-2">
                <input
                  type="tel"
                  [(ngModel)]="regPhone"
                  placeholder="+237 699 45 12 30"
                  class="aem-input flex-1"
                />
                <button
                  type="button"
                  (click)="requestOtp()"
                  [disabled]="loading() || !regPhone"
                  class="px-3.5 rounded-xl text-xs font-bold bg-primary-fixed text-on-primary-fixed-variant shrink-0"
                >
                  {{ otpSent() ? 'Renvoyer' : 'Code SMS' }}
                </button>
              </div>
            </div>

            <div>
              <label class="block text-xs font-bold text-on-surface mb-1">5. Créer un mot de passe (min. 6 car.)</label>
              <input
                type="password"
                [(ngModel)]="regPassword"
                placeholder="••••••••"
                class="aem-input"
              />
            </div>

            @if (otpSent()) {
              <div class="p-4 rounded-xl bg-primary-fixed/50 border border-primary/20 space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-bold text-primary">Code de vérification à 6 chiffres</label>
                  @if (devOtpPreview()) {
                    <span class="px-2 py-0.5 rounded bg-primary text-on-primary text-[11px] font-mono font-bold">
                      Code démo : {{ devOtpPreview() }}
                    </span>
                  }
                </div>
                <input
                  type="text"
                  maxlength="6"
                  [(ngModel)]="regOtpCode"
                  placeholder="123456"
                  class="aem-input text-center font-mono text-lg font-extrabold tracking-widest"
                />
              </div>

              <button
                type="button"
                (click)="submitRegister()"
                [disabled]="loading()"
                class="w-full min-h-[52px] px-4 rounded-xl font-bold text-sm bg-tertiary-container text-on-tertiary shadow-md flex items-center justify-center gap-2"
              >
                <span class="material-symbols-outlined text-[20px]">check_circle</span>
                <span>{{ loading() ? 'Activation en cours...' : 'Démarrer mes 14 jours gratuits' }}</span>
              </button>
            } @else {
              <button
                type="button"
                (click)="requestOtp()"
                [disabled]="loading()"
                class="w-full min-h-[52px] px-4 rounded-xl font-bold text-sm bg-primary text-on-primary shadow-md flex items-center justify-center gap-2"
              >
                <span class="material-symbols-outlined text-[20px]">sms</span>
                <span>{{ loading() ? 'Envoi du code...' : 'Recevoir mon code de validation' }}</span>
              </button>
            }
          </div>
        }

        <!-- ==================== 3. CODE INVITATION AGENCE (Walk-In) ==================== -->
        @if (mode() === 'invite') {
          <form (ngSubmit)="submitClaimInvite()" class="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/30 space-y-4">
            <div class="flex items-start gap-3">
              <div class="w-11 h-11 rounded-xl bg-secondary-fixed text-secondary flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-[24px]">storefront</span>
              </div>
              <div>
                <span class="text-[10px] font-bold uppercase tracking-wider text-secondary block">Inscrit au Guichet Bastos / Akwa</span>
                <h2 class="text-base font-bold text-on-surface">Activer mon Code Agence</h2>
                <p class="text-xs text-on-surface-variant mt-0.5">
                  Saisissez le code à 8 caractères remis par Mama Célestine au secrétariat.
                </p>
              </div>
            </div>

            <div>
              <label class="block text-xs font-bold text-on-surface mb-1">Code d'invitation (8 caractères)</label>
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
              <label class="block text-xs font-bold text-on-surface mb-1">Votre numéro de téléphone (+237)</label>
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
              <label class="block text-xs font-bold text-on-surface mb-1">Choisissez votre mot de passe</label>
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
              class="w-full min-h-[52px] px-4 rounded-xl font-bold text-sm bg-primary text-on-primary shadow-md flex items-center justify-center gap-2"
            >
              <span class="material-symbols-outlined text-[20px]">verified_user</span>
              <span>{{ loading() ? 'Activation...' : 'Activer mon dossier élève' }}</span>
            </button>
          </form>
        }
      </main>

      <!-- Regulatory Footer -->
      <footer class="px-4 py-5 text-center space-y-1">
        <p class="text-[11px] font-bold text-primary">
          Agrément MINTRANS N° 00412 / MINT / DTT • République du Cameroun
        </p>
        <p class="text-[10px] text-on-surface-variant">
          Application PWA Offline-First • Fonctionne sans connexion Internet
        </p>
      </footer>
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

  categories = signal<any[]>([
    { id: '1', code: 'B', name: 'Permis B — Voiture légère', default_fee: 150000 },
    { id: '2', code: 'A', name: 'Permis A — Moto & Tricycle', default_fee: 75000 },
    { id: '3', code: 'C', name: 'Permis C — Poids Lourd', default_fee: 220000 },
    { id: '4', code: 'D', name: 'Permis D — Transport en commun', default_fee: 250000 },
  ]);
  groups = signal<any[]>([]);

  loginIdentifier = '';
  loginPassword = '';

  regFullName = '';
  regPhone = '+237 6';
  regCategoryCode = 'B';
  regGroupId = '';
  regPassword = '';
  regOtpCode = '';
  otpSent = signal<boolean>(false);
  devOtpPreview = signal<string>('');

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
      // Offline defaults kept
    }
  }

  selectCategory(code: string) {
    this.regCategoryCode = code;
    this.onCategoryChange();
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
      this.errorMsg.set(err?.message || err?.error?.message || 'Identifiants incorrects.');
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
      this.infoMsg.set(res?.message || 'Code de vérification généré.');
    } catch (err: any) {
      this.errorMsg.set(err?.message || "Impossible d'envoyer le code OTP.");
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
      const selectedCat = this.categories().find((c) => c.code === this.regCategoryCode);
      await this.api.registerStudent({
        fullName: this.regFullName.trim(),
        phone: this.regPhone.trim(),
        password: this.regPassword,
        otpCode: this.regOtpCode.trim(),
        licenceCategoryId: selectedCat?.id,
        categoryCode: this.regCategoryCode,
        groupId: this.regGroupId || undefined,
      });
      this.authenticated.emit();
    } catch (err: any) {
      this.errorMsg.set(err?.message || "Erreur lors de l'inscription.");
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
      this.errorMsg.set(err?.message || "Code d'invitation invalide ou expiré.");
    } finally {
      this.loading.set(false);
    }
  }
}
