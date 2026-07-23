# 主題活動集點獎勵功能部署指南

本文件說明如何在 Vercel 上部署「彈性關鍵字借閱集點獎勵」功能，包括 Google Sheets 跨系統寫入的設定。

---

## 一、Supabase 資料表設定

### 1.1 建立 `theme_events` 資料表

在 Supabase 的 SQL Editor 中執行以下 SQL：

```sql
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

-- 建立索引以加快查詢
CREATE INDEX idx_theme_events_dates ON theme_events(start_date, end_date);
```

### 1.2 確保 `books` 表包含必要欄位

確認 `books` 表包含以下欄位：
- `barcode` (TEXT, PRIMARY KEY)
- `title` (TEXT)
- `status` (TEXT: 'available' 或 'borrowed')
- `borrowed_by` (TEXT, 學生 ID)
- `borrowed_at` (TIMESTAMPTZ)

如果缺少 `borrowed_by` 或 `borrowed_at` 欄位，請執行：

```sql
ALTER TABLE books ADD COLUMN borrowed_by TEXT;
ALTER TABLE books ADD COLUMN borrowed_at TIMESTAMPTZ;
```

---

## 二、Google Sheets 設定

### 2.1 建立 Google Service Account

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案或選擇現有專案
3. 啟用 **Google Sheets API**
4. 前往 **服務帳戶** → 建立新的服務帳戶
5. 下載 JSON 金鑰檔案

### 2.2 建立 Google 試算表

1. 在 Google Drive 中建立新的試算表
2. 命名為「布可列車獎勵日誌」（或任意名稱）
3. 建立名為 **Logs** 的工作表（Worksheet）
4. 在第一列添加標題行：
   - A1: `Time`
   - B1: `Student ID`
   - C1: `Points`
   - D1: `Reason`
   - E1: `Teacher`

### 2.3 授予服務帳戶存取權限

1. 複製試算表的 ID（從 URL 中提取）
2. 在試算表中點擊「共用」
3. 將服務帳戶的電子郵件地址新增為編輯者

---

## 三、Vercel 環境變數設定

### 3.1 準備環境變數

在 Vercel 部署前，準備以下環境變數：

| 環境變數名稱 | 說明 | 範例 |
|---|---|---|
| `SUPABASE_URL` | Supabase 專案 URL | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | `eyJhbGc...` |
| `GOOGLE_SHEETS_CREDENTIALS` | Google Service Account JSON（字串格式） | `{"type": "service_account", ...}` |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Google 試算表 ID | `1a2b3c4d5e6f...` |

### 3.2 轉換 Google Service Account JSON 為字串

由於 Vercel 環境變數需要是字串格式，請將 JSON 檔案轉換為單行字串：

**方法 1：使用 Python**
```python
import json

with open("service-account-key.json", "r") as f:
    creds = json.load(f)

# 輸出為單行字串
print(json.dumps(creds))
```

**方法 2：使用 Node.js**
```javascript
const fs = require("fs");
const creds = JSON.parse(fs.readFileSync("service-account-key.json", "utf-8"));
console.log(JSON.stringify(creds));
```

複製輸出的字串，這就是 `GOOGLE_SHEETS_CREDENTIALS` 的值。

### 3.3 在 Vercel Dashboard 中設定環境變數

