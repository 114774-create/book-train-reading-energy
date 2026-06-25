# Admin Tools Edge Function（接續功能）

這個 repo 原本只包含前端；你目前的後端（custom-auth、import-bookbox-pdf、import-reading-excel）已經在 Supabase 上跑起來。

為了**不破壞**既有 `custom-auth`（登入/借還書）流程，我把「人事管理 / 排行榜 / 匯出」做成 **另一支** Edge Function：`admin-tools`，前端用 `src/lib/adminApi.ts` 去呼叫。

## 你需要做的事

1. **在 Supabase 建立/部署 Edge Function**

- 路徑：`supabase/functions/admin-tools/index.ts`
- 部署：
  - `supabase functions deploy admin-tools`

2. **設定 secrets**

在 Supabase Functions 設定：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

（這兩個是 Supabase function 的標準環境變數/secret）

3. **補上管理員驗證（非常重要）**

`admin-tools` 目前的 `requireAdmin()` 有一段 `TODO`：

- 因為此 repo 沒有你現有的 `custom-auth` Edge Function 原始碼，我無法直接對齊你的 token 驗證方式。
- 你需要把 `Bearer token` 解出 `account`，然後查 `app_users.role === 'admin'` 才放行。

> 暫時有提供快速保護方式：設定 `ADMIN_TOOLS_KEY`，並要求前端 header 帶 `x-admin-key`。
> 這只是過渡，最終仍建議沿用你現有的 token。

4. **資料表假設**

人事管理使用：`app_users(account, password, role, name, class_id, created_at, updated_at)`

排行榜使用：`reading_monthly(year_month, class_id, student_no/account, name, energy, books)`

如果你目前的 `import-reading-excel` 寫入的不是 `reading_monthly`，你需要把 `leaderboard()` 查詢的 table/view 改成你的實際表。

---

## 前端已接續完成的部分

- 管理員端新增 Tab：
  - **人事管理**：查詢、新增、移除、學生升年級批次
  - **每月排行榜**：各班前 5 名、從缺顯示

接下來我會在同一個 Tab 架構下，把：
- **匯出 Excel**
- **500 刻度長條圖下載**

補齊（並同樣走 `admin-tools`）。
