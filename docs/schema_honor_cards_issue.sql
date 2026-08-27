-- 榮譽卡發放狀態欄位
-- 用途：手動觸發「發放本月新增榮譽卡到 Google 試算表」時，
--       用這個欄位標記哪些月報列已經發放過，避免管理員重複按按鈕造成重複發放。
-- 執行方式：Supabase Dashboard -> SQL Editor -> 貼上執行

ALTER TABLE app_reading_monthly
  ADD COLUMN IF NOT EXISTS cards_issued boolean NOT NULL DEFAULT false;

ALTER TABLE app_reading_monthly
  ADD COLUMN IF NOT EXISTS cards_issued_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_app_reading_monthly_pending_cards
  ON app_reading_monthly (year_month, cards_issued)
  WHERE cards_earned > 0;
