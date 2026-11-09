import { Injectable, inject, signal } from "@angular/core";
import { SwUpdate } from "@angular/service-worker";
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
@Injectable({ providedIn: "root" })
export class PwaService {
  private updates = inject(SwUpdate);
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
    if (this.updates.isEnabled)
      this.updates.versionUpdates.subscribe((e) => {
        if (e.type === "VERSION_READY") this.updateAvailable.set(true);
      });
  }
  async install() {
    await this.promptEvent?.prompt();
    this.installAvailable.set(false);
  }
  dismiss() {
    sessionStorage.setItem("install-dismissed", "true");
    this.dismissed.set(true);
  }
  reload() {
    location.reload();
  }
}
