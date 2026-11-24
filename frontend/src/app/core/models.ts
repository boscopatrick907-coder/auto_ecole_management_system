export type Role = "admin" | "student";
export interface School {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  colors: { primary: string; accent: string };
  trial_days: number;
  receipt_prefix: string;
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
export interface Payment {
  id: string;
  enrollment_id: string;
  amount: number;
  method: string;
  reference: string | null;
  receipt_number: string;
  paid_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  student_name?: string;
  phone?: string;
  recorded_by_name?: string;
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
export interface AppConfig {
  turnstileSiteKey: string;
  vapidPublicKey?: string;
}
export interface AdminAnnouncement {
  id: string;
  group_id: string | null;
  group_name?: string | null;
  title: string;
  body: string;
  created_at: string;
  read_count?: number;
  target_count?: number;
}
export interface StudentAnnouncement {
  id: string;
  group_id: string | null;
  group_name?: string | null;
  title: string;
  body: string;
  created_at: string;
  read_at?: string | null;
  is_read?: boolean;
}
export type ReminderMilestone = 7 | 3 | 1 | 0 | -1;
export interface PaymentReminder {
  installmentId: string;
  label: string;
  amount: number;
  dueDate: string;
  daysRemaining: number;
  /** 7/3/1 = J-7/J-3/J-1, 0 = today, -1 = overdue, null = not an exact milestone */
  milestone: ReminderMilestone | null;
  urgent: boolean;
}
export interface ApiFailure {
  status: number;
  code: string;
  message: string;
}
