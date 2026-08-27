// issue-theme-event-rewards: 手動觸發，把「主題活動新增達標獎勵」寫入 Google 試算表（Logs 分頁）
//
// 判斷邏輯：
//   1. 從 borrow_logs（action='borrow'，用 student_account 欄位）撈出該學生在活動期間內的借閱紀錄
//      （不查 books.borrowed_by，因為書一旦被歸還該欄位會被清空，歷史會遺失）
//   2. 用 books.title 比對活動關鍵字，得到符合條件的不重複本數 uniqueCount
//   3. 該學生累積達成次數 = floor(uniqueCount / target_count)
//   4. 本次新增次數 = 累積達成次數 - 已發放次數（theme_event_rewards.times_issued，無記錄則視為 0）
//   5. 新增點數 = 新增次數 × reward_points，Reason 欄位用活動名稱
//
// 防止重複發放：
//   寫入 Google Sheets 成功後，才把 theme_event_rewards.times_issued 更新成最新累積次數，
//   下次重新查詢時，delta 會自動變成 0（或只計算再更之後新增的部分）。
//
// 需要的 Secrets：
//   SUPABASE_URL / SERVICE_ROLE_KEY
//   GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEETS_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken, appendToSheet, formatSheetTime } from "../_shared/googleSheets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!;
const GOOGLE_SHEETS_ID = Deno.env.get("GOOGLE_SHEETS_ID")!;

const SHEET_NAME = "Logs";
const TEACHER = "圖書館";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function matchesKeywords(title: string, keywords: string | null): boolean {
  if (!keywords || keywords.trim() === "" || keywords.trim() === "*") return true;
  const list = keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  const t = (title ?? "").toLowerCase();
  return list.some((k) => t.includes(k));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || !token.startsWith("local-rpc:")) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { event_id } = body;
    if (!event_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "缺少 event_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: event, error: eventErr } = await SUPABASE
      .from("theme_events")
      .select("*")
      .eq("id", event_id)
      .single();
    if (eventErr || !event) throw new Error("找不到這個活動：" + (eventErr?.message ?? event_id));

    // 該活動期間內的所有借閱紀錄
    const { data: logs, error: logErr } = await SUPABASE
      .from("borrow_logs")
      .select("barcode, student_account")
      .eq("action", "borrow")
      .not("student_account", "is", null)
      .gte("at", `${event.start_date}T00:00:00`)
      .lte("at", `${event.end_date}T23:59:59.999`);
    if (logErr) throw new Error("讀取借閱紀錄失敗：" + logErr.message);

    if (!logs || logs.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, issued: 0, message: "活動期間內尚無借閱紀錄" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 補書名，篩選符合關鍵字的書
    const barcodes = [...new Set(logs.map((l: any) => l.barcode as string))];
    const { data: books, error: bookErr } = await SUPABASE
      .from("books")
      .select("barcode, title")
      .in("barcode", barcodes);
    if (bookErr) throw new Error("讀取書籍資料失敗：" + bookErr.message);

    const titleMap: Record<string, string> = {};
    (books ?? []).forEach((b: any) => { titleMap[b.barcode] = b.title; });

    // 依學生分組，算不重複符合關鍵字的本數
    const uniqueByAccount: Record<string, Set<string>> = {};
    for (const log of logs as any[]) {
      const acc = log.student_account as string;
      const title = titleMap[log.barcode] ?? "";
      if (!matchesKeywords(title, event.keywords)) continue;
      if (!uniqueByAccount[acc]) uniqueByAccount[acc] = new Set();
      uniqueByAccount[acc].add(log.barcode);
    }

    const accounts = Object.keys(uniqueByAccount);
    if (accounts.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, issued: 0, message: "活動期間內沒有符合關鍵字的借閱紀錄" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 已發放次數
    const { data: existingRewards, error: rewardErr } = await SUPABASE
      .from("theme_event_rewards")
      .select("account, times_issued")
      .eq("event_id", event_id)
      .in("account", accounts);
    if (rewardErr) throw new Error("讀取已發放紀錄失敗：" + rewardErr.message);

    const issuedMap: Record<string, number> = {};
    (existingRewards ?? []).forEach((r: any) => { issuedMap[r.account] = r.times_issued; });

    const targetCount = event.target_count as number;
    const rewardPoints = event.reward_points as number;

    const pending = accounts.map((acc) => {
      const uniqueCount = uniqueByAccount[acc].size;
      const totalTimes = Math.floor(uniqueCount / targetCount);
      const already = issuedMap[acc] ?? 0;
      const deltaTimes = Math.max(0, totalTimes - already);
      return { account: acc, totalTimes, already, deltaTimes, points: deltaTimes * rewardPoints };
    }).filter((p) => p.deltaTimes > 0);

    if (pending.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, issued: 0, message: "目前沒有新增待發放的活動獎勵（可能已經發放過）" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 補姓名
    const { data: users } = await SUPABASE
      .from("app_users")
      .select("account, name")
      .in("account", pending.map((p) => p.account));
    const nameMap: Record<string, string> = {};
    (users ?? []).forEach((u: any) => { nameMap[u.account] = u.name; });

    const now = new Date();
    const timeStr = formatSheetTime(now);
    const reason = event.event_name as string;

    const sheetRows: (string | number)[][] = pending.map((p) => [
      timeStr,
      p.account,
      p.points,
      reason,
      TEACHER,
    ]);

    const accessToken = await getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_JSON);
    await appendToSheet(accessToken, GOOGLE_SHEETS_ID, SHEET_NAME, sheetRows);

    // 寫入成功才更新已發放次數（累積次數，不是累加，因為 totalTimes 本身就是活動至今累積達成次數）
    const upsertRows = pending.map((p) => ({
      event_id,
      account: p.account,
      times_issued: p.totalTimes,
      points_issued: p.already * rewardPoints + p.points,
      updated_at: now.toISOString(),
    }));

    const { error: markErr } = await SUPABASE
      .from("theme_event_rewards")
      .upsert(upsertRows, { onConflict: "event_id,account" });

    if (markErr) {
      throw new Error(
        "已寫入 Google 試算表，但更新已發放次數失敗，請人工確認 theme_event_rewards：" + markErr.message
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        issued: pending.length,
        event_name: reason,
        details: pending.map((p) => ({
          account: p.account,
          name: nameMap[p.account] ?? p.account,
          new_times: p.deltaTimes,
          points: p.points,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("issue-theme-event-rewards error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
