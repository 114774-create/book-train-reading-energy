// import-bookbox-pdf Edge Function
// PDF 解析移到前端做，此函式只接收純文字 + 寫入資料庫
// 需要的 Secret：SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface ParseResult {
  box_code: string | null;
  box_name: string | null;
  box_category: string | null;
  borrowing_class: string | null;
  representative: string | null;
  book_count: number;
  borrow_date: string | null;
  due_date: string | null;
  books: { barcode: string; title: string; author: string | null }[];
}

// 中文班級名稱 → 班級代碼對照
function classNameToId(name: string | null): string | null {
  if (!name) return null;
  const map: Record<string, string> = {
    "一年一班": "101", "一年甲班": "101",
    "一年二班": "102", "一年乙班": "102",
    "一年三班": "103", "一年丙班": "103",
    "二年一班": "201", "二年甲班": "201",
    "二年二班": "202", "二年乙班": "202",
    "二年三班": "203", "二年丙班": "203",
    "三年一班": "301", "三年甲班": "301",
    "三年二班": "302", "三年乙班": "302",
    "三年三班": "303", "三年丙班": "303",
    "四年一班": "401", "四年甲班": "401",
    "四年二班": "402", "四年乙班": "402",
    "四年三班": "403", "四年丙班": "403",
    "五年一班": "501", "五年甲班": "501",
    "五年二班": "502", "五年乙班": "502",
    "五年三班": "503", "五年丙班": "503",
    "六年一班": "601", "六年甲班": "601",
    "六年二班": "602", "六年乙班": "602",
    "六年三班": "603", "六年丙班": "603",
  };
  return map[name.trim()] ?? name;
}

