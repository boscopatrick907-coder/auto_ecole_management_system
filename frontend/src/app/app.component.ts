import { Component, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { FR } from "./core/fr";
import { PwaService } from "./core/pwa.service";
import { IconComponent } from "./shared/ui";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, IconComponent],
  template: `<a class="skip-link" href="#main">{{ t.next }}</a>
    @if (pwa.updateAvailable() && !pwa.updateDismissed()) {
      <aside class="update-banner" role="status" aria-live="polite">
        <div class="update-banner-text">
          <app-icon name="system_update" [size]="20" />
          <div>
            <strong>{{ t.updateTitle }}</strong>
            <p>{{ t.updateBody }}</p>
          </div>
        </div>
        <div class="update-banner-actions">
          <button
            class="btn small"
            type="button"
            [disabled]="pwa.updating()"
            (click)="pwa.reload()"
          >
            {{ pwa.updating() ? t.updating : t.reload }}
          </button>
          <button
            class="btn ghost small"
            type="button"
            [disabled]="pwa.updating()"
            (click)="pwa.dismissUpdate()"
          >
            {{ t.later }}
          </button>
        </div>
      </aside>
    }
    <router-outlet />
    @if (!(pwa.updateAvailable() && !pwa.updateDismissed()) && !pwa.dismissed() && (pwa.installAvailable() || pwa.ios)) {
      <aside class="install-prompt">
        <strong>{{ t.install }}</strong>
        @if (pwa.ios) {
          <p>{{ t.ios }}</p>
        } @else {
          <button class="btn accent" (click)="pwa.install()">
            {{ t.install }}
          </button>
        }
        <button class="btn ghost" (click)="pwa.dismiss()">{{ t.later }}</button>
      </aside>
    }`,
})
export class AppComponent {
  t = FR;
  pwa = inject(PwaService);
}
