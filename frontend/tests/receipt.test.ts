import "@angular/compiler";
import { createEnvironmentInjector, runInInjectionContext, signal } from "@angular/core";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { AuthService } from "../src/app/core/auth.service";
import { learnerNumberLabel } from "../src/app/core/learner-number";
import { ReceiptService } from "../src/app/core/receipt.service";
import type { Dossier, Payment, ReceiptIssuanceSnapshot, School } from "../src/app/core/models";

const school: School = {
  id: "synthetic-school-id",
  name: "Synthetic Current School",
  slug: "la-marseillaise",
  logo: null,
  colors: { primary: "#123456", accent: "#654321" },
  trial_days: 14,
  receipt_prefix: "LM",
  learner_number_prefix: "XX",
  address: "TEST Current Address",
  phone: "+237000000099",
  whatsapp: "+237000000099",
  agrement_number: "TEST-CURRENT-AGREEMENT",
  status: "active",
};

const snapshot: ReceiptIssuanceSnapshot = {
  snapshotVersion: "2026-11-17.v1",
  snapshotSource: "recorded_at_issuance",
  receiptNumber: "LM-2026-000007",
  issuedAt: "2026-11-17T09:00:00.000Z",
  balanceAtIssuance: 250000,
  school: {
    name: "Synthetic At-Issue School",
    address: "TEST Snapshot Avenue, Yaounde",
    phone: "+237000000001",
    whatsapp: "+237000000001",
    agrementNumber: "TEST-ISSUANCE-AGREEMENT",
    receiptPrefix: "LM",
  },
  student: {
    id: "synthetic-student-id",
    name: "Synthetic Learner at Issue",
    phone: "+237000000002",
  },
  enrollment: {
    id: "synthetic-enrollment-id",
    groupName: "TEST GROUP AT ISSUE",
    licenceCode: "B",
    licenceName: "TEST Permis B",
    totalFee: 300000,
  },
};

const dossier: Dossier = {
  student: {
    id: "synthetic-student-id",
    user_id: null,
    full_name: "Synthetic Current Learner",
    phone: "+237000000099",
    student_number: 42,
    licence_category_id: "synthetic-category-id",
    trial_ends_at: null,
    has_access: true,
    has_paid: true,
  },
  enrollment: {
    id: "synthetic-current-enrollment-id",
    group_id: "synthetic-current-group-id",
    group_name: "TEST CURRENT GROUP",
    total_fee: 400000,
    paid: 250000,
    balance: 150000,
  },
  installments: [],
  payments: [],
  attempts: [],
};

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "synthetic-payment-id",
    enrollment_id: "synthetic-enrollment-id",
    amount: 50000,
    method: "mtn_momo",
    reference: "TEST-REFERENCE-001",
    receipt_number: "LM-2026-000007",
    paid_at: snapshot.issuedAt,
    cancelled_at: null,
    cancel_reason: null,
    current_balance: 150000,
    balance_at_issuance: 250000,
    enrollment_total_fee: 300000,
    receipt_status: "confirmed",
    issuance_snapshot: snapshot,
    snapshot_provenance: "recorded_at_issuance",
    ...overrides,
  };
}

function createReceiptService() {
  const auth = { school: signal(school), api: { slug: school.slug } };
  const injector = createEnvironmentInjector(
    [{ provide: AuthService, useValue: auth }],
    null as never,
  );
  return runInInjectionContext(injector, () => new ReceiptService());
}

function pageText(document: jsPDF): string {
  const pages = (document as unknown as { internal: { pages: string[][] } }).internal.pages;
  return pages.slice(1).map((page) => page.join(" ")).join(" ");
}

function coordinates(document: jsPDF): Array<{ x: number; y: number }> {
  const pages = (document as unknown as { internal: { pages: string[][] } }).internal.pages;
  return pages.slice(1).flatMap((page) =>
    page.flatMap((command) =>
      [...command.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Td/g)].map(
        (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
      ),
    ),
  );
}

let saved: Array<{ document: jsPDF; filename: string }>;
let saveSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  saved = [];
  saveSpy = vi
    .spyOn(ReceiptService.prototype as never, "saveDocument" as never)
    .mockImplementation((document: unknown, filename: unknown) => {
      saved.push({ document: document as jsPDF, filename: filename as string });
      return document;
    });
});

