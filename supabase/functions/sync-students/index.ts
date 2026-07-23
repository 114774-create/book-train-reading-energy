import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Google OAuth2 JWT 工具函式（使用 Service Account）
async function getGoogleAccessToken(
  serviceAccountKey: any,
  scope: string
): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = btoa(
    JSON.stringify({
      iss: serviceAccountKey.client_email,
      scope,
      aud: serviceAccountKey.token_uri,
      exp: now + 3600,
      iat: now,
    })
  );
  const signatureInput = `${header}.${claims}`;

  // 將 PEM private key 轉為 crypto 可用的格式
  const pemKey = serviceAccountKey.private_key;
  const encoder = new TextEncoder();

  // 使用 Deno crypto 進行 RS256 簽章
  const keyData = pemKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");

  const keyBytes = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(signatureInput)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const jwt = `${signatureInput}.${signatureB64}`;

  // 交換 access token
  const tokenRes = await fetch(serviceAccountKey.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${errText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// 讀取 Google Sheets 資料
async function readGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  range: string
): Promise<any[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Sheets API error: ${res.status} ${errText}`);
  }
  const data = await res.json();
  return data.values ?? [];
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 讀取環境變數
    const googleCredsRaw = Deno.env.get("GOOGLE_SHEETS_CREDENTIALS") ?? "";
    if (!googleCredsRaw) {
      throw new Error("Missing GOOGLE_SHEETS_CREDENTIALS");
    }
    let serviceAccountKey: any;
    try {
      serviceAccountKey = JSON.parse(googleCredsRaw);
    } catch {
      throw new Error("GOOGLE_SHEETS_CREDENTIALS is not valid JSON");
    }

    const spreadsheetId = Deno.env.get("STUDENT_LIST_SHEET_ID") ?? Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? "";
    if (!spreadsheetId) {
      throw new Error("Missing STUDENT_LIST_SHEET_ID or GOOGLE_SHEETS_SPREADSHEET_ID");
    }

    // 驗證請求（檢查 local-rpc token）
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || !token.startsWith("local-rpc:")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 讀取 Google Sheets 的 Students 工作表
    const range = "Students!A:D";
    const rows = await readGoogleSheet(
      await getGoogleAccessToken(serviceAccountKey, "https://www.googleapis.com/auth/spreadsheets.readonly"),
      spreadsheetId,
      range
    );

    if (!rows || rows.length < 2) {
      throw new Error("試算表無資料或標題列格式錯誤");
    }

    // 第一列為標題列
    const headerRow = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
    const idxId = headerRow.findIndex((h) => ["id", "account", "帳號"].includes(h));
    const idxGrade = headerRow.findIndex((h) => ["grade", "班級", "年級", "class"].includes(h));
    const idxName = headerRow.findIndex((h) => ["name", "姓名", "學生姓名"].includes(h));

    if (idxId < 0 || idxName < 0) {
      throw new Error("試算表標題列缺少必要欄位（至少需要 id 與 name）");
    }

    // 解析學生資料
    const sheetStudents: { account: string; name: string; class_id: string | null }[] = [];
    for (const row of rows.slice(1)) {
      if (!row || row.length === 0) continue;
      const account = String(row[idxId] ?? "").trim();
      const name = String(row[idxName] ?? "").trim();
      const classId = idxGrade >= 0 ? String(row[idxGrade] ?? "").trim() || null : null;
      if (!account || !name) continue;
      sheetStudents.push({ account, name, class_id: classId });
    }

    if (sheetStudents.length === 0) {
      throw new Error("試算表中無有效學生資料");
    }

    // 取得目前 Supabase 中 role='student' 的現有帳號列表
    const { data: existingStudents, error: fetchError } = await supabase
      .from("app_users")
      .select("account")
      .eq("role", "student");
    if (fetchError) throw fetchError;

    const existingAccounts = new Set((existingStudents ?? []).map((s: any) => s.account));
    const sheetAccounts = new Set(sheetStudents.map((s) => s.account));

    // 找出需要刪除的學生（在 DB 中但不在試算表中）
    const accountsToDelete = [...existingAccounts].filter((a) => !sheetAccounts.has(a));

    // 準備 upsert 資料
    const upsertRows = sheetStudents.map((s) => ({
      account: s.account,
      role: "student" as const,
      name: s.name,
      class_id: s.class_id,
      password_hash: null,
    }));

    // 執行 upsert（使用 account 作為唯一鍵值）
    const { data: upsertedData, error: upsertError } = await supabase
      .from("app_users")
      .upsert(upsertRows, {
        onConflict: "account",
      })
      .select("account");
    if (upsertError) throw upsertError;

    // 刪除畢業生（不在試算表中的學生）
    let deletedCount = 0;
    if (accountsToDelete.length > 0) {
      const { data: deletedData, error: deleteError } = await supabase
        .from("app_users")
        .delete()
        .in("account", accountsToDelete)
        .select("account");
      if (deleteError) throw deleteError;
      deletedCount = (deletedData ?? []).length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        synced: sheetStudents.length,
        upserted: (upsertedData ?? []).length,
        deleted: deletedCount,
        deleted_accounts: accountsToDelete,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message ?? String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
