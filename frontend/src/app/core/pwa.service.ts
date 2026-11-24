import { Injectable, inject, signal } from "@angular/core";
import { SwUpdate } from "@angular/service-worker";
import { FR } from "./fr";

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

@Injectable({ providedIn: "root" })
export class PwaService {
  private updates = inject(SwUpdate);
  private lastCheckAt = 0;
  private failedRetryCount = 0;
  readonly swEnabled = this.updates.isEnabled;
  readonly updateAvailable = signal(false);
  readonly updateDismissed = signal(false);
  readonly updating = signal(false);
  readonly checking = signal(false);
  readonly updateStatus = signal("");
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
          this.failedRetryCount = 0;
          this.updateAvailable.set(true);
          this.updateDismissed.set(false);
          this.updateStatus.set(FR.update);
        } else if (e.type === "VERSION_INSTALLATION_FAILED" && this.failedRetryCount < 2) {
          this.failedRetryCount++;
          setTimeout(() => void this.checkForUpdate(true), 5000);
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
      setTimeout(() => void this.checkForUpdate(true), 3000);
      setInterval(() => void this.checkForUpdate(), 10 * 60_000);
    }
  }

  async checkForUpdate(force = false, manual = false): Promise<boolean> {
    if (!this.updates.isEnabled) {
      if (manual) this.updateStatus.set(FR.appUpToDate);
      return false;
    }
    if (manual && !navigator.onLine) {
      this.updateStatus.set(FR.updateCheckOffline);
      return false;
    }
    const now = Date.now();
    if (!force && !manual && now - this.lastCheckAt < 30_000) return false;
    this.lastCheckAt = now;
    if (manual) {
      this.checking.set(true);
      this.updateStatus.set("");
      this.updateDismissed.set(false);
    }
    try {
      const found = await this.updates.checkForUpdate();
      if (manual) {
        this.updateStatus.set(found || this.updateAvailable() ? FR.update : FR.appUpToDate);
      }
      return found;
    } catch {
      if (manual) this.updateStatus.set(FR.updateCheckOffline);
      return false;
    } finally {
      if (manual) this.checking.set(false);
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

  dismissUpdate() {
    this.updateDismissed.set(true);
  }

  async reload() {
    this.updating.set(true);
    try {
      if (this.updates.isEnabled) await this.updates.activateUpdate();
    } catch {
      /* fallback to hard reload */
    }
    location.reload();
  }
}
