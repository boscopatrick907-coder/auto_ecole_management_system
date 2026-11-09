import { Component, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { FR } from "./core/fr";
import { PwaService } from "./core/pwa.service";
@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet],
  template: `<a class="skip-link" href="#main">{{ t.next }}</a
    ><router-outlet />
    @if (pwa.updateAvailable()) {
      <aside class="install-prompt" role="status">
        <p>{{ t.update }}</p>
        <button class="btn" (click)="pwa.reload()">{{ t.reload }}</button>
      </aside>
    }
    @if (!pwa.dismissed() && (pwa.installAvailable() || pwa.ios)) {
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
