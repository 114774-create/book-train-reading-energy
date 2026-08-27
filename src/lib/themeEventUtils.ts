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
 * 依據書籍 barcode 進行去重
 *
 * 注意：改查 borrow_logs（永久記錄，action='borrow'），
 * 不查 books.borrowed_by ——因為書一旦被歸還，books.borrowed_by 會被清空，
 * 用 books 查會漏算所有已經歸還的書。
 */
export async function getUniqueBookCountForEvent(
  studentId: string,
  event: ThemeEvent
): Promise<number> {
  // 該學生在活動期間內的借閱紀錄（不受之後是否歸還影響）
  const { data: logs, error: logErr } = await supabase
    .from("borrow_logs")
    .select("barcode")
    .eq("student_account", studentId)
    .eq("action", "borrow")
    .gte("at", `${event.start_date}T00:00:00`)
    .lte("at", `${event.end_date}T23:59:59.999`);
  if (logErr) {
    console.error("Error fetching borrow logs:", logErr);
    return 0;
  }
  const barcodes = [...new Set((logs as any)?.map((l: any) => l.barcode as string) ?? [])];
  if (barcodes.length === 0) return 0;

  // 補書名以便篩選關鍵字
  const { data: books, error: bookErr } = await supabase
    .from("books")
    .select("barcode, title")
    .in("barcode", barcodes);
  if (bookErr) {
    console.error("Error fetching book titles:", bookErr);
    return 0;
  }

  const matchingBarcodes = (books as any)?.filter((book: any) =>
    matchesKeywords(book.title, event.keywords)
  ).map((b: any) => b.barcode as string) ?? [];

  return new Set(matchingBarcodes).size;
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
