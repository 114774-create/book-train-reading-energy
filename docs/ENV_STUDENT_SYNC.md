# 學生同步功能環境變數設定

## Supabase Edge Function Secrets

在 Supabase Dashboard → Edge Functions → `sync-students` → Secrets 中新增以下變數：

| 變數名稱 | 說明 | 範例值 |
|----------|------|--------|
| `SUPABASE_URL` | Supabase 專案 URL | `https://fppkjmnthxoajgvodksg.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key（完整權限） | `eyJhbGciOi...` |
| `GOOGLE_SHEETS_CREDENTIALS` | Google Service Account JSON（與 admin-tools 相同） | `{"type":"service_account",...}` |
| `STUDENT_LIST_SHEET_ID` | 學生名單試算表 ID | `1DSzB4jo_SWu6QE_HWmNWB4SyQOTjzPmvuy3cdlz4Wi8` |

## Google Sheets 格式

試算表中的 `Students` 工作表應包含以下欄位：

| 欄位 | 標題（A 欄） | 標題（B 欄） | 標題（C 欄） | 標題（D 欄） |
|------|-------------|-------------|-------------|-------------|
| 內容 | id | grade | （任意） | name |

- **A 欄 (id)**：學生帳號（對應 Supabase `app_users.account`）
- **B 欄 (grade)**：班級（對應 Supabase `app_users.class_id`）
- **D 欄 (name)**：姓名（對應 Supabase `app_users.name`）

> 第一列為標題列，資料從第二列開始。標題名稱可為英文或中文，系統會自動辨識。

## 本地開發

若需在本地測試，可在 `.env.local` 中新增：

```
VITE_SUPABASE_URL=https://fppkjmnthxoajgvodksg.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here
STUDENT_LIST_SHEET_ID=1DSzB4jo_SWu6QE_HWmNWB4SyQOTjzPmvuy3cdlz4Wi8
```

注意：`STUDENT_LIST_SHEET_ID` 是前端環境變數（`VITE_` 前綴不需要，因為同步 API 是在 Edge Function 端執行，前端只傳送請求）。