1. 前往 Vercel Dashboard → 選擇專案
2. 進入 **Settings** → **Environment Variables**
3. 新增以下環境變數：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_SHEETS_CREDENTIALS` （貼上轉換後的 JSON 字串）
   - `GOOGLE_SHEETS_SPREADSHEET_ID`

4. 確保這些變數在 **Production** 環境中可用

---

## 四、前端修改（借閱 API 呼叫）

### 4.1 更新 StudentDashboard.tsx

修改 `src/pages/student/StudentDashboard.tsx` 中的 `borrow` 函式，以處理新的獎勵回應：

```typescript
async function borrow(barcode: string) {
  const t = toast.loading("借閱處理中…");
  try {
    const response = await api<{
      ok: boolean;
      message: string;
      rewards: Array<{
        event_name: string;
        points?: number;
        unique_count?: number;
        target_count?: number;
        progress?: number;
        message?: string;
      }>;
    }>("/borrow", { method: "POST", body: JSON.stringify({ barcode, student_id: studentId }) });

    if (response.rewards && response.rewards.length > 0) {
      for (const reward of response.rewards) {
        if (reward.points) {
          // 達成獎勵
          toast.success(
            `🎉 恭喜！達成「${reward.event_name}」目標，獲得 ${reward.points} 點！`
          );
        } else if (reward.progress) {
          // 進度提示
          toast.info(
            `📚 ${reward.message || `「${reward.event_name}」進度：目前已收集 ${reward.progress} 本，加油！`}`
          );
        }
      }
    } else {
      toast.success("借閱成功");
    }

    load();
  } catch (e: any) {
    toast.error(String(e?.message ?? e));
  } finally {
    toast.dismiss(t);
  }
}
```

---

## 五、部署步驟

### 5.1 本機測試

1. 安裝依賴：
   ```bash
   pip install -r requirements.txt
   ```

2. 設定本機環境變數（`.env.local`）：
   ```
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   GOOGLE_SHEETS_CREDENTIALS={"type":"service_account",...}
   GOOGLE_SHEETS_SPREADSHEET_ID=1a2b3c4d5e6f...
   ```

3. 測試 API 端點（使用 curl 或 Postman）

### 5.2 部署到 Vercel

1. 推送程式碼到 GitHub：
   ```bash
   git add .
   git commit -m "feat: add theme event rewards with Google Sheets integration"
   git push origin feature-theme-events
   ```

2. 在 GitHub 上建立 Pull Request

3. 在 Vercel Dashboard 中確認環境變數已設定

4. 合併 PR 到 main 分支，Vercel 會自動部署

### 5.3 驗證部署

1. 前往 Vercel 部署的 URL
2. 測試借閱功能，確認獎勵邏輯正常運作
3. 檢查 Google Sheets 中的 Logs 工作表，確認記錄已寫入

---

## 六、故障排除

### 問題 1：Google Sheets 寫入失敗

**原因**：
- 服務帳戶沒有試算表的存取權限
- 試算表 ID 不正確
- JSON 認證字串格式錯誤

**解決方案**：
1. 確認服務帳戶電子郵件已被新增為試算表的編輯者
2. 檢查試算表 ID 是否正確
3. 驗證 `GOOGLE_SHEETS_CREDENTIALS` 環境變數是否為有效的 JSON 字串

### 問題 2：Supabase 查詢失敗

**原因**：
- Service Role Key 不正確
- 資料表不存在

**解決方案**：
1. 確認 `SUPABASE_SERVICE_ROLE_KEY` 正確
2. 在 Supabase Dashboard 中驗證 `theme_events` 和 `books` 表是否存在

### 問題 3：借閱 API 返回 500 錯誤

**原因**：
- Python 依賴未安裝
- 環境變數未正確設定

**解決方案**：
1. 檢查 Vercel 部署日誌
2. 確認 `requirements.txt` 中的所有依賴已安裝
3. 驗證環境變數在 Vercel Dashboard 中已設定

---

## 七、安全建議

1. **不要在程式碼中硬編碼敏感資訊**（API 金鑰、試算表 ID 等）
2. **使用 Vercel 環境變數**管理所有敏感資訊
3. **定期輪換 Google Service Account 金鑰**
4. **限制 Service Account 的權限**，只授予必要的 Google Sheets API 存取權
5. **監控 Google Sheets 的存取日誌**，確認沒有未授權的存取

---

## 八、後續改進

1. **批次寫入 Google Sheets**：改進目前的單行寫入邏輯，以提高效能
2. **錯誤重試機制**：為 Google Sheets 寫入添加重試邏輯
3. **活動進度儀表板**：在前端顯示學生的活動進度
4. **活動統計報告**：生成每個活動的參與統計
