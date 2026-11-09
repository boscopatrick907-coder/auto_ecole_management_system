import { Injectable } from "@angular/core";
@Injectable({ providedIn: "root" })
export class WhatsAppService {
  link(phone: string, message: string): string {
    return (
      "https://wa.me/" +
      phone.replace(/\D/g, "") +
      "?text=" +
      encodeURIComponent(message)
    );
  }
  open(phone: string, message: string) {
    window.open(this.link(phone, message), "_blank", "noopener,noreferrer");
  }
}
