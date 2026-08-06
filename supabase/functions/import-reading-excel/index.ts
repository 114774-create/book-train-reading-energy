// import-reading-excel: 從前端上傳的 Excel 檔案（base64）解析學生閱讀月報並寫入 DB
//
// Excel 格式（工作表名稱：學生閱讀能量統計）：
//   學年度 | 年 | 月 | 學生姓名 | 年級 | 班級 | 座號 | 本月挖掘能量 | 本月挖掘本數 |
//   等級 | 學生挖掘總能量 | 學生挖掘總本數 | 本學期累積能量 | 本學期累積挖掘本數
//
// 比對邏輯：
//   account = 年級(3碼) + 座號(2碼補0) → 例如 年級=201、座號=1 → account=20101
//   對應 app_users.account
//
// 寫入目標：
//   app_reading_monthly → 每人每月一筆 (account, year_month)
//   app_reading_totals  → 每人累積總計 (account)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function safeParseInt(s: any): number | null {
  const trimmed = String(s ?? "").trim();
  const n = parseInt(trimmed, 10);
  return isNaN(n) ? null : n;
}

interface ParsedRow {
  account: string;
  name: string;
  class_id: string;
  monthly_energy: number;
  monthly_books: number;
  total_energy: number;
  total_books: number;
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
    const { file_base64, target_year_month } = body;