afterEach(() => {
  saveSpy?.mockRestore();
  vi.unstubAllGlobals();
});

describe("school learner-number prefixes", () => {
  it("keeps La Marseillaise at LM and supports another school's configured prefix", () => {
    expect(learnerNumberLabel("la-marseillaise", 42, "XX")).toBe("#LM-42");
    expect(learnerNumberLabel("synthetic-school", 43, "TEST")).toBe("#TEST-43");
    expect(learnerNumberLabel("synthetic-school", 43)).toBe("#LM-43");
  });
});

describe("receipt issuance snapshots and status", () => {
  it("reprints immutable issuance data and separates issuance and current balances", async () => {
    const receipt = createReceiptService();
    const confirmed = payment();

    expect(receipt.statusLabel(confirmed)).toBe(receipt.t.receiptConfirmed);
    expect(receipt.methodLabel(confirmed.method)).toBe(receipt.t.momo);
    expect(receipt.methodLabel("cash")).toBe(receipt.t.cash);
    expect(receipt.methodLabel("bank")).toBe(receipt.t.bank);
    expect(await receipt.generate(confirmed, dossier)).toBe(true);
    expect(receipt.generationStatus()).toBe("success");

    const output = pageText(saved[0].document);
    expect(saved[0].filename).toBe("LM-2026-000007.pdf");
    expect(output).toContain("LM-2026-000007");
    expect(output).toContain("Synthetic At-Issue School");
    expect(output).toContain("Synthetic Learner at Issue");
    expect(output).toContain("TEST GROUP AT ISSUE");
    expect(output).toContain("TEST-ISSUANCE-AGREEMENT");
    expect(output).toContain("Solde à l'émission");
    expect(output).toMatch(/250\u00a0000 FCFA/);
    expect(output).toContain("Solde actuel");
    expect(output).toMatch(/150\u00a0000 FCFA/);
    expect(output).toContain("MTN MoMo");
    expect(output).not.toContain("Synthetic Current School");
    expect(output).not.toContain("TEST CURRENT GROUP");
  });

  it("rejects an incomplete snapshot instead of filling gaps with current data", async () => {
    const receipt = createReceiptService();
    const incompleteSnapshot = {
      ...snapshot,
      school: { ...snapshot.school, address: undefined },
    } as unknown as ReceiptIssuanceSnapshot;

    await receipt.generate(
      payment({ issuance_snapshot: incompleteSnapshot }),
      dossier,
    );

    const output = pageText(saved[0].document);
    expect(output).toContain(receipt.t.receiptLegacyNotice);
    expect(output).toContain("Synthetic Current School");
    expect(output).toContain("Synthetic Current Learner");
    expect(output).toContain("TEST CURRENT GROUP");
    expect(output).not.toContain("Synthetic At-Issue School");
    expect(output).not.toContain("TEST GROUP AT ISSUE");
    expect(output).not.toMatch(/250\u00a0000 FCFA/);
  });

  it("rejects a snapshot whose receipt number differs from the existing payment number", async () => {
    const receipt = createReceiptService();
    const mismatchedSnapshot = {
      ...snapshot,
      receiptNumber: "LM-2026-OTHER-TEST",
    };
    const existingPayment = payment({ issuance_snapshot: mismatchedSnapshot });

    await receipt.generate(existingPayment, dossier);

    const output = pageText(saved[0].document);
    expect(saved[0].filename).toBe("LM-2026-000007.pdf");
    expect(output).toContain("LM-2026-000007");
    expect(output).not.toContain("LM-2026-OTHER-TEST");
    expect(output).toContain(receipt.t.receiptLegacyNotice);
    expect(output).toContain("Synthetic Current School");
    expect(output).not.toContain("Synthetic At-Issue School");
    expect(output).not.toMatch(/250\u00a0000 FCFA/);
  });

  it("rejects a structurally valid snapshot with untrusted provenance", async () => {
    const receipt = createReceiptService();

    await receipt.generate(
      payment({ snapshot_provenance: "missing_legacy_snapshot" }),
      dossier,
    );

    const output = pageText(saved[0].document);
    expect(output).toContain(receipt.t.receiptLegacyNotice);
    expect(output).toContain("Synthetic Current School");
    expect(output).not.toContain("Synthetic At-Issue School");
    expect(output).not.toMatch(/250\u00a0000 FCFA/);
  });

  it("marks a cancelled receipt and preserves the original issuance balance", async () => {
    const receipt = createReceiptService();
    const cancelled = payment({
      cancelled_at: "2026-11-18T10:00:00.000Z",
      cancel_reason: "TEST cancellation reason",
      receipt_status: "cancelled",
      balance_at_issuance: null,
      current_balance: 200000,
    });

    expect(receipt.statusLabel(cancelled)).toBe(receipt.t.receiptCancelled);
    await receipt.generate(cancelled, dossier);

    const output = pageText(saved[0].document);
    expect(output).toContain("Reçu annulé");
    expect(output).toContain("TEST cancellation reason");
    expect(output).toContain("Solde à l'émission");
    expect(output).toMatch(/250\u00a0000 FCFA/);
  });

  it("labels unsynced payments provisional and does not claim an issuance balance", async () => {
    const receipt = createReceiptService();
    const provisional = payment({
      id: "synthetic-provisional-payment",
      amount: 12500,
      method: "orange_money",
      receipt_number: "RC-TESTDEVICE-15",
      pending: true,
      receipt_status: undefined,
      balance_at_issuance: undefined,
      issuance_snapshot: null,
      snapshot_provenance: undefined,
      current_balance: 137500,
    });

    expect(receipt.statusLabel(provisional)).toBe(receipt.t.receiptProvisional);
    expect(receipt.methodLabel(provisional.method)).toBe(receipt.t.orange);
    await receipt.generate(provisional, dossier);

    const output = pageText(saved[0].document);
    expect(saved[0].filename).toBe("RC-TESTDEVICE-15.pdf");
    expect(output).toContain("RC-TESTDEVICE-15");
    expect(output).toContain("Provisoire");
    expect(output).toContain("Montant en attente");
    expect(output).toContain("Orange Money");
    expect(output).toContain("Solde actuel");
    expect(output).not.toContain("Solde à l'émission");
  });

  it("labels legacy details as current and never invents a historical balance", async () => {
    const receipt = createReceiptService();
    const legacy = payment({
      receipt_number: "LEGACY-TEST-007",
      issuance_snapshot: null,
      snapshot_provenance: "missing_legacy_snapshot",
      balance_at_issuance: null,
      current_balance: 137500,
      enrollment_total_fee: 400000,
    });
    const legacyDossier: Dossier = { ...dossier, enrollment: null };

    await receipt.generate(legacy, legacyDossier);

    const output = pageText(saved[0].document);
    expect(output).toContain("LEGACY-TEST-007");
    expect(output).toContain("Informations actuelles affichées");
    expect(output).toContain("Frais actuels");
    expect(output).toContain("Solde à l'émission indisponible");
    expect(output).not.toContain("Synthetic At-Issue School");
    expect(output).toContain("Synthetic Current School");
  });

  it("reports PDF generation failures and blocks a second generation while busy", async () => {
    const receipt = createReceiptService();
    let finishPaint: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      finishPaint = callback;
      return 1;
    });
    saveSpy?.mockImplementationOnce(() => {
      throw new Error("synthetic PDF save failure");
    });

    const pendingGeneration = receipt.generate(payment(), dossier);
    expect(receipt.generationStatus()).toBe("generating");
    expect(await receipt.generate(payment(), dossier)).toBe(false);
    finishPaint?.(0);
    expect(await pendingGeneration).toBe(false);
    expect(receipt.generationStatus()).toBe("error");
  });

  it("scopes feedback to a receipt and resets it when navigating away", async () => {
    const receipt = createReceiptService();
    const firstReceipt = payment();
    const secondReceipt = payment({
      id: "synthetic-second-payment-id",
      receipt_number: "LM-2026-000008",
    });

    await receipt.generate(firstReceipt, dossier);
    expect(receipt.generationStatusFor(firstReceipt)).toBe("success");
    expect(receipt.generationStatusFor(secondReceipt)).toBe("idle");

    receipt.resetGenerationStatus();
    expect(receipt.generationStatus()).toBe("idle");
    expect(receipt.generationStatusFor(firstReceipt)).toBe("idle");

    saveSpy?.mockImplementationOnce(() => {
      throw new Error("synthetic PDF save failure");
    });
    expect(await receipt.generate(firstReceipt, dossier)).toBe(false);
    expect(receipt.generationStatusFor(firstReceipt)).toBe("error");
    expect(receipt.generationStatusFor(secondReceipt)).toBe("idle");

    receipt.resetGenerationStatus();
    expect(receipt.generationStatusFor(firstReceipt)).toBe("idle");
  });

  it("cancels stale generation feedback when navigation happens before PDF work", async () => {
    const receipt = createReceiptService();
    let finishPaint: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      finishPaint = callback;
      return 1;
    });

    const pendingGeneration = receipt.generate(payment(), dossier);
    receipt.resetGenerationStatus();
    finishPaint?.(0);

    expect(await pendingGeneration).toBe(false);
    expect(saved).toHaveLength(0);
    expect(receipt.generationStatus()).toBe("idle");
  });
});

