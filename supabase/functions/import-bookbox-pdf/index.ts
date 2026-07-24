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
  const books: { barcode: string; title: string; author: string | null }[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let inList = false;
  let current: { barcode: string; parts: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const full = current.parts.join(" ").trim();
    const sepIdx = full.lastIndexOf("；");
    books.push({
      barcode: current.barcode,
      title:  sepIdx > -1 ? full.slice(0, sepIdx).trim() : full,
      author: sepIdx > -1 ? full.slice(sepIdx + 1).trim() : null,
    });
    current = null;
  };

  for (const line of lines) {
    if (!inList) {
      if (/序號/.test(line) && /登錄號/.test(line)) inList = true;
      continue;
    }
    // 序號 + 登錄號（7~9碼）開頭 = 新的一本書
    const m = line.match(/^(\d+)\s+(\d{7,9})\s*(.*)/);
    if (m) {
      flush();
      current = { barcode: m[2], parts: m[3] ? [m[3]] : [] };
    } else if (current) {
      current.parts.push(line);
    }
  }
  flush();

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
            borrowing_class: parsed.borrowing_class,
            return_date:     parsed.due_date,
            status:          "borrowed",
            borrowed_by:     null,
            borrowed_at:     new Date().toISOString(),
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