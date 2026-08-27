// supabase/functions/_shared/googleSheets.ts
// 共用模組：Google 服務帳號 OAuth2 認證 + 寫入 Google 試算表
// 供 issue-honor-cards、issue-theme-event-rewards 共用，避免重複維護兩份一樣的邏輯

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 用服務帳號 JSON（GOOGLE_SERVICE_ACCOUNT_JSON）簽 RS256 JWT，換取 Sheets API access token
 */
export async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  let sa: { client_email: string; private_key: string };
  try {
    sa = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 格式不是合法 JSON");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 缺少 client_email 或 private_key");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;

  const pem = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

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

  const jwt = `${signingInput}.${base64url(signature)}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    throw new Error("Google OAuth 取得 access token 失敗：" + (await resp.text()));
  }
  const json = await resp.json();
  return json.access_token as string;
}

/**
 * 把資料列 append 進指定試算表的指定分頁
 */
export async function appendToSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  rows: (string | number)[][]
) {
  const range = `${sheetName}!A:E`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: rows }),
  });
  if (!resp.ok) {
    throw new Error("寫入 Google 試算表失敗：" + (await resp.text()));
  }
  return await resp.json();
}

/** 格式：2026/07/02 19:03（台灣時間） */
export function formatSheetTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}
