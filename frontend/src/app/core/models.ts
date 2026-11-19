export type Role = "admin" | "student";
export interface School {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  colors: { primary: string; accent: string };
  trial_days: number;
  receipt_prefix: string;
  /** Optional consumer-side prefix when supplied by a future school API contract. */
  learner_number_prefix?: string;
  address: string;
  phone: string;
  whatsapp: string;
  agrement_number: string;
  status: string;
}
export interface User {
  id: string;
  name: string;
  email: string;
}
export interface Category {
  id: string;
  code: string;
  name: string;
}
export interface Installment {
  id: string;
  position: number;
  label: string;
  amount: number;
  due_date: string;
  status: "paid" | "partial" | "upcoming" | "overdue";
  paid_amount?: number;
}
export interface Group {
  id: string;
  name: string;
  licence_category_id: string;
  licence_name: string;
  capacity: number;
  total_fee: number;
  status: string;
  schedule_text: string;
  installments: Installment[];
  confirmed_seats: number;
}
export interface Student {
  id: string;
  user_id: string | null;
  full_name: string;
  phone: string;
  student_number: number;
  licence_category_id: string;
  trial_ends_at: string | null;
  has_access: boolean;
  has_paid: boolean;
}
export interface Enrollment {
  id: string;
  group_id: string;
  group_name: string;
  total_fee: number;
  paid: number;
  balance: number;
}

export type PaymentMethod =
  | "cash"
  | "mtn_momo"
  | "orange_money"
  | "bank";

export type ReceiptStatus = "confirmed" | "cancelled" | "provisional";

export type SnapshotProvenance =
  | "recorded_at_issuance"
  | "missing_legacy_snapshot";

export interface ReceiptIssuanceSnapshot {
  snapshotVersion: string;
  snapshotSource: "recorded_at_issuance" | string;
  receiptNumber: string;
  issuedAt: string;
  balanceAtIssuance: number | string;
  school: {
    name: string;
    address: string;
    phone: string;
    whatsapp: string;
    agrementNumber: string;
    receiptPrefix: string;
  };
  student: {
    id: string;
    name: string;
    phone: string;
  };
  enrollment: {
    id: string;
    groupName: string;
    licenceCode: string;
    licenceName: string;
    totalFee: number | string;
  };
}

export interface Payment {
  id: string;
  enrollment_id: string;
  amount: number;
  method: PaymentMethod | (string & {});
  reference: string | null;
  receipt_number: string;
  paid_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  student_name?: string;
  phone?: string;
  recorded_by_name?: string;
  enrollment_total_fee?: number | string | null;
  balance_at_issuance?: number | string | null;
  current_balance?: number | string | null;
  receipt_status?: ReceiptStatus;
  is_offline_provisional_number?: boolean;
  issuance_snapshot?: ReceiptIssuanceSnapshot | null;
  snapshot_provenance?: SnapshotProvenance;
  balance_label?: string;
  current_balance_label?: string;
  pending?: boolean;
}
export interface Dossier {
  student: Student;
  enrollment: Enrollment | null;
  installments: Installment[];
  payments: Payment[];
  attempts: Attempt[];
}
export interface Resource {
  id: string;
  title: string;
  description: string;
  type: string;
  download_url: string;
}
export interface Question {
  id: string;
  body: string;
  options: string[];
  image_url: string | null;
}
export interface Quiz {
  content_version: number;
  id: string;
  title: string;
  duration_minutes: number;
  questions: Question[];
}
export interface Attempt {
  id: string;
  quiz_id: string;
  score: number;
  total: number;
  taken_at: string;
}
export interface Catalogue {
  school: School;
  categories: Category[];
  groups: Group[];
}
export interface Dashboard {
  students: number;
  collected: number;
  owed: number;
  overdue: number;
  recentPayments: Payment[];
}
export interface ApiFailure {
  status: number;
  code: string;
  message: string;
}