describe("receipt PDF pagination and ticket dimensions", () => {
  it("wraps long synthetic content across bounded A4 pages and a dynamic 80 mm ticket", async () => {
    const receipt = createReceiptService();
    const longDossier: Dossier = {
      ...dossier,
      student: {
        ...dossier.student,
        full_name: "SYNTHETIC LEARNER WITH A VERY LONG NAME ".repeat(8),
      },
    };
    const longPayment = payment({
      reference: "TEST LONG REFERENCE ".repeat(18),
      issuance_snapshot: {
        ...snapshot,
        school: {
          ...snapshot.school,
          address: "TEST VERY LONG SCHOOL ADDRESS ".repeat(14),
        },
        student: {
          ...snapshot.student,
          name: "SYNTHETIC SNAPSHOT LEARNER ".repeat(10),
        },
        enrollment: {
          ...snapshot.enrollment,
          groupName: "TEST LONG GROUP NAME ".repeat(14),
        },
      },
    });

    expect(await receipt.generate(longPayment, longDossier)).toBe(true);
    expect(await receipt.generate(longPayment, longDossier, true)).toBe(true);

    const [a4, ticket] = saved.map((entry) => entry.document);
    const a4Internals = (a4 as unknown as { internal: { pageSize: { getWidth(): number; getHeight(): number }; pages: string[][] } }).internal;
    const ticketInternals = (ticket as unknown as { internal: { pageSize: { getWidth(): number; getHeight(): number }; pages: string[][] } }).internal;
    const a4PageSize = a4Internals.pageSize;
    const ticketPageSize = ticketInternals.pageSize;

    expect(a4PageSize.getWidth()).toBeCloseTo(210, 0);
    expect(a4PageSize.getHeight()).toBeCloseTo(297, 0);
    expect(a4Internals.pages.length - 1).toBeGreaterThan(1);
    expect(ticketPageSize.getWidth()).toBeCloseTo(80, 0);
    expect(ticketPageSize.getHeight()).toBeGreaterThan(210);
    expect(saved[1].filename).toBe("LM-2026-000007-ticket.pdf");
    expect(pageText(a4)).toContain("TEST LONG REFERENCE");
    expect(pageText(ticket)).toContain("TEST LONG GROUP NAME");

    for (const document of [a4, ticket]) {
      const size = (document as unknown as { internal: { pageSize: { getWidth(): number; getHeight(): number } } }).internal.pageSize;
      const scale = 72 / 25.4;
      const points = coordinates(document);
      expect(points.length).toBeGreaterThan(0);
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(6 * scale - 1);
        expect(point.x).toBeLessThanOrEqual((size.getWidth() - 6) * scale + 1);
        expect(point.y).toBeGreaterThanOrEqual(6 * scale - 1);
        expect(point.y).toBeLessThanOrEqual((size.getHeight() - 6) * scale + 1);
      }
    }
  });
});
