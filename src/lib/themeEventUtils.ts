import { supabase } from "./supabase";
import type { ThemeEvent } from "./types";

/**
 * 查詢指定日期範圍內的有效活動
 */
export async function getActiveThemeEvents(date: Date = new Date()): Promise<ThemeEvent[]> {
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
  const { data, error } = await supabase
    .from("theme_events")
    .select("*")
    .lte("start_date", dateStr)
    .gte("end_date", dateStr);

  if (error) {
    console.error("Error fetching active theme events:", error);
    return [];
  }

  return (data as any) ?? [];
}

/**
 * 檢查書名是否符合活動的關鍵字
 * 若關鍵字為空或 "*"，代表不限書目，返回 true
 */
export function matchesKeywords(bookTitle: string, keywords: string | null): boolean {
  if (!keywords || keywords.trim() === "" || keywords.trim() === "*") {
    return true; // 不限書目
  }

  const keywordList = keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);

  const titleLower = bookTitle.toLowerCase();
  return keywordList.some((keyword) => titleLower.includes(keyword));
}

/**
 * 計算學生在指定活動期間內借閱的不重複書籍數量
 * 依據書籍 ID 或書名進行去重
 */
export async function getUniqueBookCountForEvent(
  studentId: string,
  event: ThemeEvent
): Promise<number> {
  // 假設 borrowings 表包含 student_id, barcode, borrowed_at, book_title
  // 我們需要查詢該學生在活動期間內的借閱紀錄
  const { data, error } = await supabase
    .from("books")
    .select("barcode, title")
    .gte("borrowed_at", event.start_date)
    .lte("borrowed_at", event.end_date)
    .eq("borrowed_by", studentId);

  if (error) {
    console.error("Error fetching borrowing records:", error);
    return 0;
  }

  // 篩選符合關鍵字的書籍
  const matchingBooks = (data as any)?.filter((book: any) =>
    matchesKeywords(book.title, event.keywords)
  ) ?? [];

  // 依據 barcode 去重（每本書只計算一次）
  const uniqueBarcodes = new Set(matchingBooks.map((book: any) => book.barcode));

  return uniqueBarcodes.size;
}

/**
 * 判斷是否達成活動獎勵
 */
export function isRewardAchieved(uniqueCount: number, targetCount: number): boolean {
  return uniqueCount > 0 && uniqueCount % targetCount === 0;
}

/**
 * 計算本次達成的獎勵次數
 * 例如：uniqueCount = 10, targetCount = 3 → 達成 3 次獎勵
 */
export function calculateRewardTimes(uniqueCount: number, targetCount: number): number {
  if (uniqueCount <= 0 || targetCount <= 0) return 0;
  return Math.floor(uniqueCount / targetCount);
}
