//
// import-bookbox-pdf: 使用 Gemini API 解析書箱清單 PDF，寫入 box_loans / books / borrow_logs
//
// 需要的 Secret：SERVICE_ROLE_KEY、GEMINI_API_KEY
// SUPABASE_URL 為內建環境變數
//

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// 民國年日期轉西元年日期字串（YYYY-MM-DD）
function rocDateToWestern(rocDateStr: string): string | null {
  // 嘗試解析民國年格式，例如 "115/01/15" 或 "115年1月15日"
  const match1 = rocDateStr.match(/(\d{1,3})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{1,2})/);
  if (match1) {
    const year = parseInt(match1[1], 10) + 1911;
    const month = parseInt(match1[2], 10);
    const day = parseInt(match1[3], 10);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // 嘗試解析西元年格式（直接返回）
  const match2 = rocDateStr.match(/(\d{4})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{1,2})/);
  if (match2) {
    const year = parseInt(match2[1], 10);
    if (year > 1911) return rocDateStr.replace(/\//g, "-");
  }
  // 嘗試解析「民國115年1月15日」格式
  const match3 = rocDateStr.match(/民國\s*(\d{1,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (match3) {
    const year = parseInt(match3[1], 10) + 1911;
    const month = parseInt(match3[2], 10);
    const day = parseInt(match3[3], 10);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

interface GeminiParseResult {
  box_code: string;
  box_name: string;
  box_category: string;
  borrowing_class: string;
  representative: string;
  book_count: number;
  borrow_date: string;
  due_date: string;
  books: {
    barcode: string; // 字串，保留前導零
    title: string;
    author: string;
  }[];
}

// 呼叫 Gemini API 解析 PDF
async function parsePdfWithGemini(pdfBase64: string): Promise<GeminiParseResult> {
  const prompt = `你是一個專門解析學校圖書館「書箱清單」PDF 文件的 AI 助手。
請將 PDF 內容解析為結構化的 JSON 資料，並嚴格遵守以下格式要求：

書箱資訊：
- box_code: 書箱編號（例如 BOX0000A）
- box_name: 書箱名稱
- box_category: 書箱類別
- borrowing_class: 借閱班級（例如 201）
- representative: 借閱代表（學生姓名）
- book_count: 書籍冊數（數字）
- borrow_date: 借閱日期（格式 YYYY-MM-DD，民國年+1911=西元年）
- due_date: 應還日期（格式 YYYY-MM-DD，民國年+1911=西元年）

書單：
- books: 陣列，每本書包含：
  - barcode: 登錄號（字串，8-9碼，不可轉數字，開頭0必須保留）
  - title: 書籍名稱
  - author: 作者（如無則為空字串）

注意：
1. 登錄號（barcode）必須當作字串處理，絕對不可 parseInt
2. 日期如果是民國年（如 115/01/15），請轉換為西元年（2026-01-15）
3. 如果找不到某個欄位，使用空字串或 0

請解析以下 PDF 檔案（base64 編碼），並將書箱資訊與書單以 JSON 格式輸出：

${pdfBase64}`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    throw new Error(`Gemini API error: ${geminiRes.status} ${errText}`);
  }

  const geminiData = await geminiRes.json();
  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (!text) {
    throw new Error("Gemini 回傳內容為空");
  }

  return JSON.parse(text) as GeminiParseResult;
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

    // 1) 呼叫 Gemini 解析 PDF
    const parsed = await parsePdfWithGemini(pdf_base64);

    // 2) 寫入 box_loans
    const borrowDate = rocDateToWestern(parsed.borrow_date) ?? parsed.borrow_date;
    const dueDate = rocDateToWestern(parsed.due_date) ?? parsed.due_date;

    const { data: boxLoanData, error: boxLoanErr } = await SUPABASE
      .from("box_loans")
      .insert({
        box_code: parsed.box_code,
        box_name: parsed.box_name,
        box_category: parsed.box_category,
        borrowing_class: parsed.borrowing_class,
        representative: parsed.representative,
        book_count: parsed.book_count,
        borrow_date: borrowDate,
        due_date: dueDate,
        status: "borrowed",
      })
      .select("id")
      .single();

    if (boxLoanErr) throw boxLoanErr;
    const boxLoanId = boxLoanData.id;

    // 3) Upsert books（barcode 為唯一鍵）
    const bookUpserts = parsed.books.map((b) => ({
      barcode: b.barcode, // 保持字串，不可轉數字
      title: b.title,
      author: b.author || null,
      borrowing_class: parsed.borrowing_class,
      return_date: dueDate,
      status: "borrowed" as const,
      borrowed_by: null,
      borrowed_at: new Date().toISOString(),
      box_code: parsed.box_code,
      box_name: parsed.box_name,
    }));

    const { error: bookErr } = await SUPABASE
      .from("books")
      .upsert(bookUpserts, { onConflict: "barcode" });
    if (bookErr) throw bookErr;

    // 4) 寫入 borrow_logs（每本書一筆，action='borrow'）
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

    // 5) 檢查本數是否一致
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
