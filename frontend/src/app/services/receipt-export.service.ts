import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

export interface PrintableReceiptData {
  receiptNumber: string;
  paidAt: string;
  studentName: string;
  studentPhone: string;
  licenceName?: string;
  categoryName?: string;
  groupName: string;
  amount?: number;
  amountPaid?: number;
  method: string;
  reference?: string | null;
  totalFee: number;
  totalPaid?: number;
  totalPaidAfter?: number;
  balance?: number;
  balanceRemaining?: number;
  nextDueDate?: string | null;
  recordedBy?: string;
}

@Injectable({ providedIn: 'root' })
export class ReceiptExportService {
  private methodLabels: Record<string, string> = {
    cash: 'Espèces (Guichet)',
    mtn_momo: 'MTN Mobile Money',
    orange_money: 'Orange Money',
    bank: 'Virement / Banque',
    bank_transfer: 'Virement / Banque',
  };

  /**
   * Generates a crisp, official numbered PDF receipt in the AEM Marseille Azure Blue
   * & Coral-Vermilion visual identity. Works 100% offline on mobile and desktop.
   */
  generateReceiptPdf(data: PrintableReceiptData): void {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a5',
    });

    const licenceLabel = data.licenceName || data.categoryName || 'Permis B';
    const amountPaid = Number(data.amount ?? data.amountPaid ?? 0);
    const totalPaid = Number(data.totalPaid ?? data.totalPaidAfter ?? amountPaid);
    const balance = Number(data.balance ?? data.balanceRemaining ?? 0);

    // 1. Header Banner (Marseille Azure Blue #3D8BCD)
    doc.setFillColor(61, 139, 205);
    doc.rect(0, 0, 148, 34, 'F');

    // Coral-Vermilion top accent stripe (#D94E28)
    doc.setFillColor(217, 78, 40);
    doc.rect(0, 0, 148, 3, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('AUTO-ÉCOLE LA MARSEILLAISE (AEM)', 12, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Partenaire IUSJ • Yaoundé / Douala, Cameroun • Tél : +237 699 00 00 01', 12, 21);

    // Official Receipt Number Pill
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(12, 24, 68, 7, 2, 2, 'F');
    doc.setTextColor(43, 108, 168);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`REÇU N° ${data.receiptNumber}`, 15, 29);

    // 2. Date & Status
    const dateStr = new Date(data.paidAt || Date.now()).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Émis le : ${dateStr}`, 12, 43);

    // 3. Student Box
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(244, 247, 251);
    doc.roundedRect(12, 47, 124, 30, 3, 3, 'FD');

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('ÉLÈVE BÉNÉFICIAIRE', 16, 54);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Nom complet : ${data.studentName}`, 16, 61);
    doc.text(`Téléphone : ${data.studentPhone}`, 16, 67);
    doc.text(`Formation : ${licenceLabel} — ${data.groupName}`, 16, 73);

    // 4. Payment Details Box
    doc.setFillColor(235, 244, 252);
    doc.setDrawColor(61, 139, 205);
    doc.roundedRect(12, 83, 124, 36, 3, 3, 'FD');

    doc.setTextColor(43, 108, 168);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('DÉTAIL DU VERSEMENT ENCAISSÉ', 16, 91);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(14);
    doc.text(`Montant reçu : ${this.formatFcfa(amountPaid)} FCFA`, 16, 100);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const methodLabel = this.methodLabels[data.method] || data.method;
    doc.text(`Mode de règlement : ${methodLabel}`, 16, 107);
    if (data.reference) {
      doc.text(`Référence transaction : ${data.reference}`, 16, 113);
    }

    // 5. Financial Balance Summary
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(12, 125, 124, 34, 3, 3, 'FD');

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('SITUATION DU COMPTE ÉLÈVE', 16, 133);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`Frais totaux de formation : ${this.formatFcfa(data.totalFee)} FCFA`, 16, 140);
    doc.text(`Total cumulé payé : ${this.formatFcfa(totalPaid)} FCFA`, 16, 146);

    doc.setFont('helvetica', 'bold');
    if (balance > 0) {
      doc.setTextColor(217, 78, 40);
      doc.text(`Reste à payer (Solde) : ${this.formatFcfa(balance)} FCFA`, 16, 153);
    } else {
      doc.setTextColor(16, 185, 129);
      doc.text('Reste à payer : 0 FCFA (FORMATION SOLDÉE ✓)', 16, 153);
    }

    // 6. Official Stamp & Footer
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.text(
      'Ce reçu officiel débloque définitivement votre accès aux cours et examens blancs AEM.',
      12,
      172
    );
    doc.text('Cachet et Signature Direction AEM :', 82, 182);
    doc.setDrawColor(61, 139, 205);
    doc.roundedRect(82, 185, 54, 16, 2, 2, 'D');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(61, 139, 205);
    doc.text('AEM ★ VALIDÉ', 96, 195);

    doc.save(`Recu-${data.receiptNumber}.pdf`);
  }

  /**
   * Exports the filtered Student Roster & Accounting summary to Excel (.xlsx)
   */
  exportStudentsToExcel(students: any[]): void {
    const rows = students.map((s) => ({
      'Nom complet': s.full_name,
      Téléphone: s.phone,
      Permis: s.category_code || s.licence_code || 'B',
      Groupe: s.group_name || '-',
      'Frais totaux (FCFA)': Number(s.total_fee || 0),
      'Montant payé (FCFA)': Number(s.total_paid ?? s.paid ?? 0),
      'Reste à payer (FCFA)': Number(s.balance_due ?? s.balance ?? 0),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Eleves_La_Marseillaise');
    XLSX.writeFile(
      workbook,
      `Eleves-Auto-Ecole-La-Marseillaise-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }

  /**
   * Exports the filtered Student Roster to a clean A4 Printable PDF
   */
  exportStudentsToPdf(students: any[]): void {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFillColor(61, 139, 205);
    doc.rect(0, 0, 297, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(
      `Auto-école La Marseillaise (AEM) — Liste des Élèves (${students.length})`,
      14,
      14
    );

    let y = 32;
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.text('Nom complet', 14, y);
    doc.text('Téléphone', 78, y);
    doc.text('Permis / Groupe', 118, y);
    doc.text('Payé (FCFA)', 215, y);
    doc.text('Reste (FCFA)', 255, y);
    doc.line(14, y + 2, 283, y + 2);

    y += 8;
    doc.setFont('helvetica', 'normal');
    for (const s of students.slice(0, 25)) {
      doc.text(String(s.full_name || '').slice(0, 32), 14, y);
      doc.text(String(s.phone || ''), 78, y);
      doc.text(`${s.category_code || s.licence_code || 'B'} • ${String(s.group_name || '').slice(0, 24)}`, 118, y);
      doc.text(this.formatFcfa(Number(s.total_paid ?? s.paid ?? 0)), 215, y);
      doc.text(this.formatFcfa(Number(s.balance_due ?? s.balance ?? 0)), 255, y);
      y += 7;
      if (y > 195) {
        doc.addPage();
        y = 20;
      }
    }

    doc.save(`Liste-Eleves-AEM-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  private formatFcfa(n: number): string {
    return Math.round(n || 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
}
