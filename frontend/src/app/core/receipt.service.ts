import { Injectable, inject, signal } from "@angular/core";
import { jsPDF } from "jspdf";
import { AuthService } from "./auth.service";
import { FR } from "./fr";
import { formatMoney } from "../shared/money.pipe";
import { learnerNumberLabel } from "./learner-number";
import type {
  Dossier,
  Payment,
  ReceiptIssuanceSnapshot,
  ReceiptStatus,
  School,
} from "./models";

export type ReceiptGenerationStatus =
  | "idle"
  | "generating"
  | "success"
  | "error";

interface ReceiptBlock {
  text: string;
  size?: number;
  color?: string;
  bold?: boolean;
  gapAfter?: number;
}

interface ReceiptLine {
  text: string;
  size: number;
  color: string;
  bold: boolean;
  height: number;
  gapAfter: number;
}

export function receiptStatus(payment: Payment): ReceiptStatus {
  if (payment.cancelled_at || payment.receipt_status === "cancelled") {
    return "cancelled";
  }
  if (payment.pending || payment.receipt_status === "provisional") {
    return "provisional";
  }
  return "confirmed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(
  record: Record<string, unknown>,
  key: string,
  requireContent = false,
): boolean {
  const value = record[key];
  return (
    typeof value === "string" &&
    (!requireContent || value.trim().length > 0)
  );
}

function isFiniteAmount(value: unknown): boolean {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" &&
      value.trim().length > 0 &&
      Number.isFinite(Number(value)))
  );
}

function isIssuanceSnapshotShape(value: unknown): value is ReceiptIssuanceSnapshot {
  if (!isRecord(value)) return false;
  const school = value["school"];
  const student = value["student"];
  const enrollment = value["enrollment"];

  if (!isRecord(school) || !isRecord(student) || !isRecord(enrollment)) {
    return false;
  }

  return (
    hasString(value, "snapshotVersion", true) &&
    value["snapshotSource"] === "recorded_at_issuance" &&
    hasString(value, "receiptNumber", true) &&
    hasString(value, "issuedAt", true) &&
    !Number.isNaN(Date.parse(value["issuedAt"] as string)) &&
    isFiniteAmount(value["balanceAtIssuance"]) &&
    hasString(school, "name", true) &&
    hasString(school, "address") &&
    hasString(school, "phone") &&
    hasString(school, "whatsapp") &&
    hasString(school, "agrementNumber") &&
    hasString(school, "receiptPrefix", true) &&
    hasString(student, "id", true) &&
    hasString(student, "name", true) &&
    hasString(student, "phone") &&
    hasString(enrollment, "id", true) &&
    hasString(enrollment, "groupName", true) &&
    hasString(enrollment, "licenceCode") &&
    hasString(enrollment, "licenceName") &&
    isFiniteAmount(enrollment["totalFee"])
  );
}

@Injectable({ providedIn: "root" })
export class ReceiptService {
  private auth = inject(AuthService);
  readonly generationStatus = signal<ReceiptGenerationStatus>("idle");
  readonly t = FR;
  private generationPaymentId = signal<string | null>(null);
  private generationVersion = 0;

  resetGenerationStatus(): void {
    this.generationVersion += 1;
    this.generationPaymentId.set(null);
    this.generationStatus.set("idle");
  }

  generationStatusFor(payment: Payment): ReceiptGenerationStatus {
    return this.generationPaymentId() === payment.id
      ? this.generationStatus()
      : "idle";
  }

  statusLabel(payment: Payment): string {
    switch (receiptStatus(payment)) {
      case "cancelled":
        return this.t.receiptCancelled;
      case "provisional":
        return this.t.receiptProvisional;
      default:
        return this.t.receiptConfirmed;
    }
  }

  methodLabel(method: string): string {
    switch (method) {
      case "cash":
        return this.t.cash;
      case "mtn_momo":
        return this.t.momo;
      case "orange_money":
        return this.t.orange;
      case "bank":
        return this.t.bank;
      default:
        return this.t.methodUnknown;
    }
  }

  async generate(
    payment: Payment,
    dossier: Dossier,
    ticket = false,
  ): Promise<boolean> {
    if (this.generationStatus() === "generating") return false;

    const generationVersion = ++this.generationVersion;
    this.generationPaymentId.set(payment.id);
    this.generationStatus.set("generating");
    await this.yieldForPaint();
    if (generationVersion !== this.generationVersion) return false;

    try {
      const document = this.createDocument(payment, dossier, ticket);
      this.saveDocument(
        document,
        payment.receipt_number + (ticket ? "-ticket" : "") + ".pdf",
      );
      if (generationVersion === this.generationVersion) {
        this.generationStatus.set("success");
      }
      return true;
    } catch {
      if (generationVersion === this.generationVersion) {
        this.generationStatus.set("error");
      }
      return false;
    }
  }

