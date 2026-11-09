import { Injectable, inject } from "@angular/core";
import { jsPDF } from "jspdf";
import { AuthService } from "./auth.service";
import { FR } from "./fr";
import { formatMoney } from "../shared/money.pipe";
import type { Payment, Dossier } from "./models";
@Injectable({ providedIn: "root" })
export class ReceiptService {
  private auth = inject(AuthService);
  t = FR;
  async generate(payment: Payment, dossier: Dossier, ticket = false) {
    const s = this.auth.school();
    if (!s) return;
    const doc = new jsPDF({ unit: "mm", format: ticket ? [80, 210] : "a4" });
    const width = ticket ? 80 : 210;
    let y = 15;
    const x = ticket ? 6 : 20;
    const max = width - 2 * x;
    const line = (text: string, size = 11) => {
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text.replace(/\u202f/g, "\u00a0"), max);
      doc.text(lines, x, y);
      y += lines.length * (size * 0.45) + 4;
    };
    doc.setTextColor(s.colors.primary);
    line(s.name, 18);
    doc.setTextColor("#181c20");
    line(s.address);
    line(s.phone);
    line(`${this.t.agreement} : ${s.agrement_number}`);
    y += 3;
    line(this.t.receiptHeader, 16);
    line(payment.receipt_number, 14);
    if (payment.pending) line(this.t.pendingReceipt);
    if (payment.cancelled_at)
      line(`${this.t.cancel} : ${payment.cancel_reason || ""}`);
    line(
      `${this.t.date} : ${new Date(payment.paid_at).toLocaleString("fr-FR", { timeZone: "Africa/Douala" })}`,
    );
    line(`${this.t.name} : ${dossier.student.full_name}`);
    line(`#LM-${dossier.student.student_number}`);
    line(`${this.t.phone} : ${dossier.student.phone}`);
    line(`${this.t.group} : ${dossier.enrollment?.group_name || ""}`);
    line(`${this.t.amount} : ${formatMoney(payment.amount)}`, 14);
    line(`${this.t.method} : ${payment.method}`);
    if (payment.reference) line(`${this.t.reference} : ${payment.reference}`);
    if (dossier.enrollment) {
      line(`${this.t.total} : ${formatMoney(dossier.enrollment.total_fee)}`);
      line(`${this.t.balance} : ${formatMoney(dossier.enrollment.balance)}`);
    }
    y += 6;
    line(this.t.signature);
    y += 10;
    line(this.t.notice, 9);
    doc.save(payment.receipt_number + (ticket ? "-ticket" : "") + ".pdf");
  }
}
