//
// return-box: 整批歸還書箱
//
// 需要的 Secret：SERVICE_ROLE_KEY
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
    const { box_loan_id } = body;

    if (!box_loan_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "缺少 box_loan_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1) 查詢 box_loans 記錄
    const { data: boxLoan, error: boxLoanErr } = await SUPABASE
      .from("box_loans")
      .select("*")
      .eq("id", box_loan_id)
      .single();

    if (boxLoanErr) throw boxLoanErr;
    if (boxLoan.status === "returned") {
      return new Response(
        JSON.stringify({ ok: false, error: "此書箱已經歸還" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const declaredBookCount = boxLoan.book_count ?? 0;

    // 2) 查詢該 box_loan 底下的所有 borrowed 書籍
    const { data: borrowedBooks, error: bookErr } = await SUPABASE
      .from("books")
      .select("barcode")
      .eq("status", "borrowed")
      .eq("box_code", boxLoan.box_code);

    if (bookErr) throw bookErr;

    const borrowedBarcodes = (borrowedBooks ?? []).map((b: any) => b.barcode);
    const returnedCount = borrowedBarcodes.length;

    // 3) 將所有 status='borrowed' 的書改成 status='available'，清空 borrowing_class
    if (borrowedBarcodes.length > 0) {
      const { error: updateErr } = await SUPABASE
        .from("books")
        .update({
          status: "available",
          borrowing_class: null,
          return_date: null,
          borrowed_by: null,
          borrowed_at: null,
        })
        .in("barcode", borrowedBarcodes);
      if (updateErr) throw updateErr;

      // 4) 每本書寫一筆 borrow_logs（action='return'）
      const returnLogRows = borrowedBarcodes.map((barcode: string) => ({
        student_id: null,
        barcode,
        action: "return",
        box_loan_id: box_loan_id,
        at: new Date().toISOString(),
      }));

      const { error: logErr } = await SUPABASE
        .from("borrow_logs")
        .insert(returnLogRows);
      if (logErr) throw logErr;
    }

    // 5) 更新 box_loans 狀態為 returned
    const { error: updateBoxErr } = await SUPABASE
      .from("box_loans")
      .update({
        status: "returned",
        returned_at: new Date().toISOString(),
      })
      .eq("id", box_loan_id);
    if (updateBoxErr) throw updateBoxErr;

    // 6) 檢查實際歸還本數與當初借出本數是否一致
    const countMismatch = returnedCount !== declaredBookCount;

    return new Response(
      JSON.stringify({
        ok: true,
        returned_count: returnedCount,
        declared_count: declaredBookCount,
        count_mismatch: countMismatch,
        missing_books: countMismatch ? declaredBookCount - returnedCount : 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("return-box error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
