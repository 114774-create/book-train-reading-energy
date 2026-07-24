-- =============================================
-- PDF 書箱匯入與整批歸還 Schema 更新
-- =============================================
-- 這份 SQL 語法用於支援新的「書箱借閱」功能，包含新增 box_loans 表、
-- 修改 books 表以支援書箱關聯，以及調整 borrow_logs 表。
-- 請在 Supabase Dashboard 的 SQL Editor 中執行以下語法。

-- 1. books 表新增書箱欄位
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS box_code TEXT,
  ADD COLUMN IF NOT EXISTS box_name TEXT;

-- 2. 新增書箱借還事件表
CREATE TABLE IF NOT EXISTS box_loans (
  id BIGSERIAL PRIMARY KEY,
  box_code TEXT NOT NULL,
  box_name TEXT,
  box_category TEXT,
  borrowing_class TEXT,
  representative TEXT,
  book_count INT,
  borrow_date DATE,
  due_date DATE,
  returned_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'borrowed'
    CHECK (status IN ('borrowed', 'returned')),
  source_pdf TEXT,
  created_by TEXT REFERENCES app_users(account),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. borrow_logs 表修改
-- 讓 student_id 可以為空（因為書箱借還不一定對應單一學生）
ALTER TABLE borrow_logs ALTER COLUMN student_id DROP NOT NULL;
-- 新增 box_loan_id 關聯到 box_loans
ALTER TABLE borrow_logs ADD COLUMN IF NOT EXISTS box_loan_id BIGINT REFERENCES box_loans(id);

-- =============================================
-- 4. 啟用 Row Level Security (RLS) 與權限設定
-- =============================================
-- 針對 box_loans 表啟用 RLS
ALTER TABLE box_loans ENABLE ROW LEVEL SECURITY;

-- 確保 admin 擁有完整權限（這裡使用 anon key 存取時需要）
CREATE POLICY "allow_admin_select_box_loans" ON box_loans
  FOR SELECT USING (true);

CREATE POLICY "allow_admin_insert_box_loans" ON box_loans
  FOR INSERT WITH CHECK (true);

CREATE POLICY "allow_admin_update_box_loans" ON box_loans
  FOR UPDATE USING (true);

CREATE POLICY "allow_admin_delete_box_loans" ON box_loans
  FOR DELETE USING (true);

-- 確保 books 表也有適當的更新權限
CREATE POLICY "allow_admin_update_books" ON books
  FOR UPDATE USING (true);

-- 確保 borrow_logs 表也有適當的插入權限
CREATE POLICY "allow_admin_insert_borrow_logs" ON borrow_logs
  FOR INSERT WITH CHECK (true);
