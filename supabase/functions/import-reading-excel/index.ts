//
// import-reading-excel: 從前端上傳的 Excel 檔案（base64）解析學生閱讀月報並寫入 DB
//
// Excel 格式（工作表名稱：學生閱讀能量統計）：
//   學年度 | 年 | 月 | 學生姓名 | 年級 | 班級 | 座號 | 本月挖掘能量 | 本月挖掘本數 | 等級 | 學生挖掘總能量 | 學生挖掘總本數 | 本學期累積能量 | 本學期累積挖掘本數
//
// 比對邏輯：
//   account = 年級 + 座號（例如 年級=201、座號=01 → account=20101）
//   對應 app_users 中的 account
//
// 需要的 Secret：SERVICE_ROLE_KEY（因 Supabase 不允許 SUPABASE_ 開頭）
// SUPABASE_URL 為內建環境變數
//

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// 民國年 → 西元年
function rocToWestern(rocYear: number): number {
  return rocYear + 1911;
}

// 將字串安全地轉為數字（先 trim 再轉）
function safeParseInt(s: any): number | null {
  const trimmed = String(s ?? "").trim();
  const n = parseInt(trimmed, 10);
  return isNaN(n) ? null : n;
}

interface ParsedRow {
  account: string;
  name: string;
  energy: number;
  books: number;
  total_energy: number;
  total_books: number;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 驗證請求（檢查 local-rpc token）
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || !token.startsWith("local-rpc:")) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { file_name, file_base64, target_year_month } = body;

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

    // 解析 Excel（使用 SheetJS / xlsx CDN）
    const xlsx = await import("https://esm.sh/xlsx@0.18.5");

    const binary = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));
    const wb = xlsx.read(binary, { type: "array" });

    // 嘗試找到「學生閱讀能量統計」工作表，否則使用第一個
    let ws;
    const targetSheet = wb.SheetNames.find((n) => n.includes("學生閱讀能量統計") || n.includes("能量統計"));
    if (targetSheet) {
      ws = wb.Sheets[targetSheet];
    } else {
      ws = wb.Sheets[wb.SheetNames[0]];
    }

    if (!ws) {
      return new Response(
        JSON.stringify({ ok: false, error: "找不到工作表" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 讀取所有資料
    const aoa = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as any[][];
    if (aoa.length < 2) {
      return new Response(
        JSON.stringify({ ok: false, error: "工作表無資料列" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 解析標題列（normalize：去除空白）
    const headerRow = aoa[0].map((h) => String(h ?? "").replace(/\s+/g, "").trim());

    // 欄位索引
    const idxYear = headerRow.findIndex((h) => h === "年" || h === "year");
    const idxMonth = headerRow.findIndex((h) => h === "月" || h === "month");
    const idxName = headerRow.findIndex((h) => h.includes("姓名") || h.toLowerCase().includes("name"));
    const idxGrade = headerRow.findIndex((h) => h.includes("年級") || h === "grade");
    const idxSeat = headerRow.findIndex((h) => h.includes("座號") || h.includes("number") || h.includes("座") || h === "number");
    const idxEnergy = headerRow.findIndex((h) => h.includes("本月挖掘能量") || h.includes("能量") || h.includes("energy"));
    const idxBooks = headerRow.findIndex((h) => h.includes("本月挖掘本數") || h.includes("本數") || h.includes("books"));
    const idxTotalEnergy = headerRow.findIndex((h) => h.includes("總能量") || h.includes("total_energy"));
    const idxTotalBooks = headerRow.findIndex((h) => h.includes("總本數") || h.includes("total_books"));

    if (idxGrade < 0 || idxSeat < 0 || idxName < 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "找不到必要欄位：年級、座號、姓名" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (idxYear < 0 || idxMonth < 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "找不到必要欄位：年、月" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 解析資料列
    const parsedRows: ParsedRow[] = [];
    const notFoundNames: { name: string; account: string }[] = [];
    const fileAccounts = new Set<string>();
    const fileYearMonth: string[] = [];

    for (const row of aoa.slice(1)) {
      if (!row || row.length === 0) continue;

      const rocYear = safeParseInt(row[idxYear]);
      const month = safeParseInt(row[idxMonth]);
      const grade = String(row[idxGrade] ?? "").trim();
      const seat = String(row[idxSeat] ?? "").trim().padStart(2, "0");
      const name = String(row[idxName] ?? "").trim();
      const energy = safeParseInt(row[idxEnergy]) ?? 0;
      const books = safeParseInt(row[idxBooks]) ?? 0;
      const totalEnergy = safeParseInt(row[idxTotalEnergy]) ?? energy;
      const totalBooks = safeParseInt(row[idxTotalBooks]) ?? books;

      if (!grade || !seat || !name) continue;

      // account = 年級 + 座號
      const account = grade + seat;
      fileAccounts.add(account);

      // 計算檔案中的年月（民國年 + 1911 = 西元年）
      if (rocYear !== null && month !== null) {
        const westernYear = rocToWestern(rocYear);
        const fileYm = `${westernYear}-${String(month).padStart(2, "0")}`;
        fileYearMonth.push(fileYm);
      }

      // 在 app_users 中查找該 account
      const { data: userData } = await SUPABASE
        .from("app_users")
        .select("account, name, class_id")
        .eq("account", account)
        .limit(1)
        .single();

      if (!userData) {
        // 嘗試用姓名模糊比對
        const { data: nameMatch } = await SUPABASE
          .from("app_users")
          .select("account, name, class_id")
          .eq("name", name)
          .eq("role", "student")
          .limit(1)
          .single();

        if (!nameMatch) {
          notFoundNames.push({ name, account });
          continue;
        }
        // 用找到的 account
        parsedRows.push({
          account: nameMatch.account,
          name: nameMatch.name,
          energy,
          books,
          total_energy: totalEnergy,
          total_books: totalBooks,
        });
      } else {
        parsedRows.push({
          account: userData.account,
          name: userData.name,
          energy,
          books,
          total_energy: totalEnergy,
          total_books: totalBooks,
        });
      }
    }

    if (parsedRows.length === 0 && notFoundNames.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "Excel 中無有效資料列" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 檢查檔案中的年月與前端輸入的年月是否一致
    const fileYmCounts = fileYearMonth.reduce((acc, ym) => {
      acc[ym] = (acc[ym] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const mostCommonYm = Object.entries(fileYmCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const ymMismatch = mostCommonYm && mostCommonYm !== target_year_month;

    // 批次 upsert 到 reading_monthly
    const monthlyRows = parsedRows.map((r) => ({
      student_no: r.account,
      account: r.account,
      name: r.name,
      year_month: target_year_month,
      energy: r.energy,
      books: r.books,
      class_id: null, // 會從 app_users 帶入
    }));

    if (monthlyRows.length > 0) {
      const { error: monthlyErr } = await SUPABASE
        .from("reading_monthly")
        .upsert(monthlyRows, { onConflict: "account,year_month" });
      if (monthlyErr) {
        console.error("reading_monthly upsert error:", monthlyErr);
      }
    }

    // 批次 upsert 到 reading_totals
    const totalRows = parsedRows.map((r) => ({
      student_id: r.account,
      total_energy: r.total_energy,
      total_books: r.total_books,
      updated_at: new Date().toISOString(),
    }));

    if (totalRows.length > 0) {
      const { error: totalErr } = await SUPABASE
        .from("reading_totals")
        .upsert(totalRows, { onConflict: "student_id" });
      if (totalErr) {
        console.error("reading_totals upsert error:", totalErr);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: parsedRows.length,
        not_found: notFoundNames,
        ym_mismatch: ymMismatch ? { file_ym: mostCommonYm, target_ym: target_year_month } : null,
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
