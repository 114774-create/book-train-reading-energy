# Supabase Functions 自動部署（不用本機 Supabase CLI）

你選擇方案 A：使用 **GitHub Actions** 自動部署 Edge Functions。

本 repo 已加入 workflow：
- `.github/workflows/deploy-supabase-functions.yml`

只要你把 PR merge 到 `main`，GitHub Actions 會自動部署：
- `supabase/functions/admin-tools`

> 這個 workflow 也支援手動執行：GitHub → Actions → Deploy Supabase Edge Functions → Run workflow。

---

## 你需要在 GitHub 設定的 Secrets

到 repo：**Settings → Secrets and variables → Actions → New repository secret**

請新增：

1. `SUPABASE_ACCESS_TOKEN`
   - Supabase Dashboard → Account Settings → Access Tokens 建立

2. `SUPABASE_PROJECT_REF`
   - 你的 Supabase URL：`https://fppkjmnthxoajgvodksg.supabase.co/`
   - project ref = `fppkjmnthxoajgvodksg`

---

## admin-tools 需要的 Function Secrets（在 Supabase Dashboard 設定）

到 Supabase Dashboard → Edge Functions → `admin-tools` → **Secrets**：

- `SUPABASE_SERVICE_ROLE_KEY`
- （可選）`ADMIN_TOOLS_KEY`

> 注意：workflow 只負責 deploy 程式碼；Secrets 仍建議在 Dashboard 管理。

---

## 為什麼 deploy 要用 --no-verify-jwt

你目前是自訂登入（custom-auth），前端帶的是「自訂 token」，不是 Supabase Auth 的 JWT。
因此在部署 Edge Function 時要加：

- `--no-verify-jwt`

避免 Supabase gateway 直接把你的請求擋掉。
