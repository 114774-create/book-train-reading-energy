// issue-honor-cards: 手動觸發，把「本月新增榮譽卡」寫入 Google 試算表（Logs 分頁）
//
// 換算規則：500 能量 = 1 張榮譽卡 = 10 點
// 資料來源：app_reading_monthly.cards_earned（由 import-reading-excel 依
//           「該月累積總能量 - 上月累積總能量」的差額計算好，見該檔案）
//
// 防止重複發放：
//   只處理 cards_earned > 0 AND cards_issued = false 的列，
//   成功寫入 Google Sheets 後才把這些列標記 cards_issued = true。
//   因此即使管理員手滑按兩次，第二次也只會看到「0 筆待發放」，不會重複寫入。
//
// 需要的 Secrets（Supabase Dashboard -> Edge Functions -> Secrets）：
//   SUPABASE_URL / SERVICE_ROLE_KEY
//   GOOGLE_SERVICE_ACCOUNT_JSON（服務帳號 JSON，需具備 Sheets API 權限，
//                                且該試算表要有分享給這個服務帳號的 email 編輯權限）
//   GOOGLE_SHEETS_ID（目標試算表 ID）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken, appendToSheet, formatSheetTime } from "../_shared/googleSheets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!;
const GOOGLE_SHEETS_ID = Deno.env.get("GOOGLE_SHEETS_ID")!;

const SHEET_NAME = "Logs";
const POINTS_PER_CARD = 10; // 500 能量 = 1 張榮譽卡 = 10 點
const REASON = "布可星球能量獎勵";
const TEACHER = "圖書館";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
    const { year_month } = body;
    if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
      return new Response(
        JSON.stringify({ ok: false, error: "year_month 格式需為 YYYY-MM" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 只抓「該月有新增榮譽卡、且尚未發放」的列
    const { data: pendingRows, error: pendingErr } = await SUPABASE
      .from("app_reading_monthly")
      .select("account, cards_earned")
      .eq("year_month", year_month)
      .eq("cards_issued", false)
      .gt("cards_earned", 0);

    if (pendingErr) throw new Error("查詢待發放榮譽卡失敗：" + pendingErr.message);

    if (!pendingRows || pendingRows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, issued: 0, message: `${year_month} 目前沒有待發放的榮譽卡（可能已經發放過，或該月沒有人達標）` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawAccounts = pendingRows.map((r: any) => r.account as string);

    // 補學生姓名（Google Sheets 的 Student ID 欄位用學生帳號，跟你給的範例「60107」一致）
    const { data: users } = await SUPABASE
      .from("app_users")
      .select("account, name")
      .in("account", rawAccounts);
    const nameMap: Record<string, string> = {};
    (users ?? []).forEach((u: any) => { nameMap[u.account] = u.name; });

    // 只處理目前仍在學生名單裡的帳號，避免把已離校（畢業/轉學）學生尚未發放的舊記錄
    // 誤發到 Google 試算表——這種情況通常發生在「學生在畢業前某個月賺到榮譽卡，
    // 但在管理員按下發放之前就已經離校」。
    const validPendingRows = pendingRows.filter((r: any) => nameMap[r.account as string]);
    const skippedCount = pendingRows.length - validPendingRows.length;

    if (validPendingRows.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          issued: 0,
          message: `${year_month} 沒有可發放的榮譽卡（${skippedCount} 筆待發放記錄的學生已不在學生名單，已略過）`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accounts = validPendingRows.map((r: any) => r.account as string);

    const now = new Date();
    const timeStr = formatSheetTime(now);

    const sheetRows: (string | number)[][] = validPendingRows.map((r: any) => [
      timeStr,
      r.account,
      (r.cards_earned as number) * POINTS_PER_CARD,
      REASON,
      TEACHER,
    ]);

    // 寫入 Google 試算表
    const accessToken = await getGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_JSON);
    await appendToSheet(accessToken, GOOGLE_SHEETS_ID, SHEET_NAME, sheetRows);

    // 寫入成功才標記已發放，避免「Sheets 寫入失敗但已標記」造成漏發
    const { error: markErr } = await SUPABASE
      .from("app_reading_monthly")
      .update({ cards_issued: true, cards_issued_at: now.toISOString() })
      .eq("year_month", year_month)
      .eq("cards_issued", false)
      .in("account", accounts);

    if (markErr) {
      // Sheets 已經寫入成功，但標記失敗——回報清楚，避免下次重複發放而不自知
      throw new Error(
        "已寫入 Google 試算表，但標記已發放狀態失敗，請人工確認 app_reading_monthly 資料：" + markErr.message
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        issued: validPendingRows.length,
        skipped: skippedCount,
        year_month,
        details: validPendingRows.map((r: any) => ({
          account: r.account,
          name: nameMap[r.account] ?? r.account,
          cards: r.cards_earned,
          points: (r.cards_earned as number) * POINTS_PER_CARD,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("issue-honor-cards error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
