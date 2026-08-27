// supabase/functions/sync-students/index.ts
//
// 從 Google Sheets 單向同步學生名單到 app_users 表
//
// 需要在 Supabase Edge Function Secrets 設定（Settings → Edge Functions）：
//   GOOGLE_SERVICE_ACCOUNT_JSON  ← 服務帳戶 JSON 的完整內容（字串）
//   GOOGLE_SHEETS_ID             ← 試算表 ID（網址 /d/ 後面那段）
//   SERVICE_ROLE_KEY             ← Supabase service role key（跟其他 function 共用同一把）
//   SHEETS_RANGE                 ← 選填，讀取範圍，預設 "Students!A2:E"（跳過標題列）
//
// 部署指令（在專案根目錄執行）：
//   supabase functions deploy sync-students --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const SERVICE_ACCOUNT_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!;
const SHEETS_ID = Deno.env.get("GOOGLE_SHEETS_ID")!;

// 預設讀 Students 工作表，跳過第一列標題（A2:E 表示從第 2 列到 E 欄結尾）
const SHEETS_RANGE = Deno.env.get("SHEETS_RANGE") ?? "Students!A2:E";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Google OAuth2：用服務帳戶換 access token ─────────────────────────────────
async function getGoogleAccessToken(): Promise<string> {
  const sa = JSON.parse(SERVICE_ACCOUNT_JSON);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const signingInput = `${encode(header)}.${encode(payload)}`;

  // 把 PEM 私鑰匯入成 CryptoKey
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${signingInput}.${sigB64}`;

  // 換 access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("無法取得 Google access token: " + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1) 取 Google access token
    const accessToken = await getGoogleAccessToken();

    // 2) 讀取 Google Sheets 資料
    const sheetsUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}/values/${encodeURIComponent(SHEETS_RANGE)}`;
    const sheetsRes = await fetch(sheetsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const sheetsData = await sheetsRes.json();

    if (!sheetsData.values) {
      throw new Error("試算表沒有資料，請確認 GOOGLE_SHEETS_ID 與 SHEETS_RANGE 設定是否正確");
    }

    // 3) 把每列轉成學生物件
    // Google Sheets 欄位順序（Students 工作表）：
    //   A=id, B=grade, C=no, D=name, E=ename
    // 對應 app_users：
    //   account = id（例如 20101）
    //   class_id = grade（例如 201）
    //   name = name（例如 王傳蓮）
    //   role = 'student'（固定）
    //   password_hash = NULL（學生不需要密碼）
    const rows: string[][] = sheetsData.values;
    const students = rows
      .filter((r) => r[0]?.trim()) // 過濾空列
      .map((r) => ({
        account: r[0].trim(),       // id → account
        class_id: r[1]?.trim() ?? null, // grade → class_id
        name: r[3]?.trim() ?? "",   // name（第 4 欄，index 3）
        role: "student" as const,
        password_hash: null,
      }));

    if (students.length === 0) {
      throw new Error("試算表讀到 0 筆學生，請確認工作表名稱與範圍");
    }

    // 4) 寫入 Supabase（service role 略過 RLS）
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 先拿目前 DB 裡所有學生的 account 清單
    const { data: existing, error: fetchErr } = await supabase
      .from("app_users")
      .select("account")
      .eq("role", "student");
    if (fetchErr) throw fetchErr;

    const existingAccounts = new Set((existing ?? []).map((u) => u.account));
    const sheetAccounts = new Set(students.map((s) => s.account));

    // upsert：新增 or 更新（名字、班級可能異動）
    const { error: upsertErr } = await supabase
      .from("app_users")
      .upsert(students, { onConflict: "account" });
    if (upsertErr) throw upsertErr;

    // 刪除已畢業（在 DB 有但試算表已不存在）的學生
    const toDelete = [...existingAccounts].filter((a) => !sheetAccounts.has(a));
    let deleted = 0;
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from("app_users")
        .delete()
        .in("account", toDelete);
      if (delErr) throw delErr;
      deleted = toDelete.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        synced: students.length,
        upserted: students.length,
        deleted,
      }),
      { headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  } catch (err: any) {
    console.error("sync-students error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
  }
});
