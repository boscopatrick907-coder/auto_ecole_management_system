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
    @if (initializing()) {
      <div class="min-h-[100dvh] bg-[#F4F7FB] flex flex-col items-center justify-center p-6 text-center">
        <img src="/aem-icon.svg" alt="AEM" class="w-16 h-16 rounded-2xl shadow-md mb-4 animate-pulse" />
        <h1 class="text-base font-extrabold text-[#0F1E36]">Auto-École La Marseillaise</h1>
        <p class="text-xs text-[#4A607A] mt-1">Chargement de votre espace sécurisé...</p>
      </div>
    } @else if (!api.currentUser()) {
      <app-auth-view (authenticated)="onAuthenticated()" />
    } @else if (api.currentUser()?.role === 'admin' || api.currentUser()?.role === 'instructor') {
      <app-admin-portal (logout)="onLogout()" />
    } @else {
      <app-student-portal (logout)="onLogout()" />
    }
  `,
})
export class AppComponent implements OnInit {
  api = inject(ApiService);
  initializing = signal<boolean>(true);

  async ngOnInit() {
    try {
      await this.api.restoreSession();
    } finally {
      this.initializing.set(false);
    }
  }

  onAuthenticated() {
    // Signal currentUser is already updated by ApiService
  }

  async onLogout() {
    await this.api.logout();
  }
}
