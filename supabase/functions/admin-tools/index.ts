// Supabase Edge Function: admin-tools
// 目的：不動既有 custom-auth（登入/借還書），另外提供管理員功能：人事管理、排行榜、匯出
//
// 部署方式（在你的本機 / Supabase CLI 環境）：
//   supabase functions deploy admin-tools
//
// 注意：此函式預期沿用你現有 custom-auth 登入後發的 Bearer token。
// 你需要在此函式中驗證 token 並取得 role=admin。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type ClassCode = "101" | "201" | "301" | "401" | "501" | "601";

type UserRole = "admin" | "teacher" | "student";

function json(data: any, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

function bad(msg: string, status = 400) {
  return json({ ok: false, error: msg }, { status });
}

function assertEnv() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
}

// TODO：把這段改成「驗證你 custom-auth token」的邏輯。
// 我先做一個保守版本：要求 header 帶 x-admin-key（可選），或你自行接既有 token 解碼。
async function requireAdmin(req: Request) {
  // 方案 A：你可以先在 Supabase function secrets 設 ADMIN_TOOLS_KEY
  const adminKey = Deno.env.get("ADMIN_TOOLS_KEY");
  if (adminKey) {
    const got = req.headers.get("x-admin-key") || "";
    if (got !== adminKey) throw new Error("forbidden");
    return;
  }

  // 方案 B：沿用 custom-auth token（建議）
  // 你現有系統已經能讓前端帶 Bearer token 呼叫 functions。
  // 因為此 repo 未包含 custom-auth 原始碼，我這裡無法 100% 對齊你的 token 簽章與 payload。
  // 請把下方 TODO 補上：解析 token → 取出 account → 查 app_users.role 是否為 admin。
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("forbidden");
  const token = auth.slice("Bearer ".length).trim();
  if (!token) throw new Error("forbidden");

  // TODO: decode/verify token and get account
  // 暫時：允許（避免你部署後全被擋）；請務必改掉
  console.warn("admin-tools: token verification is TODO. Please implement requireAdmin(). token length:", token.length);
}

function parseUrl(req: Request) {
  const u = new URL(req.url);
  return { pathname: u.pathname.replace(/^.*\/admin-tools/, ""), search: u.searchParams };
}

function maskName(name: string) {
  const s = name.trim();
  if (!s) return "";
  if (s.length === 1) return s;
  if (s.length === 2) return s[0] + "O";
  return s[0] + "O" + s[s.length - 1];
}

