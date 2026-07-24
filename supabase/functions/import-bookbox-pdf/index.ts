//
// import-bookbox-pdf: 使用 pdfjs-dist 擷取 PDF 文字，規則式解析書箱清單，寫入 box_loans / books / borrow_logs
//
// 需要的 Secret：SERVICE_ROLE_KEY
// SUPABASE_URL 為內建環境變數
// 完全不依賴任何外部 AI 服務
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

// 民國年日期轉西元年日期字串（YYYY-MM-DD）
function rocDateToWestern(rocDateStr: string): string | null {
  const match1 = rocDateStr.match(/(\d{1,3})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{1,2})/);
  if (match1) {
    const year = parseInt(match1[1], 10) + 1911;
    const month = parseInt(match1[2], 10);
    const day = parseInt(match1[3], 10);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const match2 = rocDateStr.match(/(\d{4})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{1,2})/);
  if (match2) {
    const year = parseInt(match2[1], 10);
    if (year > 1911) return rocDateStr.replace(/\//g, "-");
  }
  const match3 = rocDateStr.match(/民國\s*(\d{1,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (match3) {
    const year = parseInt(match3[1], 10) + 1911;
    const month = parseInt(match3[2], 10);
    const day = parseInt(match3[3], 10);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

interface ParseResult {
  box_code: string | null;
  box_name: string | null;
  box_category: string | null;
  borrowing_class: string | null;
  representative: string | null;
  book_count: number;
  borrow_date: string | null;
  due_date: string | null;
  books: {
    barcode: string; // 字串，保留前導零
    title: string;
    author: string | null;
  }[];
}

/**
 * 規則式解析書箱清單 PDF 文字
 */
function parseBoxPDF(text: string): ParseResult {
  const get = (pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? null;

  const boxCode = get(/書箱編號\s+(BOX\w+)/);
  const boxName = get(/書箱名稱\s+(.+?)(?=書箱類別|書籍冊數|\n)/);
  const boxCat = get(/書箱類別\s+(.+?)(?=書籍冊數|\n)/);
  const borrowClass = get(/借閱班級\s+(.+?)(?=借閱代表|\n)/);
  const rep = get(/代表人[：:]\s*(\S+)/);
  const bookCount = parseInt(get(/書籍冊數\s+(\d+)/) ?? "0", 10);
  const borrowDate = get(/借閱日期\s+(\d{2,3}-\d{2}-\d{2})/);
  const dueDate = get(/應還日期\s+(\d{2,3}-\d{2}-\d{2})/);

  // 民國年轉西元
  const rocToISO = (roc: string | null) => {
    if (!roc) return null;
    const [y, m, d] = roc.split("-");
    return `${parseInt(y) + 1911}-${m}-${d}`;
  };

  // 書單解析：找到序號標題列之後，每行開頭數字 = 新的一本書
  const books: { barcode: string; title: string; author: string | null }[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let inList = false;
  let current: { barcode: string; titleParts: string[]; authorParts: string[] } | null = null;

  for (const line of lines) {
    // 找到表頭「序號」那行就開始
    if (!inList && /序號/.test(line) && /登錄號/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;

    // 每行開頭是「數字 空白 8-9位數字」= 新的一本書
    const bookStart = line.match(/^(\d+)\s+(\d{7,9})\s*(.*)/);
    if (bookStart) {
      // 儲存上一本
      if (current) {
        const fullText = [...current.titleParts, ...current.authorParts].join(" ");
        const sepIdx = fullText.lastIndexOf("；");
        books.push({
          barcode: current.barcode, // 保持字串，不轉數字
          title: sepIdx > -1 ? fullText.slice(0, sepIdx).trim() : fullText.trim(),
          author: sepIdx > -1 ? fullText.slice(sepIdx + 1).trim() : null,
        });
      }
      current = { barcode: bookStart[2], titleParts: [bookStart[3]], authorParts: [] };
    } else if (current) {
      // 續行（書名或作者跨行）
      current.titleParts.push(line);
    }
  }
  // 最後一本
  if (current) {
    const fullText = [...current.titleParts, ...current.authorParts].join(" ");
    const sepIdx = fullText.lastIndexOf("；");
    books.push({
      barcode: current.barcode,
      title: sepIdx > -1 ? fullText.slice(0, sepIdx).trim() : fullText.trim(),
      author: sepIdx > -1 ? fullText.slice(sepIdx + 1).trim() : null,
    });
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

/**
 * 使用 pdfjs-dist 從 base64 擷取 PDF 文字
 */
async function extractTextFromPdf(pdfBase64: string): Promise<string> {
  const pdfjsLib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.mjs");

  // 設定 worker
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.mjs";

  // 將 base64 轉為 Uint8Array
  const binaryStr = atob(pdfBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const loadingTask = (pdfjsLib as any).getDocument({ data: bytes });
  const pdf = await loadingTask.promise;

  const allText: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    allText.push(pageText);
  }

  return allText.join("\n");
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
    const { pdf_base64 } = body;

    if (!pdf_base64) {
      return new Response(
        JSON.stringify({ ok: false, error: "缺少 pdf_base64" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1) 擷取 PDF 文字
    const rawText = await extractTextFromPdf(pdf_base64);

    // 2) 規則式解析書箱資訊
    const parsed = parseBoxPDF(rawText);

    // 驗證必要欄位
    if (!parsed.box_code) {
      return new Response(
        JSON.stringify({ ok: false, error: "無法解析書箱編號，請確認 PDF 格式正確" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3) 寫入 box_loans
    const borrowDate = parsed.borrow_date;
    const dueDate = parsed.due_date;

    const { data: boxLoanData, error: boxLoanErr } = await SUPABASE
      .from("box_loans")
      .insert({
        box_code: parsed.box_code,
        box_name: parsed.box_name ?? null,
        box_category: parsed.box_category ?? null,
        borrowing_class: parsed.borrowing_class ?? null,
        representative: parsed.representative ?? null,
        book_count: parsed.book_count,
        borrow_date: borrowDate,
        due_date: dueDate,
        status: "borrowed",
      })
      .select("id")
      .single();

    if (boxLoanErr) throw boxLoanErr;
    const boxLoanId = boxLoanData.id;

    // 4) Upsert books（barcode 為唯一鍵）
    const bookUpserts = parsed.books.map((b) => ({
      barcode: b.barcode, // 保持字串，不可轉數字
      title: b.title,
      author: b.author || null,
      borrowing_class: parsed.borrowing_class ?? null,
      return_date: dueDate,
      status: "borrowed" as const,
      borrowed_by: null,
      borrowed_at: new Date().toISOString(),
      box_code: parsed.box_code,
      box_name: parsed.box_name ?? null,
    }));

    const { error: bookErr } = await SUPABASE
      .from("books")
      .upsert(bookUpserts, { onConflict: "barcode" });
    if (bookErr) throw bookErr;

    // 5) 寫入 borrow_logs（每本書一筆，action='borrow'）
    const borrowLogRows = parsed.books.map((b) => ({
      student_id: null, // 書箱借閱不綁定單一學生
      barcode: b.barcode,
      action: "borrow",
      box_loan_id: boxLoanId,
      created_at: new Date().toISOString(),
    }));

    const { error: logErr } = await SUPABASE
      .from("borrow_logs")
      .insert(borrowLogRows);
    if (logErr) throw logErr;

    // 6) 檢查本數是否一致
    const pdfBookCount = parsed.books.length;
    const declaredBookCount = parsed.book_count;
    const countMismatch = pdfBookCount !== declaredBookCount;

    return new Response(
      JSON.stringify({
        ok: true,
        imported: pdfBookCount,
        declared_count: declaredBookCount,
        count_mismatch: countMismatch,
        box_loan_id: boxLoanId,
        box_code: parsed.box_code,
        box_name: parsed.box_name,
        borrowing_class: parsed.borrowing_class,
        due_date: dueDate,
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
