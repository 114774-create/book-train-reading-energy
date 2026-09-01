// src/components/admin/IssueThemeEventRewardsPanel.tsx
// 主題活動「發放獎勵」面板：手動觸發，把某個活動「新增達成」的獎勵寫入 Google 試算表（Logs 分頁）

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/customAuth";
import type { ThemeEvent } from "@/lib/types";
import { getUniqueBookCountForEvent, calculateRewardTimes } from "@/lib/themeEventUtils";

interface PendingRow {
  account: string;
  name: string;
  totalTimes: number;
  alreadyIssued: number;
  deltaTimes: number;
}

export function IssueThemeEventRewardsPanel() {
  const [events, setEvents] = useState<ThemeEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);

  async function loadEvents() {
    const { data } = await supabase.from("theme_events").select("*").order("start_date", { ascending: false });
    const list = (data as any) ?? [];
    setEvents(list);
    if (list.length > 0 && !selectedEventId) setSelectedEventId(list[0].id);
  }

  async function loadPending(eventId: string) {
    if (!eventId) return;
    setLoading(true);
    try {
      const event = events.find((e) => e.id === eventId);
      if (!event) return;

      // 該活動期間內有借閱紀錄的學生帳號
      const { data: logs, error: logErr } = await supabase
        .from("borrow_logs")
        .select("student_account")
        .eq("action", "borrow")
        .not("student_account", "is", null)
        .gte("at", `${event.start_date}T00:00:00`)
        .lte("at", `${event.end_date}T23:59:59.999`);
      if (logErr) throw logErr;

      const accounts = [...new Set((logs ?? []).map((l: any) => l.student_account as string))];
      if (accounts.length === 0) {
        setPending([]);
        return;
      }

      const [{ data: users }, { data: rewards }] = await Promise.all([
        supabase.from("app_users").select("account, name").in("account", accounts),
        supabase.from("theme_event_rewards").select("account, times_issued").eq("event_id", eventId).in("account", accounts),
      ]);
      const nameMap: Record<string, string> = {};
      (users ?? []).forEach((u: any) => { nameMap[u.account] = u.name; });
      const issuedMap: Record<string, number> = {};
      (rewards ?? []).forEach((r: any) => { issuedMap[r.account] = r.times_issued; });

      const rows: PendingRow[] = [];
      for (const account of accounts) {
        if (!nameMap[account]) continue; // 已離校（畢業/轉學）的舊帳號不顯示
        const uniqueCount = await getUniqueBookCountForEvent(account, event);
        const totalTimes = calculateRewardTimes(uniqueCount, event.target_count);
        const already = issuedMap[account] ?? 0;
        const delta = Math.max(0, totalTimes - already);
        if (delta > 0) {
          rows.push({ account, name: nameMap[account] ?? account, totalTimes, alreadyIssued: already, deltaTimes: delta });
        }
      }
      setPending(rows);
    } catch (e: any) {
      toast.error("讀取待發放名單失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadEvents(); }, []);
  useEffect(() => { if (selectedEventId && events.length > 0) loadPending(selectedEventId); }, [selectedEventId, events]);

  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const totalPoints = selectedEvent ? pending.reduce((s, r) => s + r.deltaTimes * selectedEvent.reward_points, 0) : 0;

  async function handleIssue() {
    if (!selectedEventId || !selectedEvent) return;
    if (pending.length === 0) return toast.error("目前沒有新增待發放的獎勵");
    if (!confirm(`確定要把「${selectedEvent.event_name}」這 ${pending.length} 位學生的新增獎勵寫入 Google 試算表嗎？`)) return;

    setIssuing(true);
    const t = toast.loading("寫入 Google 試算表中…");
    try {
      const sess = getSession();
      if (!sess) throw new Error("not_logged_in");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/issue-theme-event-rewards`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${sess.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_id: selectedEventId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || res.statusText);

      toast.success(`已發放 ${data.issued} 筆活動獎勵到 Google 試算表`, { id: t });
      await loadPending(selectedEventId);
    } catch (e: any) {
      toast.error("發放失敗：" + String(e?.message ?? e), { id: t });
    } finally {
      setIssuing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base">🎁 發放主題活動獎勵（寫入 Google 試算表）</CardTitle>
            <CardDescription>依活動規則自動算出新增達成次數；已發放過的不會重複計算</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm max-w-[240px]"
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
            >
              {events.length === 0 && <option value="">尚無活動</option>}
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.event_name}（{ev.start_date}~{ev.end_date}）</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => loadPending(selectedEventId)} disabled={loading || !selectedEventId}>
              重新整理
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">尚無主題活動，請先在上方新增</div>
        ) : loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">計算中…</div>
        ) : pending.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            目前沒有新增待發放的獎勵<br />
            <span className="text-xs">（可能還沒人達標，或已經發放過）</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-2xl border bg-amber-50 border-amber-200 px-4 py-3">
              <div className="text-sm">
                <span className="font-bold text-amber-700">{selectedEvent?.event_name}</span> 新增
                <span className="font-bold text-amber-700"> {pending.length} </span>位學生達標，
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
                    <TableHead className="text-right">累積達成次數</TableHead>
                    <TableHead className="text-right">新增次數</TableHead>
                    <TableHead className="text-right">新增點數</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((r) => (
                    <TableRow key={r.account}>
                      <TableCell className="font-mono text-sm">{r.account}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right">{r.totalTimes}</TableCell>
                      <TableCell className="text-right font-bold text-amber-600">{r.deltaTimes}</TableCell>
                      <TableCell className="text-right">{r.deltaTimes * (selectedEvent?.reward_points ?? 0)}</TableCell>
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
