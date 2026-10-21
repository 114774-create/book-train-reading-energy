// src/components/admin/IssueHonorCardsPanel.tsx
// 後台「發放榮譽卡」面板：手動觸發，把某月尚未發放的榮譽卡寫入 Google 試算表（Logs 分頁）
// 刻意做成手動按鈕（不是匯入後自動觸發），並用 cards_issued 欄位防止重複發放

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/customAuth";

const CLASS_LABELS: Record<string, string> = {
  "101": "一甲", "201": "二甲", "301": "三甲",
  "401": "四甲", "501": "五甲", "601": "六甲",
};
const POINTS_PER_CARD = 10;

interface PendingRow {
  account: string;
  name: string;
  class_id: string | null;
  cards_earned: number;
  energy_added: number;
  total_energy_snapshot: number;
  prev_energy: number;        // 前月累積能量
  prev_source: "prev_month" | "earlier" | "derived"; // 上個月報表 / 更早的最近一次報表 / 推算
  prev_ym: string | null;     // 取自哪個月份的報表（推算時為 null）
  derived_prev: number;       // 目前累積 − 本月（推算值）
  expected_cards: number;     // 依前月能量推算本月應新增張數
}

// 上一個月（YYYY-MM）
function prevYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function IssueHonorCardsPanel() {
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);

  async function loadMonths() {
    const { data } = await supabase.from("app_reading_monthly").select("year_month");
    const ms = [...new Set((data ?? []).map((r: any) => r.year_month as string))].sort().reverse();
    setMonths(ms);
    if (ms.length > 0 && !selectedMonth) setSelectedMonth(ms[0]);
  }

  async function loadPending(ym: string) {
    if (!ym) return;
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from("app_reading_monthly")
        .select("account, cards_earned, energy_added, total_energy_snapshot")
        .eq("year_month", ym)
        .eq("cards_issued", false)
        .gt("cards_earned", 0);
      if (error) throw error;

      const accounts = (rows ?? []).map((r: any) => r.account);
      let userMap: Record<string, { name: string; class_id: string }> = {};
      if (accounts.length > 0) {
        const { data: users } = await supabase
          .from("app_users")
          .select("account, name, class_id")
          .in("account", accounts);
        (users ?? []).forEach((u: any) => { userMap[u.account] = u; });
      }

      // 每位學生「比本月更早」的最近一次報表累積能量（跟匯入時算榮譽卡用的是同一套規則）
      const prevMap: Record<string, { ym: string; energy: number }> = {};
      if (accounts.length > 0) {
        const { data: prevRows } = await supabase
          .from("app_reading_monthly")
          .select("account, year_month, total_energy_snapshot")
          .lt("year_month", ym)
          .not("total_energy_snapshot", "is", null)
          .in("account", accounts)
          .order("year_month", { ascending: false });
        (prevRows ?? []).forEach((r: any) => {
          // 已依月份由新到舊排序，每個帳號第一筆就是最近一次
          if (!prevMap[r.account]) prevMap[r.account] = { ym: r.year_month, energy: r.total_energy_snapshot as number };
        });
      }
      const exactPrevYm = prevYearMonth(ym);

      const mapped: PendingRow[] = (rows ?? [])
        .filter((r: any) => userMap[r.account]) // 只處理目前仍在學生名單裡的帳號，避免誤發給已離校學生
        .map((r: any) => {
          const total = (r.total_energy_snapshot as number) ?? 0;
          const monthly = (r.energy_added as number) ?? 0;
          const derivedPrev = Math.max(0, total - monthly);
          const found = prevMap[r.account];
          const prevEnergy = found ? found.energy : derivedPrev;
          const source: PendingRow["prev_source"] = !found ? "derived" : found.ym === exactPrevYm ? "prev_month" : "earlier";
          return {
            account: r.account,
            name: userMap[r.account]?.name ?? r.account,
            class_id: userMap[r.account]?.class_id ?? null,
            cards_earned: r.cards_earned,
            energy_added: monthly,
            total_energy_snapshot: total,
            prev_energy: prevEnergy,
            prev_source: source,
            prev_ym: found?.ym ?? null,
            derived_prev: derivedPrev,
            expected_cards: Math.max(0, Math.floor(total / 500) - Math.floor(prevEnergy / 500)),
          };
        }).sort((a, b) => String(a.class_id ?? "").localeCompare(String(b.class_id ?? "")) || a.account.localeCompare(b.account));

      setPending(mapped);
    } catch (e: any) {
      toast.error("讀取待發放榮譽卡失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadMonths(); }, []);
  useEffect(() => { if (selectedMonth) loadPending(selectedMonth); }, [selectedMonth]);

  async function handleIssue() {
    if (!selectedMonth) return;
    if (pending.length === 0) return toast.error("目前沒有待發放的榮譽卡");
    if (!confirm(`確定要把 ${selectedMonth} 這 ${pending.length} 位學生的榮譽卡寫入 Google 試算表嗎？發放後無法在此撤銷。`)) return;

    setIssuing(true);
    const t = toast.loading("寫入 Google 試算表中…");
    try {
      const sess = getSession();
      if (!sess) throw new Error("not_logged_in");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/issue-honor-cards`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${sess.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ year_month: selectedMonth }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || res.statusText);

      toast.success(`已發放 ${data.issued} 筆榮譽卡到 Google 試算表`, { id: t });
      await loadPending(selectedMonth);
    } catch (e: any) {
      toast.error("發放失敗：" + String(e?.message ?? e), { id: t });
    } finally {
      setIssuing(false);
    }
  }

  async function handleMarkIssued() {
    if (!selectedMonth) return;
    if (pending.length === 0) return toast.error("目前沒有待標記的榮譽卡");
    if (!confirm(
      `確定要把 ${selectedMonth} 這 ${pending.length} 位學生標記為「已發放」嗎？\n\n` +
      `⚠️ 這個動作只會標記狀態，不會寫入 Google 試算表。\n` +
      `適用於這批點數你已經用其他方式（例如系統啟用前的基礎資料）發放過的情況，避免之後被系統重複發放。`
    )) return;

    setIssuing(true);
    try {
      const accounts = pending.map((r) => r.account);
      const { error } = await supabase
        .from("app_reading_monthly")
        .update({ cards_issued: true, cards_issued_at: new Date().toISOString() })
        .eq("year_month", selectedMonth)
        .eq("cards_issued", false)
        .in("account", accounts);
      if (error) throw error;

      toast.success(`已將 ${accounts.length} 位學生標記為已發放（未寫入 Google 試算表）`);
      await loadPending(selectedMonth);
    } catch (e: any) {
      toast.error("標記失敗：" + String(e?.message ?? e));
    } finally {
      setIssuing(false);
    }
  }

  const totalPoints = pending.reduce((s, r) => s + r.cards_earned * POINTS_PER_CARD, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base">🏅 發放榮譽卡（寫入 Google 試算表）</CardTitle>
            <CardDescription>
              500 能量＝1 張榮譽卡＝10 點；手動按鈕觸發，已發放過的不會重複列出。
              如果這批點數已經用其他方式發放過（例如系統啟用前的基礎資料），
              用「已發放」只標記狀態、不會重複寫入 Google 試算表。
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {months.length === 0 && <option value="">尚無資料</option>}
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => loadPending(selectedMonth)} disabled={loading || !selectedMonth}>
              重新整理
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!selectedMonth || months.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">尚無月報資料</div>
        ) : pending.length === 0 && !loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {selectedMonth} 目前沒有待發放的榮譽卡<br />
            <span className="text-xs">（可能已經發放過，或該月沒有人新增達標）</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-2xl border bg-amber-50 border-amber-200 px-4 py-3">
              <div className="text-sm">
                <span className="font-bold text-amber-700">{selectedMonth}</span> 待發放
                <span className="font-bold text-amber-700"> {pending.length} </span>位學生，
                共 <span className="font-bold text-amber-700">{totalPoints}</span> 點
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleMarkIssued}
                  disabled={issuing || pending.length === 0}
                  variant="outline"
                >
                  已發放（不寫入試算表）
                </Button>
                <Button onClick={handleIssue} disabled={issuing || pending.length === 0} className="bg-amber-500 hover:bg-amber-600">
                  {issuing ? "發放中…" : "發放到 Google 試算表"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              前月能量 + 本月能量 = 目前累積能量。沒有上個月的報表時，取更早的最近一次報表（標示「取自 YYYY-MM」）；
              完全沒有更早報表時，前月能量 = 目前累積能量 − 本月能量（標示「推算」）。⚠ 表示不一致，滑鼠移上去可看原因。
            </p>
            <div className="overflow-auto max-h-72">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>學號</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>班級</TableHead>
                    <TableHead className="text-right">新增張數</TableHead>
                    <TableHead className="text-right">前月能量</TableHead>
                    <TableHead className="text-right">本月能量</TableHead>
                    <TableHead className="text-right">目前累積能量</TableHead>
                    <TableHead className="text-right">發放點數</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((r) => (
                    <TableRow key={r.account}>
                      <TableCell className="font-mono text-sm">{r.account}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm">{CLASS_LABELS[r.class_id ?? ""] ?? r.class_id ?? ""}</TableCell>
                      <TableCell className="text-right font-bold text-amber-600">
                        {r.cards_earned}
                        {r.expected_cards !== r.cards_earned && (
                          <span
                            className="ml-1 text-amber-600 cursor-help"
                            title={`依前月能量 ${r.prev_energy} 推算，本月應新增 ${r.expected_cards} 張；系統目前記錄 ${r.cards_earned} 張（可能是舊規則算的，重新匯入該月報表即可更新）`}
                          >⚠</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {r.prev_energy}
                        {r.prev_source === "derived" && <span className="ml-1 text-[10px] text-gray-400">推算</span>}
                        {r.prev_source === "earlier" && (
                          <span className="ml-1 text-[10px] text-gray-400">取自{r.prev_ym}</span>
                        )}
                        {r.prev_source === "prev_month" && r.prev_energy !== r.derived_prev && (
                          <span
                            className="ml-1 text-amber-600 cursor-help"
                            title={`前月報表累積為 ${r.prev_energy}，但「目前累積 − 本月」= ${r.derived_prev}，兩者不同，請核對是否有漏報或報表調整`}
                          >⚠</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{r.energy_added}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{r.total_energy_snapshot}</TableCell>
                      <TableCell className="text-right">{r.cards_earned * POINTS_PER_CARD}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
