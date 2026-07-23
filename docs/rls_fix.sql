-- =============================================
-- Supabase RLS 權限修復與主題活動資料表建立
-- =============================================
-- 這份 SQL 語法解決了管理員透過前端（local-rpc session）直接呼叫 Supabase 時，
-- 因為沒有 Supabase Auth JWT 而被 Row Level Security (RLS) 擋住寫入的問題。
-- 請在 Supabase Dashboard 的 SQL Editor 中執行以下語法。

-- =============================================
-- 1. 建立主題活動設定資料表 (theme_events)
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
-- 2. 啟用 Row Level Security (RLS)
-- =============================================
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_events ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 3. 設定 app_users 的 RLS 政策
-- =============================================
-- 因為管理員前端使用 anon key 加上自訂的 sessionStorage token (local-rpc) 進行操作，
-- 這意味著 Supabase 資料庫端看到的請求是來自「anon」角色，且沒有 auth.uid()。
-- 為了讓前端能直接讀寫，我們必須開放 anon 角色的權限，或者透過 RPC 函式繞過。
-- 這裡提供直接開放 anon 權限的寫法，以確保前端 UI 能正常運作。

-- 允許任何角色（包含 anon）讀取 app_users（例如登入頁讀取老師名單）
CREATE POLICY "app_users_select_any"
  ON app_users FOR SELECT
  USING (true);

-- 允許任何角色插入 app_users（管理員新增帳號）
CREATE POLICY "app_users_insert_any"
  ON app_users FOR INSERT
  WITH CHECK (true);

-- 允許任何角色更新 app_users（管理員修改帳號、學生升年級等）
CREATE POLICY "app_users_update_any"
  ON app_users FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 允許任何角色刪除 app_users（管理員移除帳號）
CREATE POLICY "app_users_delete_any"
  ON app_users FOR DELETE
  USING (true);

-- =============================================
-- 4. 設定 theme_events 的 RLS 政策
-- =============================================
-- 同樣地，為了讓管理員前端能直接新增與刪除活動，我們開放權限。
-- 實際生產環境中，建議將這些操作封裝在帶有 SECURITY DEFINER 的 RPC 函式中，
-- 並在函式內驗證 local-rpc token 以確保只有管理員能呼叫。

-- 允許任何角色讀取 theme_events（用於查詢有效活動）
CREATE POLICY "theme_events_select_any"
  ON theme_events FOR SELECT
  USING (true);

-- 允許任何角色插入 theme_events（管理員新增活動）
CREATE POLICY "theme_events_insert_any"
  ON theme_events FOR INSERT
  WITH CHECK (true);

-- 允許任何角色更新 theme_events（管理員修改活動）
CREATE POLICY "theme_events_update_any"
  ON theme_events FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- 允許任何角色刪除 theme_events（管理員刪除活動）
CREATE POLICY "theme_events_delete_any"
  ON theme_events FOR DELETE
  USING (true);