  private async yieldForPaint() {
    if (typeof requestAnimationFrame === "function") {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  private saveDocument(document: jsPDF, filename: string) {
    document.save(filename);
  }

  private createDocument(
    payment: Payment,
    dossier: Dossier,
    ticket: boolean,
  ) {
    const currentSchool = this.auth.school();
    const snapshot = this.issuanceSnapshot(payment, dossier);
    if (!snapshot?.school && !currentSchool) {
      throw new Error("SCHOOL_METADATA_UNAVAILABLE");
    }

    const width = ticket ? 80 : 210;
    const x = ticket ? 6 : 20;
    const maxWidth = width - 2 * x;
    const top = ticket ? 12 : 16;
    const bottom = ticket ? 12 : 16;
    const primary = currentSchool?.colors?.primary || "#181c20";
    const blocks = this.receiptBlocks(
      payment,
      dossier,
      snapshot,
      currentSchool,
      currentSchool?.slug || this.auth.api.slug,
      currentSchool?.learner_number_prefix,
      primary,
    );
    const lines = this.wrapBlocks(blocks, maxWidth);
    const contentHeight = lines.reduce(
      (height, line) => height + line.height + line.gapAfter,
      0,
    );
    const pageHeight = ticket
      ? Math.max(210, top + contentHeight + bottom)
      : 297;
    const document = new jsPDF({
      unit: "mm",
      format: ticket ? [80, pageHeight] : "a4",
    });
    let y = top;
    const pageBottom = pageHeight - bottom;

    for (const line of lines) {
      if (!ticket && y + line.height > pageBottom) {
        document.addPage("a4");
        y = top;
      }

      document.setFont("helvetica", line.bold ? "bold" : "normal");
      document.setFontSize(line.size);
      document.setTextColor(line.color);
      document.text(line.text, x, y);
      y += line.height + line.gapAfter;
    }

    return document;
  }

  private issuanceSnapshot(
    payment: Payment,
    dossier: Dossier,
  ): ReceiptIssuanceSnapshot | null {
    const snapshot: unknown = payment.issuance_snapshot;
    if (
      payment.snapshot_provenance !== "recorded_at_issuance" ||
      !isIssuanceSnapshotShape(snapshot) ||
      snapshot.receiptNumber !== payment.receipt_number ||
      snapshot.student.id !== dossier.student.id ||
      snapshot.enrollment.id !== payment.enrollment_id
    ) {
      return null;
    }
    return snapshot;
  }

  private receiptBlocks(
    payment: Payment,
    dossier: Dossier,
    snapshot: ReceiptIssuanceSnapshot | null,
    currentSchool: School | null,
    schoolSlug: string,
    learnerPrefix: string | undefined,
    primary: string,
  ): ReceiptBlock[] {
    const status = receiptStatus(payment);
    const historicalSchool = snapshot?.school;
    const historicalStudent = snapshot?.student;
    const historicalEnrollment = snapshot?.enrollment;
    const currentEnrollment = dossier.enrollment;
    const schoolName = snapshot
      ? historicalSchool!.name
      : (currentSchool?.name ?? "");
    const schoolAddress = snapshot
      ? historicalSchool!.address
      : (currentSchool?.address ?? "");
    const schoolPhone = snapshot
      ? historicalSchool!.phone
      : (currentSchool?.phone ?? "");
    const agreementNumber = snapshot
      ? historicalSchool!.agrementNumber
      : (currentSchool?.agrement_number ?? "");
    const currentBalance =
      payment.current_balance ?? currentEnrollment?.balance;
    const currentTotal =
      currentEnrollment?.total_fee ?? payment.enrollment_total_fee;
    const issuanceBalance = snapshot?.balanceAtIssuance ?? null;
    const currentStudentPhone = snapshot
      ? historicalStudent!.phone
      : dossier.student.phone;
    const studentName = snapshot
      ? historicalStudent!.name
      : dossier.student.full_name;
    const groupName = snapshot
      ? historicalEnrollment!.groupName
      : (currentEnrollment?.group_name ?? "");
    const paymentDate = snapshot ? snapshot.issuedAt : payment.paid_at;
    const blocks: ReceiptBlock[] = [];

    if (!snapshot) {
      blocks.push({
        text: this.t.receiptLegacyNotice,
        size: 9,
        gapAfter: 3,
      });
    }

    blocks.push(
      { text: schoolName, size: 18, color: primary, bold: true, gapAfter: 1 },
      { text: schoolAddress, gapAfter: 0 },
      { text: schoolPhone, gapAfter: 0 },
      {
        text: `${this.t.receiptAgreement} : ${agreementNumber}`,
        gapAfter: 6,
      },
      { text: this.t.receiptTitle, size: 16, bold: true, gapAfter: 2 },
      { text: payment.receipt_number, size: 14, bold: true, gapAfter: 3 },
      {
        text: this.statusLabel(payment),
        size: 12,
        bold: true,
        color: this.statusColor(status),
        gapAfter: 4,
      },
      {
        text: `${this.t.date} : ${this.formatDate(paymentDate)}`,
        gapAfter: 1,
      },
      {
        text: `${this.t.name} : ${studentName}`,
        gapAfter: 1,
      },
      {
        text: learnerNumberLabel(
          schoolSlug,
          dossier.student.student_number,
          learnerPrefix,
        ),
        gapAfter: 1,
      },
      { text: `${this.t.phone} : ${currentStudentPhone}`, gapAfter: 1 },
      {
        text: `${this.t.group} : ${groupName}`,
        gapAfter: 3,
      },
      {
        text: `${status === "provisional" ? this.t.receiptPendingAmount : this.t.amount} : ${formatMoney(payment.amount)}`,
        size: 14,
        bold: true,
        gapAfter: 2,
      },
      {
        text: `${this.t.method} : ${this.methodLabel(payment.method)}`,
        gapAfter: 1,
      },
    );

    if (payment.reference) {
      blocks.push({
        text: `${this.t.reference} : ${payment.reference}`,
        gapAfter: 1,
      });
    }

    if (historicalEnrollment) {
      blocks.push({
        text: `${this.t.receiptTotalAtIssuance} : ${formatMoney(
          historicalEnrollment.totalFee,
        )}`,
        gapAfter: 1,
      });
    } else if (currentTotal !== null && currentTotal !== undefined) {
      blocks.push({
        text: `${this.t.receiptCurrentTotal} : ${formatMoney(currentTotal)}`,
        gapAfter: 1,
      });
    }

    if (status !== "provisional") {
      blocks.push({
        text:
          issuanceBalance === null || issuanceBalance === undefined
            ? this.t.receiptHistoricalBalanceUnavailable
            : `${payment.balance_label || this.t.receiptBalanceAtIssuance} : ${formatMoney(
                issuanceBalance,
              )}`,
        gapAfter: 1,
      });
    }

    if (currentBalance !== null && currentBalance !== undefined) {
      blocks.push({
        text: `${payment.current_balance_label || this.t.receiptCurrentBalance} : ${formatMoney(
          currentBalance,
        )}`,
        gapAfter: 5,
      });
    }

    if (status === "cancelled" && payment.cancel_reason) {
      blocks.push({
        text: `${this.t.receiptCancelled} : ${payment.cancel_reason}`,
        color: this.statusColor("cancelled"),
        gapAfter: 5,
      });
    }

    if (payment.is_offline_provisional_number && status !== "provisional") {
      blocks.push({ text: this.t.receiptOfflineNumber, size: 9, gapAfter: 3 });
    }

    blocks.push(
      { text: this.t.signature, gapAfter: 8 },
      { text: this.t.receiptNotice, size: 9 },
    );

    return blocks;
  }

  private wrapBlocks(blocks: ReceiptBlock[], maxWidth: number): ReceiptLine[] {
    const measurer = new jsPDF({ unit: "mm", format: "a4" });
    const wrapped: ReceiptLine[] = [];

    for (const block of blocks) {
      measurer.setFont("helvetica", block.bold ? "bold" : "normal");
      measurer.setFontSize(block.size ?? 11);
      const lines = measurer.splitTextToSize(
        String(block.text ?? "").replace(/\u202f/g, "\u00a0"),
        maxWidth,
      );
      const lineValues = Array.isArray(lines) ? lines : [lines];

      lineValues.forEach((text, index) => {
        const size = block.size ?? 11;
        wrapped.push({
          text,
          size,
          color: block.color ?? "#181c20",
          bold: block.bold ?? false,
          height: size * 0.45 + 2,
          gapAfter: index === lineValues.length - 1 ? block.gapAfter ?? 2 : 0,
        });
      });
    }

    return wrapped;
  }

  private statusColor(status: ReceiptStatus) {
    if (status === "cancelled") return "#9b1c1c";
    if (status === "provisional") return "#92400e";
    return "#166534";
  }

  private formatDate(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("fr-FR", { timeZone: "Africa/Douala" });
  }
}
