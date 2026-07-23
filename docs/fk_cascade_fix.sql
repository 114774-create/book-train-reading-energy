-- =============================================
-- Foreign Key Cascade 修復與安全性提升
-- =============================================
-- 這份 SQL 語法用於解決管理員在修改或刪除 `app_users`（師生帳號）時，
-- 因為 `borrow_records` 等相關表綁定了該帳號，而導致資料庫報錯崩潰的問題。
-- 透過將 Foreign Key 的更新與刪除行為設定為 `CASCADE`，
-- 當學生帳號被刪除（例如畢業生清理）或修改（例如更正學號）時，
-- 歷史借閱紀錄會自動跟著更新，不會產生孤兒資料或阻斷寫入。
-- 請在 Supabase Dashboard 的 SQL Editor 中執行以下語法。

-- =============================================
-- 1. 備份與重建 borrow_records 的 FK 約束
-- =============================================
-- 假設 borrow_records 表中 student_id 或 account 欄位綁定了 app_users
-- 請先找出該 FK 的名稱並刪除，再重新建立為 CASCADE 版本

-- 步驟 1：找出目前的 FK 名稱（可先執行以下語法查看，或直接使用步驟 2 的預設名稱）
SELECT
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'borrow_records';

-- 步驟 2：刪除舊的 FK（如果存在）
-- 請將 'borrow_records_student_id_fkey' 替換為實際查到的 FK 名稱
ALTER TABLE borrow_records DROP CONSTRAINT IF EXISTS borrow_records_student_id_fkey;
ALTER TABLE borrow_records DROP CONSTRAINT IF EXISTS borrow_records_account_fkey;

-- 步驟 3：重新建立 CASCADE 版本的 FK
ALTER TABLE borrow_records 
  ADD CONSTRAINT borrow_records_student_id_fkey
  FOREIGN KEY (student_id) 
  REFERENCES app_users(account) 
  ON DELETE CASCADE 
  ON UPDATE CASCADE;

-- 如果有另一個欄位（例如 account）也綁定了 app_users，請重複上述步驟：
-- ALTER TABLE borrow_records DROP CONSTRAINT IF EXISTS borrow_records_account_fkey;
-- ALTER TABLE borrow_records 
--   ADD CONSTRAINT borrow_records_account_fkey
--   FOREIGN KEY (account) 
--   REFERENCES app_users(account) 
--   ON DELETE CASCADE 
--   ON UPDATE CASCADE;

-- =============================================
-- 2. 備份與重建 reading_monthly 的 FK 約束
-- =============================================
-- 同樣地，每月閱讀紀錄也可能綁定了 app_users

-- 步驟 1：刪除舊的 FK
ALTER TABLE reading_monthly DROP CONSTRAINT IF EXISTS reading_monthly_student_no_fkey;
ALTER TABLE reading_monthly DROP CONSTRAINT IF EXISTS reading_monthly_account_fkey;

-- 步驟 2：重新建立 CASCADE 版本的 FK
ALTER TABLE reading_monthly 
  ADD CONSTRAINT reading_monthly_student_no_fkey
  FOREIGN KEY (student_no) 
  REFERENCES app_users(account) 
  ON DELETE CASCADE 
  ON UPDATE CASCADE;

-- =============================================
-- 3. 備份與重建其他可能相關的表
-- =============================================
-- 如果您的系統中還有其他表（例如 theme_event_rewards）綁定了 app_users，
-- 請參考以下語法進行修改：

-- ALTER TABLE theme_event_rewards DROP CONSTRAINT IF EXISTS theme_event_rewards_account_fkey;
-- ALTER TABLE theme_event_rewards 
--   ADD CONSTRAINT theme_event_rewards_account_fkey
--   FOREIGN KEY (account) 
--   REFERENCES app_users(account) 
--   ON DELETE CASCADE 
--   ON UPDATE CASCADE;