function rocToISO(roc: string | null): string | null {
  if (!roc) return null;
  const [y, m, d] = roc.split("-");
  return `${parseInt(y) + 1911}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
}

function parseBoxPDF(text: string): ParseResult {
  const get = (pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? null;

  const boxCode     = get(/書箱編號\s+(BOX\w+)/);
  const boxName     = get(/書箱名稱\s+(.+?)(?=書箱類別|書籍冊數|\n)/);
  const boxCat      = get(/書箱類別\s+(.+?)(?=書籍冊數|\n)/);
  const borrowClass = get(/借閱班級\s+(.+?)(?=借閱代表|\n)/);
  const rep         = get(/代表人[：:]\s*(\S+)/);
  const bookCount   = parseInt(get(/書籍冊數\s+(\d+)/) ?? "0", 10);
  const borrowDate  = get(/借閱日期\s+(\d{2,3}-\d{2}-\d{2})/);
  const dueDate     = get(/應還日期\s+(\d{2,3}-\d{2}-\d{2})/);

  // 書單解析
  // pdfjs 實際格式：所有書連在一起，用序號+登錄號當分隔點
  // 例如：1   00007617   今天運氣怎麼這麼好  2   00122564   印度豹大拍賣 ...
  // 登錄號特徵：緊跟在序號(1-2碼數字)後面的 8-9 碼數字
  // 書名和作者之間沒有固定分隔符，但作者在書名之後、下一個序號之前
  const books: { barcode: string; title: string; author: string | null }[] = [];

  // 找書單開始位置（序號 登錄號 書籍名稱 作者 備註 這行之後）
  const headerMatch = text.match(/序號\s+登錄號\s+書籍名稱\s+作者/);
  const listText = headerMatch
    ? text.slice(text.indexOf(headerMatch[0]) + headerMatch[0].length)
    : text;

  // 用正規表達式找出所有「序號 + 登錄號」的位置
  // 序號是 1~30 的數字，登錄號是 7~9 碼數字
  const bookPattern = /\b(\d{1,2})\s+(\d{7,9})\s+/g;
  const matches: { seq: number; barcode: string; contentStart: number }[] = [];
  let bm: RegExpExecArray | null;

  while ((bm = bookPattern.exec(listText)) !== null) {
    const seq = parseInt(bm[1], 10);
    const barcode = bm[2];
    if (seq >= 1 && seq <= 99) {
      matches.push({
        seq,
        barcode,
        contentStart: bm.index + bm[0].length,
      });
    }
  }

  // 去重（同序號只保留第一個）
  const seen = new Set<number>();
  const validMatches = matches.filter(m => {
    if (seen.has(m.seq)) return false;
    seen.add(m.seq);
    return true;
  }).sort((a, b) => a.seq - b.seq);

  // 每本書的內容 = 從 contentStart 到下一本書的「序號+登錄號」開始前
  for (let i = 0; i < validMatches.length; i++) {
    const cur = validMatches[i];
    const nextMatchStart = i + 1 < validMatches.length
      ? listText.indexOf(
          String(validMatches[i + 1].seq) + "   " + validMatches[i + 1].barcode,
          cur.contentStart
        )
      : -1;

    const rawContent = nextMatchStart > -1
      ? listText.slice(cur.contentStart, nextMatchStart).trim()
      : listText.slice(cur.contentStart).trim();

    // 清除結尾殘留的「備註」欄位空白或頁首文字
    const content = rawContent
      .replace(/臺南市東山區青山國民小學圖書館.*$/s, "")
      .replace(/\s{3,}/g, "  ") // 多個空白壓縮成兩個
      .trim();

    if (!content) continue;

    // 書名和作者的分隔：
    // 作者欄通常包含「文」「圖」「譯」「作」「繪」等字，或外國人名括號
    // 用兩個以上空格或「；」來分隔書名和作者
    const sepMatch = content.match(/\s{2,}(?=[^\s])/);
    let title = content;
    let author: string | null = null;

    if (sepMatch && sepMatch.index !== undefined) {
      const candidate = content.slice(0, sepMatch.index).trim();
      const rest = content.slice(sepMatch.index).trim();
      // 如果後半部像是作者（含文/圖/譯/作/繪/；）就切開
      if (rest && /[文圖譯作繪；]/.test(rest)) {
        title = candidate;
        author = rest;
      }
    }

    // 如果有 ；分隔符，優先用它
    const semiIdx = content.indexOf("；");
    if (semiIdx > -1) {
      // 找最後一個適合分割的位置前的書名
      const beforeSemi = content.slice(0, semiIdx).trim();
      // 書名不應該太短，且分號後面應該有內容
      if (beforeSemi.length > 1 && semiIdx < content.length - 1) {
        // 從最後一個「  」（兩空格）之前找書名邊界
        const lastDoubleSpace = beforeSemi.lastIndexOf("  ");
        if (lastDoubleSpace > 0) {
          title = beforeSemi.slice(0, lastDoubleSpace).trim();
          author = content.slice(lastDoubleSpace).trim();
        } else {
          title = beforeSemi;
          author = content.slice(semiIdx + 1).trim();
        }
      }
    }

    if (title) {
      books.push({ barcode: cur.barcode, title, author });
    }
  }

  return {
    box_code: boxCode,
    box_name: boxName,
    box_category: boxCat,
    borrowing_class: borrowClass,
    representative: rep,
    book_count: bookCount,
    borrow_date: rocToISO(borrowDate),
    due_date: rocToISO(dueDate),
    books,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 驗證 token
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || !token.startsWith("local-rpc:")) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    // 接受兩種格式：前端傳 raw_text（新版），或舊版傳 pdf_base64 但已無法處理
    const rawText: string | undefined = body.raw_text;

    if (!rawText || rawText.trim().length < 20) {
      return new Response(
        JSON.stringify({ ok: false, error: "缺少 raw_text，請確認前端有先解析 PDF 文字再傳送" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 解析
    const parsed = parseBoxPDF(rawText);

    if (!parsed.box_code) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "無法解析書箱編號（BOXxxxx），請確認 PDF 格式正確",
          raw_preview: rawText.slice(0, 300),
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 寫入 box_loans
    const { data: boxLoanData, error: boxLoanErr } = await SUPABASE
      .from("box_loans")
      .insert({
        box_code:        parsed.box_code,
        box_name:        parsed.box_name,
        box_category:    parsed.box_category,
        borrowing_class: parsed.borrowing_class,
        representative:  parsed.representative,
        book_count:      parsed.book_count,
        borrow_date:     parsed.borrow_date,
        due_date:        parsed.due_date,
        status:          "borrowed",
      })
      .select("id")
      .single();
    if (boxLoanErr) throw boxLoanErr;
    const boxLoanId = boxLoanData.id;

    // Upsert books
    if (parsed.books.length > 0) {
      const { error: bookErr } = await SUPABASE
        .from("books")
        .upsert(
          parsed.books.map(b => ({
            barcode:         b.barcode,
            title:           b.title,
            author:          b.author,
            borrowing_class: classNameToId(parsed.borrowing_class),
            return_date:     parsed.due_date,
            status:          "available",
            borrowed_by:     null,
            borrowed_at:     null,
            box_code:        parsed.box_code,
            box_name:        parsed.box_name,
          })),
          { onConflict: "barcode" }
        );
      if (bookErr) throw bookErr;

      // 寫入 borrow_logs
      const { error: logErr } = await SUPABASE
        .from("borrow_logs")
        .insert(
          parsed.books.map(b => ({
            student_id:  null,
            barcode:     b.barcode,
            action:      "borrow",
            box_loan_id: boxLoanId,
            at:          new Date().toISOString(),
          }))
        );
      if (logErr) throw logErr;
    }

    const countMismatch = parsed.books.length !== parsed.book_count;

    return new Response(
      JSON.stringify({
        ok: true,
        box_loan_id:    boxLoanId,
        box_code:       parsed.box_code,
        box_name:       parsed.box_name,
        borrowing_class:parsed.borrowing_class,
        borrow_date:    parsed.borrow_date,
        due_date:       parsed.due_date,
        imported:       parsed.books.length,
        declared_count: parsed.book_count,
        count_mismatch: countMismatch,
        warning: countMismatch
          ? `PDF 宣告 ${parsed.book_count} 本，實際解析到 ${parsed.books.length} 本，請人工核對`
          : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("import-bookbox-pdf error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});