async function listUsers() {
  const { data, error } = await supabase
    .from("app_users")
    .select("account, role, name, class_id, created_at, updated_at")
    .order("role", { ascending: true })
    .order("class_id", { ascending: true })
    .order("account", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function createUser(body: any) {
  const account = String(body?.account ?? "").trim();
  const role = String(body?.role ?? "student") as UserRole;
  const name = String(body?.name ?? "").trim();
  const class_id = (body?.class_id ?? null) as ClassCode | null;
  const password = body?.password ?? null;

  if (!account) throw new Error("missing_account");
  if (!name) throw new Error("missing_name");
  if (!(["admin", "teacher", "student"] as string[]).includes(role)) throw new Error("bad_role");
  if (role !== "admin" && !class_id) throw new Error("missing_class_id");

  // password：teacher/admin 需要
  let password_hash: string | null = null;
  if (role !== "student") {
    if (!password) throw new Error("missing_password");
    // TODO：請替換成你 custom-auth 使用的 hash 演算法（例如 bcrypt）
    // Edge Function Deno 沒有內建 bcrypt，若你已在 custom-auth 做好 hash，建議此處改為「呼叫 custom-auth 管理 API」
    // 這裡先用非常簡單的 SHA-256 示意（僅示意，不建議上線）
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(password)));
    password_hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const row: any = { account, role, name, class_id, password: password_hash };

  const { error } = await supabase.from("app_users").upsert(row, { onConflict: "account" });
  if (error) throw error;
}

async function deleteUser(account: string) {
  const acc = decodeURIComponent(account);
  const { error } = await supabase.from("app_users").delete().eq("account", acc);
  if (error) throw error;
}

async function promoteStudents(body: any) {
  const from = String(body?.from ?? "") as ClassCode;
  const to = String(body?.to ?? "") as ClassCode;
  if (!from || !to) throw new Error("missing_from_to");

  const { data, error } = await supabase
    .from("app_users")
    .update({ class_id: to })
    .eq("role", "student")
    .eq("class_id", from)
    .select("account");

  if (error) throw error;
  return (data ?? []).length;
}

async function leaderboard(yearMonth: string) {
  // 需求：各班月排行前 5 名
  // 門檻：該月閱讀含 2 本以上；排序：能量優先，本數次之；無人達標顯示「從缺」
  //
  // 這裡假設你有一張月增量表 reading_monthly (student_no/account, year_month, energy, books)
  // 若你目前的 import-reading-excel 寫入的是別的表，請把查詢改成對應的 table/view。

  const CLASS_CODES: ClassCode[] = ["101", "201", "301", "401", "501", "601"];

  const out: Record<string, any[]> = {};

  for (const c of CLASS_CODES) {
    const { data, error } = await supabase
      .from("reading_monthly")
      .select("student_no, account, name, energy, books")
      .eq("year_month", yearMonth)
      .eq("class_id", c)
      .gte("books", 2)
      .order("energy", { ascending: false })
      .order("books", { ascending: false })
      .limit(5);

    if (error) throw error;
    out[c] = data ?? [];
  }

  return out;
}

Deno.serve(async (req) => {
  try {
    assertEnv();

    const { pathname, search } = parseUrl(req);

    // CORS
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-admin-key",
          "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        },
      });
    }

    // require admin for everything
    await requireAdmin(req);

    if (req.method === "GET" && pathname === "/users") {
      const users = await listUsers();
      return json({ ok: true, users }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (req.method === "POST" && pathname === "/users") {
      const body = await req.json().catch(() => ({}));
      await createUser(body);
      return json({ ok: true }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (req.method === "DELETE" && pathname.startsWith("/users/")) {
      const account = pathname.slice("/users/".length);
      await deleteUser(account);
      return json({ ok: true }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (req.method === "POST" && pathname === "/students/promote") {
      const body = await req.json().catch(() => ({}));
      const updated = await promoteStudents(body);
      return json({ ok: true, updated }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (req.method === "GET" && pathname === "/leaderboard") {
      const ym = String(search.get("year_month") ?? "").trim();
      if (!/^\d{4}-\d{2}$/.test(ym)) return bad("bad_year_month");
      const classes = await leaderboard(ym);
      return json({ ok: true, year_month: ym, classes }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (req.method === "GET" && pathname === "/export/semester") {
      // 匯出學期/學年總紀錄：回傳已整理好的 rows
      // 這裡假設：
      // - app_users.account = 學生學號（5碼）
      // - reading_totals: 以 account 關聯（FK 或 view）
      // 若你的 schema 不同，請改成對應的表或 view。
      const { data, error } = await supabase
        .from("app_users")
        .select("account, name, class_id, reading_totals(total_energy,total_books)")
        .eq("role", "student")
        .order("class_id", { ascending: true })
        .order("account", { ascending: true });

      if (error) throw error;

      const rows = (data ?? []).map((r: any) => ({
        student_no: r.account,
        account: r.account,
        name: r.name,
        class_id: r.class_id,
        total_energy: r.reading_totals?.total_energy ?? 0,
        total_books: r.reading_totals?.total_books ?? 0,
      }));

      return json({ ok: true, rows }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (req.method === "GET" && pathname === "/teachers") {
      // 給 Login 下拉選單用：遮名
      const { data, error } = await supabase.from("app_users").select("account, name").eq("role", "teacher").order("account");
      if (error) throw error;
      const teachers = (data ?? []).map((t) => ({ account: t.account, display: maskName(t.name) }));
      return json({ ok: true, teachers }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    return bad("not_found", 404);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status = msg === "forbidden" ? 403 : 500;
    return json({ ok: false, error: msg }, { status, headers: { "Access-Control-Allow-Origin": "*" } });
  }
});
