import { Injectable } from '@angular/core';
import { ReceiptExportService } from './receipt-export.service';

export interface OfficialReceiptInput {
  receiptNumber: string;
  studentName: string;
  studentPhone: string;
  licenseType: string;
  amountPaid: number;
  totalPaidSoFar: number;
  totalCourseFee: number;
  paymentMethod: string;
  cashierName: string;
  dateFormatted: string;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class ReceiptPdfService {
  constructor(private exportSvc: ReceiptExportService) {}

  generateOfficialReceipt(data: OfficialReceiptInput): void {
    const balance = Math.max(0, data.totalCourseFee - data.totalPaidSoFar);
    this.exportSvc.generateReceiptPdf({
      receiptNumber: data.receiptNumber,
      paidAt: new Date().toISOString(),
      studentName: data.studentName,
      studentPhone: data.studentPhone,
      licenceName: `Permis ${data.licenseType}`,
      groupName: data.notes || 'Session Officielle Yaoundé Centre',
      amountPaid: data.amountPaid,
      method: data.paymentMethod,
      totalFee: data.totalCourseFee,
      totalPaidAfter: data.totalPaidSoFar,
      balanceRemaining: balance,
      recordedBy: data.cashierName
    });
  }

  buildWhatsAppShareUrl(data: OfficialReceiptInput): string {
    const balance = Math.max(0, data.totalCourseFee - data.totalPaidSoFar);
    const cleanPhone = (data.studentPhone || '677000000').replace(/\D/g, '');
    const fullPhone = cleanPhone.startsWith('237') ? cleanPhone : `237${cleanPhone}`;
    const msg =
      `Bonjour ${data.studentName}, voici votre Reçu Officiel Auto-École La Marseillaise N° ${data.receiptNumber}.\n` +
      `• Montant versé : ${data.amountPaid.toLocaleString('fr-FR')} FCFA (${data.paymentMethod})\n` +
      `• Cumul payé : ${data.totalPaidSoFar.toLocaleString('fr-FR')} / ${data.totalCourseFee.toLocaleString('fr-FR')} FCFA\n` +
      `• Reste à payer : ${balance.toLocaleString('fr-FR')} FCFA\n` +
      `Validé par ${data.cashierName} — Direction Yaoundé Centre.`;
    return `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`;
  }
}
