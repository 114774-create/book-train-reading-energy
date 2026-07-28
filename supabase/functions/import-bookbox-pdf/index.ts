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
  // pdfjs 擷取出的文字可能是：
  //   (A) 每行一個欄位：序號、登錄號、書名、作者分開在不同行
  //   (B) 序號+登錄號貼在一起：如 "100007617" (序號1 + 登錄號00007617)
  //   (C) 空格分隔在同一行：如 "1 00007617 今天運氣怎麼這麼好"
  // 所以改用「在整段文字裡找所有登錄號」的方式，不依賴行結構
  const books: { barcode: string; title: string; author: string | null }[] = [];

  // 先把整段文字接成一行，方便用正規表達式全局匹配
  const flat = text.replace(/\n/g, " ").replace(/\s+/g, " ");

  // 找「序號」區塊開始的位置
  const listStart = flat.search(/序號\s*登錄號|序號.*?登錄號/);
  const listText = listStart > -1 ? flat.slice(listStart) : flat;

  // 找出所有「數字序號 + 登錄號(7~9碼數字)」的位置
  // 登錄號特徵：7~9 碼純數字，且前面是 1~2 碼的序號數字
  // 允許序號和登錄號之間有或沒有空格
  const bookPattern = /\b(\d{1,2})\s{0,3}(\d{7,9})\b/g;
  const matches: { seq: number; barcode: string; pos: number }[] = [];
  let bm: RegExpExecArray | null;
  while ((bm = bookPattern.exec(listText)) !== null) {
    const seq = parseInt(bm[1], 10);
    const barcode = bm[2];
    // 過濾掉明顯不是書的匹配（序號要從 1 開始遞增，最多 99）
    if (seq >= 1 && seq <= 99) {
      matches.push({ seq, barcode, pos: bm.index + bm[0].length });
    }
  }

  // 依序號排序，去除重複
  const seen = new Set<number>();
  const validMatches = matches
    .sort((a, b) => a.seq - b.seq)
    .filter(m => {
      if (seen.has(m.seq)) return false;
      seen.add(m.seq);
      return true;
    });

  // 每本書的書名/作者 = 從這本書登錄號結束到下一本書登錄號開始之間的文字
  for (let i = 0; i < validMatches.length; i++) {
    const cur = validMatches[i];
    const nextPos = validMatches[i + 1]?.pos ?? listText.length;
    const rawContent = listText.slice(cur.pos, nextPos).trim();

    // 去掉開頭可能殘留的序號數字
    const content = rawContent.replace(/^\d{1,2}\s*/, "").trim();

    const sepIdx = content.lastIndexOf("；");
    const title = sepIdx > -1 ? content.slice(0, sepIdx).trim() : content.trim();
    const author = sepIdx > -1 ? content.slice(sepIdx + 1).trim() : null;

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