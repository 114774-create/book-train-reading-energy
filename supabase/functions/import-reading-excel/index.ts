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

function prevYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const py = d.getUTCFullYear();
  const pm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${py}-${pm}`;
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
    let newCards: { account: string; name: string; class_id: string; year_month: string; cards_this_month: number }[] = [];

    if (parsedRows.length > 0) {
      const accounts = [...new Set(parsedRows.map((r) => r.account))];
      const prevYm = prevYearMonth(target_year_month);

      // 第一次寫入 app_reading_monthly（cards_earned 先用 0 佔位，稍後用正確公式回填）
      // total_energy_snapshot / total_books_snapshot：直接存 Excel 自己的「學生挖掘總能量/總本數」
      // 欄位——這是學校自己系統算出的真正累積值（含 2026-05 之前手動登記、沒有匯入本系統的歷史），
      // 不是我們自己加總算出來的，所以完全不受「哪些月份有沒有匯入」影響。
      const monthlyRowsInitial = parsedRows.map((r) => ({
        account:    r.account,
        year_month: target_year_month,
        energy_added: r.monthly_energy,
        books_added:  r.monthly_books,
        total_energy_snapshot: r.total_energy,
        total_books_snapshot:  r.total_books,
        cards_earned: 0,
        created_at: now,
      }));

      const { error: monthlyErr } = await SUPABASE
        .from("app_reading_monthly")
        .upsert(monthlyRowsInitial, { onConflict: "account,year_month" });

      if (monthlyErr) {
        console.error("app_reading_monthly upsert error:", monthlyErr);
        throw new Error("寫入月報失敗：" + monthlyErr.message);
      }

      // 寫入後重新讀取這些學生「目前所有月份」的資料（含剛寫入的這個月），
      // 同一份資料同時拿來：① 算累積總計（app_reading_totals）② 算本月榮譽卡差額
      const { data: allMonthly, error: sumErr } = await SUPABASE
        .from("app_reading_monthly")
        .select("account, year_month, total_energy_snapshot, total_books_snapshot")
        .in("account", accounts);

      if (sumErr) {
        console.error("讀取月報資料失敗:", sumErr);
        throw new Error("讀取累積資料失敗：" + sumErr.message);
      }

      // 每個學生所有月份的快照，方便查「最新月份」與「上個月」各自的值
      const rowsByAccount: Record<string, { year_month: string; total_energy_snapshot: number; total_books_snapshot: number }[]> = {};
      for (const row of allMonthly ?? []) {
        const acc = row.account as string;
        if (!rowsByAccount[acc]) rowsByAccount[acc] = [];
        rowsByAccount[acc].push({
          year_month: row.year_month as string,
          total_energy_snapshot: (row.total_energy_snapshot as number) ?? 0,
          total_books_snapshot: (row.total_books_snapshot as number) ?? 0,
        });
      }

      // ① 累積總計：取該學生「最新一個月份」的快照值（不是加總）——
      //    如果有更新的月份，一律以更新的為準，不管上傳順序為何
      const totalRows = accounts.map((acc) => {
        const accRows = rowsByAccount[acc] ?? [];
        const latestRow = accRows.reduce((max, r) => (!max || r.year_month > max.year_month ? r : max), null as typeof accRows[number] | null);
        return {
          account: acc,
          total_energy: latestRow?.total_energy_snapshot ?? 0,
          total_books: latestRow?.total_books_snapshot ?? 0,
          updated_at: now,
        };
      });

      const { error: totalErr } = await SUPABASE
        .from("app_reading_totals")
        .upsert(totalRows, { onConflict: "account" });

      if (totalErr) {
        console.error("app_reading_totals upsert error:", totalErr);
        throw new Error("寫入累積資料失敗：" + totalErr.message);
      }

      // ② 榮譽卡張數：該月應發放張數 = floor(該月累積總能量/500) - floor(上月累積總能量/500)
      //    直接用 Excel 自己回報的累積總能量（該月的用這次匯入的值；上月的用上個月匯入時存的快照，
      //    沒有上月紀錄則視為 0），不是我們自己加總，跟哪些月份有沒有匯入無關。
      const cardsMap: Record<string, number> = {};
      for (const r of parsedRows) {
        const accRows = rowsByAccount[r.account] ?? [];
        const prevRow = accRows.find((row) => row.year_month === prevYm);
        const targetSnapshot = r.total_energy; // 這次匯入、這個月自己的累積總能量
        const prevSnapshot = prevRow?.total_energy_snapshot ?? 0; // 沒有上月紀錄 = 0
        const cardsThisMonth = Math.max(
          0,
          Math.floor(targetSnapshot / 500) - Math.floor(prevSnapshot / 500)
        );
        cardsMap[r.account] = cardsThisMonth;
      }

      // 用正確的 cards_earned 回填這個月的月報列
      const monthlyRowsFinal = parsedRows.map((r) => ({
        account:    r.account,
        year_month: target_year_month,
        energy_added: r.monthly_energy,
        books_added:  r.monthly_books,
        total_energy_snapshot: r.total_energy,
        total_books_snapshot:  r.total_books,
        cards_earned: cardsMap[r.account] ?? 0,
        created_at: now,
      }));

      const { error: monthlyFinalErr } = await SUPABASE
        .from("app_reading_monthly")
        .upsert(monthlyRowsFinal, { onConflict: "account,year_month" });

      if (monthlyFinalErr) {
        console.error("app_reading_monthly cards_earned 回填失敗:", monthlyFinalErr);
        throw new Error("寫入榮譽卡張數失敗：" + monthlyFinalErr.message);
      }

      // 整理本月「新增」榮譽卡清單（張數 > 0 的學生），給後續寫入 Google 試算表用
      newCards = parsedRows
        .filter((r) => (cardsMap[r.account] ?? 0) > 0)
        .map((r) => ({
          account: r.account,
          name: r.name,
          class_id: r.class_id,
          year_month: target_year_month,
          cards_this_month: cardsMap[r.account],
        }));
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: parsedRows.length,
        not_found: notFoundNames,
        ym_mismatch: ymMismatch
          ? { file_ym: mostCommonYm, target_ym: target_year_month }
          : null,
        new_cards: newCards,
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