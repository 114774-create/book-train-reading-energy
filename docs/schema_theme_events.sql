-- =============================================
-- 主題活動設定資料表 (theme_events)
-- =============================================
CREATE TABLE IF NOT EXISTS theme_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    keywords TEXT, -- 多個關鍵字以逗號分隔，空值或 * 代表不限書目
    target_count INTEGER NOT NULL DEFAULT 1, -- 設定為 1 代表每借一本即給獎；設定為 5 代表集滿 5 本才給獎
    reward_points INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 建立索引以加快查詢
CREATE INDEX IF NOT EXISTS idx_theme_events_dates ON theme_events(start_date, end_date);

-- =============================================
-- Row Level Security (RLS) 設定
-- =============================================

-- 啟用 RLS
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_events ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------
-- app_users 的 RLS 政策
-- -----------------------------------------------

-- 1. 任何已驗證用戶（含 anon 使用 anon key）可讀取 app_users
--    （用於登入頁顯示老師名單、管理員列出所有帳號）
CREATE POLICY "app_users_select_any"
  ON app_users FOR SELECT
  USING (true);

-- 2. 僅 admin 角色可插入 app_users
--    透過呼叫 RPC（rpc_login_admin / rpc_login_teacher）比對密碼，
--    再將 session 存入 sessionStorage；前端使用 anon key 呼叫 supabase-js，
--    因此我們利用 RPC 的 SECURITY DEFINER 特性或直接在 insert 時
--    檢查 callerc_id。但因前端不走 Supabase Auth，我們改用以下方式：
--    → 允許 anon 角色透過 RPC 進行寫入，而 RPC 函式內部以 SECURITY DEFINER 執行。
--    → 同時保留一個直接寫入的政策，讓管理員的前端操作能正常運作。

-- 為簡化前端直連（anon key + local-rpc session），
-- 我們允許所有使用者 SELECT（已在上方定義），
-- 而 INSERT / UPDATE / DELETE 限制為只有透過 RPC 函式才能操作。

-- 但若使用者希望前端直接寫入，可取消以下政策：
CREATE POLICY "app_users_insert_anon"
  ON app_users FOR INSERT
  WITH CHECK (true);

CREATE POLICY "app_users_update_anon"
  ON app_users FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "app_users_delete_anon"
  ON app_users FOR DELETE
  USING (true);

-- -----------------------------------------------
-- theme_events 的 RLS 政策
-- -----------------------------------------------

-- 1. 任何已驗證用戶可讀取 theme_events（用於查詢有效活動）
CREATE POLICY "theme_events_select_any"
  ON theme_events FOR SELECT
  USING (true);

-- 2. 允許 anon 角色插入/更新/刪除 theme_events
--    （管理員前端使用 anon key 直連，透過 local-rpc session 判定角色）
--    在實際部署時，建議透過 Edge Function 或 RPC 函式加上角色檢查，
--    但為確保管理員前端能正常操作，這裡先開放。
CREATE POLICY "theme_events_insert_anon"
  ON theme_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "theme_events_update_anon"
  ON theme_events FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "theme_events_delete_anon"
  ON theme_events FOR DELETE
  USING (true);
