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
        .select("account, cards_earned")
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

      const mapped: PendingRow[] = (rows ?? []).map((r: any) => ({
        account: r.account,
        name: userMap[r.account]?.name ?? r.account,
        class_id: userMap[r.account]?.class_id ?? null,
        cards_earned: r.cards_earned,
      })).sort((a, b) => String(a.class_id ?? "").localeCompare(String(b.class_id ?? "")) || a.account.localeCompare(b.account));

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

  const totalPoints = pending.reduce((s, r) => s + r.cards_earned * POINTS_PER_CARD, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base">🏅 發放榮譽卡（寫入 Google 試算表）</CardTitle>
            <CardDescription>
              500 能量＝1 張榮譽卡＝10 點；手動按鈕觸發，已發放過的不會重複列出
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
              <Button onClick={handleIssue} disabled={issuing || pending.length === 0} className="bg-amber-500 hover:bg-amber-600">
                {issuing ? "發放中…" : "發放到 Google 試算表"}
              </Button>
            </div>
            <div className="overflow-auto max-h-72">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>學號</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>班級</TableHead>
                    <TableHead className="text-right">新增張數</TableHead>
                    <TableHead className="text-right">點數</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((r) => (
                    <TableRow key={r.account}>
                      <TableCell className="font-mono text-sm">{r.account}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm">{CLASS_LABELS[r.class_id ?? ""] ?? r.class_id ?? ""}</TableCell>
                      <TableCell className="text-right font-bold text-amber-600">{r.cards_earned}</TableCell>
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
