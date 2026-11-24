import { Injectable, inject, signal } from "@angular/core";
import { SwUpdate } from "@angular/service-worker";
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
@Injectable({ providedIn: "root" })
export class PwaService {
  private updates = inject(SwUpdate);
  private readonly bootedAt = Date.now();
  private lastCheckAt = 0;
  readonly updateAvailable = signal(false);
  readonly installAvailable = signal(false);
  readonly dismissed = signal(
    sessionStorage.getItem("install-dismissed") === "true",
  );
  private promptEvent: InstallEvent | null = null;
  readonly ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(navigator as Navigator & { standalone?: boolean }).standalone;
  constructor() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      this.promptEvent = e as InstallEvent;
      this.installAvailable.set(true);
    });
    if (this.updates.isEnabled) {
      this.updates.versionUpdates.subscribe((e) => {
        if (e.type === "VERSION_READY") {
          const hash = e.latestVersion.hash;
          const alreadyReloaded = sessionStorage.getItem("pwa-reloaded-hash") === hash;
          if (Date.now() - this.bootedAt < 15_000 && !alreadyReloaded) {
            sessionStorage.setItem("pwa-reloaded-hash", hash);
            void this.reload();
          } else {
            this.updateAvailable.set(true);
          }
        } else if (e.type === "VERSION_INSTALLATION_FAILED") {
          void this.checkForUpdate(true);
        }
      });
      this.updates.unrecoverable.subscribe(() => {
        const prev = Number(sessionStorage.getItem("pwa-unrecoverable-at") || "0");
        if (Date.now() - prev > 30_000) {
          sessionStorage.setItem("pwa-unrecoverable-at", String(Date.now()));
          location.reload();
        }
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void this.checkForUpdate();
      });
      window.addEventListener("online", () => void this.checkForUpdate(true));
      setTimeout(() => void this.checkForUpdate(true), 4000);
    }
  }
  async checkForUpdate(force = false) {
    if (!this.updates.isEnabled) return;
    const now = Date.now();
    if (!force && now - this.lastCheckAt < 30_000) return;
    this.lastCheckAt = now;
    try {
      await this.updates.checkForUpdate();
    } catch {
      /* offline or SW not ready yet */
    }
  }
  async install() {
    await this.promptEvent?.prompt();
    this.installAvailable.set(false);
  }
  dismiss() {
    sessionStorage.setItem("install-dismissed", "true");
    this.dismissed.set(true);
  }
  async reload() {
    if (this.updates.isEnabled) {
      try {
        await this.updates.activateUpdate();
      } catch {
        /* fallback to hard reload */
      }
    }
    location.reload();
  }
}
