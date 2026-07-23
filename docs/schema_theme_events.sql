-- 建立主題活動設定資料表
CREATE TABLE theme_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    keywords TEXT, -- 多個關鍵字以逗號分隔，空值或 * 代表不限書目
    target_count INTEGER NOT NULL DEFAULT 1, -- 設定為 1 代表每借一本即給獎；設定為 5 代表集滿 5 本才給獎
    reward_points INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 為了支援借閱判定，我們可能需要查詢學生的借閱紀錄
-- 假設既有的借閱紀錄表名為 borrowings，且包含以下欄位：
-- student_id, barcode, borrowed_at
-- 我們需要確保能關聯到書籍名稱 (books 表的 title)

-- 查詢有效活動的範例：
-- SELECT * FROM theme_events WHERE CURRENT_DATE BETWEEN start_date AND end_date;
