import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from './services/api.service';
import { AuthViewComponent } from './components/auth-view.component';
import { StudentPortalComponent } from './components/student-portal.component';
import { AdminPortalComponent } from './components/admin-portal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    AuthViewComponent,
    StudentPortalComponent,
    AdminPortalComponent,
  ],
  template: `
    <!-- Stitch Screen 15 Prototype Quick-Switcher Bar (Clarté Routière) -->
    <div class="bg-[#00376f] text-white px-3 py-1.5 text-[11px] flex items-center justify-between gap-2 z-50">
      <div class="flex items-center gap-1.5 font-headline font-bold truncate">
        <span class="w-2 h-2 rounded-full bg-[#feae2c]"></span>
        <span>Stitch Clarté Routière (15 Écrans)</span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button
          type="button"
          (click)="previewMode.set('auth')"
          class="px-2 py-0.5 rounded font-bold transition-colors"
          [ngClass]="activeView() === 'auth' ? 'bg-white text-[#00376f]' : 'bg-white/15 text-white hover:bg-white/25'"
        >
          01 • Inscription
        </button>
        <button
          type="button"
          (click)="previewMode.set('student')"
          class="px-2 py-0.5 rounded font-bold transition-colors"
          [ngClass]="activeView() === 'student' ? 'bg-white text-[#00376f]' : 'bg-white/15 text-white hover:bg-white/25'"
        >
          02-05 • Espace Élève
        </button>
        <button
          type="button"
          (click)="previewMode.set('admin')"
          class="px-2 py-0.5 rounded font-bold transition-colors"
          [ngClass]="activeView() === 'admin' ? 'bg-white text-[#00376f]' : 'bg-white/15 text-white hover:bg-white/25'"
        >
          06-14 • Admin &amp; Caisse
        </button>
      </div>
    </div>

    @if (initializing()) {
      <div class="min-h-[100dvh] bg-surface flex flex-col items-center justify-center p-6 text-center">
        <img src="/aem-icon.svg" alt="AEM" class="w-16 h-16 rounded-2xl shadow-md mb-4 animate-pulse" />
        <h1 class="text-base font-extrabold text-primary">Auto-École La Marseillaise</h1>
        <p class="text-xs text-on-surface-variant mt-1">Chargement de votre espace sécurisé...</p>
      </div>
    } @else if (activeView() === 'auth') {
      <app-auth-view (authenticated)="onAuthenticated()" />
    } @else if (activeView() === 'admin') {
      <app-admin-portal [user]="api.currentUser()" (logout)="onLogout()" />
    } @else {
      <app-student-portal [user]="api.currentUser()" (logout)="onLogout()" />
    }
  `,
})
export class AppComponent implements OnInit {
  api = inject(ApiService);
  initializing = signal<boolean>(true);
  previewMode = signal<'auto' | 'auth' | 'student' | 'admin'>('auto');

  activeView(): 'auth' | 'student' | 'admin' {
    const mode = this.previewMode();
    if (mode !== 'auto') return mode;
    const u = this.api.currentUser();
    if (!u) return 'auth';
    if (u.role === 'admin' || u.role === 'instructor') return 'admin';
    return 'student';
  }

  async ngOnInit() {
    try {
      await this.api.restoreSession();
    } finally {
      this.initializing.set(false);
    }
  }

  onAuthenticated() {
    this.previewMode.set('auto');
  }

  async onLogout() {
    await this.api.logout();
    this.previewMode.set('auth');
  }
}
