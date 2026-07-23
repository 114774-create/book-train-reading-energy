export type UserRole = "admin" | "teacher" | "student";

export type ClassCode = "101" | "201" | "301" | "401" | "501" | "601";

export interface UserProfile {
  id: string;
  account: string;
  student_no: string | null;
  name: string;
  role: UserRole;
  class_code: ClassCode | null;
}

export interface Book {
  barcode: string;
  title: string;
  author: string | null;
  borrowing_class: ClassCode;
  return_date: string | null;
  status: "available" | "borrowed";
  borrowed_by: string | null;
  borrowed_at: string | null;
}

export interface ReadingTotals {
  student_id: string;
  total_energy: number;
  total_books: number;
  updated_at: string;
}

export interface AppUserRow {
  account: string;
  role: UserRole;
  name: string;
  class_id: ClassCode | null;
  // student 專用：5碼學號（通常等於 account）
  student_no?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ThemeEvent {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  keywords: string | null;
  target_count: number;
  reward_points: number;
  created_at?: string;
}

export interface BorrowingRecord {
  id: string;
  student_id: string;
  barcode: string;
  borrowed_at: string;
  book_title?: string;
}