    if (!file_base64) {
      return new Response(
        JSON.stringify({ ok: false, error: "缺少 file_base64" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!target_year_month || !/^\d{4}-\d{2}$/.test(target_year_month)) {
      return new Response(
        JSON.stringify({ ok: false, error: "target_year_month 格式需為 YYYY-MM" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 解析 Excel
    const xlsx = await import("https://esm.sh/xlsx@0.18.5");
    const binary = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
    const wb = xlsx.read(binary, { type: "array" });

    const targetSheet = wb.SheetNames.find(
      (n: string) => n.includes("學生閱讀能量統計") || n.includes("能量統計")
    ) ?? wb.SheetNames[0];
    const ws = wb.Sheets[targetSheet];

    if (!ws) {
      return new Response(
        JSON.stringify({ ok: false, error: "找不到工作表" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aoa = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as any[][];
    if (aoa.length < 2) {
      return new Response(
        JSON.stringify({ ok: false, error: "工作表無資料列" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 標題列（去除空白）
    const headerRow = aoa[0].map((h: any) => String(h ?? "").replace(/\s+/g, "").trim());

    const idxYear        = headerRow.findIndex((h: string) => h === "年");
    const idxMonth       = headerRow.findIndex((h: string) => h === "月");
    const idxName        = headerRow.findIndex((h: string) => h.includes("姓名"));
    const idxGrade       = headerRow.findIndex((h: string) => h.includes("年級"));
    const idxSeat        = headerRow.findIndex((h: string) => h.includes("座號"));
    const idxEnergy      = headerRow.findIndex((h: string) => h.includes("本月挖掘能量"));
    const idxBooks       = headerRow.findIndex((h: string) => h.includes("本月挖掘本數"));
    const idxTotalEnergy = headerRow.findIndex((h: string) => h.includes("學生挖掘總能量"));
    const idxTotalBooks  = headerRow.findIndex((h: string) => h.includes("學生挖掘總本數"));

    if (idxGrade < 0 || idxSeat < 0 || idxName < 0) {
      return new Response(
        JSON.stringify({ ok: false, error: `找不到必要欄位（年級/座號/姓名）。標題列：${headerRow.join("、")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 解析每列
    const parsedRows: ParsedRow[] = [];
    const notFoundNames: { name: string; account: string }[] = [];
    const fileYms: string[] = [];

    for (const row of aoa.slice(1)) {
      if (!row || row.every((c: any) => String(c ?? "").trim() === "")) continue;

      const rocYear = idxYear >= 0 ? safeParseInt(row[idxYear]) : null;
      const month   = idxMonth >= 0 ? safeParseInt(row[idxMonth]) : null;
      const grade   = String(row[idxGrade] ?? "").trim();
      const seatRaw = safeParseInt(row[idxSeat]);
      const seat    = seatRaw !== null ? String(seatRaw).padStart(2, "0") : "";
      const name    = String(row[idxName] ?? "").trim();

      if (!grade || !seat || !name) continue;

      const account = grade + seat; // 例如 20101

      const monthlyEnergy = safeParseInt(row[idxEnergy]) ?? 0;
      const monthlyBooks  = safeParseInt(row[idxBooks]) ?? 0;
      // 優先用 Excel 的總計欄，若沒有則先用月份值（之後 upsert 會累加）
      const totalEnergy = idxTotalEnergy >= 0 ? (safeParseInt(row[idxTotalEnergy]) ?? monthlyEnergy) : monthlyEnergy;
      const totalBooks  = idxTotalBooks  >= 0 ? (safeParseInt(row[idxTotalBooks])  ?? monthlyBooks)  : monthlyBooks;

      // 記錄檔案裡的年月（民國年 + 1911）
      if (rocYear !== null && month !== null) {
        fileYms.push(`${rocYear + 1911}-${String(month).padStart(2, "0")}`);
      }

      // 查 app_users 確認學生存在
      const { data: user } = await SUPABASE
        .from("app_users")
        .select("account, name, class_id")
        .eq("account", account)
        .eq("role", "student")
        .maybeSingle();

      if (!user) {
        // 嘗試用姓名比對
        const { data: byName } = await SUPABASE
          .from("app_users")
          .select("account, name, class_id")
          .eq("name", name)
          .eq("role", "student")
          .maybeSingle();

        if (!byName) {
          notFoundNames.push({ name, account });
          continue;
        }
        parsedRows.push({
          account: byName.account,
          name: byName.name,
          class_id: byName.class_id ?? grade,
          monthly_energy: monthlyEnergy,
          monthly_books: monthlyBooks,
          total_energy: totalEnergy,
          total_books: totalBooks,
        });
      } else {
        parsedRows.push({
          account: user.account,
          name: user.name,
          class_id: user.class_id ?? grade,
          monthly_energy: monthlyEnergy,
          monthly_books: monthlyBooks,
          total_energy: totalEnergy,
          total_books: totalBooks,
        });
      }
    }

    // 檢查年月是否與前端輸入一致
    const ymCounts = fileYms.reduce((acc, ym) => {
      acc[ym] = (acc[ym] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostCommonYm = Object.entries(ymCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const ymMismatch = mostCommonYm && mostCommonYm !== target_year_month;

    const now = new Date().toISOString();

    // 寫入 app_reading_monthly（每人每月一筆）
    if (parsedRows.length > 0) {
      const monthlyRows = parsedRows.map((r) => ({
        account:    r.account,
        name:       r.name,
        class_id:   r.class_id,
        year_month: target_year_month,
        energy:     r.monthly_energy,
        books:      r.monthly_books,
        updated_at: now,
      }));

      const { error: monthlyErr } = await SUPABASE
        .from("app_reading_monthly")
        .upsert(monthlyRows, { onConflict: "account,year_month" });

      if (monthlyErr) {
        console.error("app_reading_monthly upsert error:", monthlyErr);
        throw new Error("寫入月報失敗：" + monthlyErr.message);
      }
    }

    // 寫入 app_reading_totals（累積總計）
    if (parsedRows.length > 0) {
      const totalRows = parsedRows.map((r) => ({
        account:      r.account,
        total_energy: r.total_energy,
        total_books:  r.total_books,
        updated_at:   now,
      }));

      const { error: totalErr } = await SUPABASE
        .from("app_reading_totals")
        .upsert(totalRows, { onConflict: "account" });

      if (totalErr) {
        console.error("app_reading_totals upsert error:", totalErr);
        throw new Error("寫入累積資料失敗：" + totalErr.message);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: parsedRows.length,
        not_found: notFoundNames,
        ym_mismatch: ymMismatch
          ? { file_ym: mostCommonYm, target_ym: target_year_month }
          : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("import-reading-excel error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});