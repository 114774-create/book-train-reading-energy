import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { ThemeEvent } from "@/lib/types";
import { IssueThemeEventRewardsPanel } from "@/components/admin/IssueThemeEventRewardsPanel";

export function ThemeEventsTab() {
  const [events, setEvents] = useState<ThemeEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // 新增活動表單
  const [newEventName, setNewEventName] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [newTargetCount, setNewTargetCount] = useState("1");
  const [newRewardPoints, setNewRewardPoints] = useState("1");

  async function loadEvents() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("theme_events")
        .select("*")
        .order("start_date", { ascending: false });
      if (error) throw error;
      setEvents((data as any) ?? []);
    } catch (e: any) {
      toast.error("讀取活動失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function createEvent() {
    const eventName = newEventName.trim();
    const startDate = newStartDate.trim();
    const endDate = newEndDate.trim();
    const keywords = newKeywords.trim() || null;
    const targetCount = parseInt(newTargetCount, 10) || 1;
    const rewardPoints = parseInt(newRewardPoints, 10) || 1;

    if (!eventName) return toast.error("請輸入活動名稱");
    if (!startDate) return toast.error("請選擇開始日期");
    if (!endDate) return toast.error("請選擇結束日期");
    if (new Date(startDate) > new Date(endDate)) return toast.error("開始日期不能晚於結束日期");
    if (targetCount <= 0) return toast.error("目標本數必須大於 0");
    if (rewardPoints <= 0) return toast.error("獎勵點數必須大於 0");

    const t = toast.loading("新增活動中…");
    try {
      const { error } = await supabase.from("theme_events").insert({
        event_name: eventName,
        start_date: startDate,
        end_date: endDate,
        keywords,
        target_count: targetCount,
        reward_points: rewardPoints,
      });
      if (error) throw error;
      toast.success("活動新增成功");
      setCreateOpen(false);
      setNewEventName("");
      setNewStartDate("");
      setNewEndDate("");
      setNewKeywords("");
      setNewTargetCount("1");
      setNewRewardPoints("1");
      loadEvents();
    } catch (e: any) {
      toast.error("新增失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
    }
  }

  async function deleteEvent(id: string) {
    if (!confirm("確定刪除此活動？")) return;
    const t = toast.loading("刪除中…");
    try {
      const { error } = await supabase.from("theme_events").delete().eq("id", id);
      if (error) throw error;
      toast.success("已刪除");
      loadEvents();
    } catch (e: any) {
      toast.error("刪除失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
    }
  }

  useEffect(() => {
    loadEvents();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>主題活動設定</CardTitle>
          <CardDescription>設定借閱集點獎勵活動，支援關鍵字篩選與多本集點模式</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div />
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>新增活動</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>新增主題活動</DialogTitle>
                  <DialogDescription>設定活動名稱、日期、關鍵字與獎勵</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid gap-1">
                    <Label>活動名稱</Label>
                    <Input
                      value={newEventName}
                      onChange={(e) => setNewEventName(e.target.value)}
                      placeholder="例如：科幻小說閱讀挑戰"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label>開始日期</Label>
                      <Input
                        type="date"
                        value={newStartDate}
                        onChange={(e) => setNewStartDate(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label>結束日期</Label>
                      <Input
                        type="date"
                        value={newEndDate}
                        onChange={(e) => setNewEndDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <Label>關鍵字（多個用逗號分隔，留空或 * 代表不限書目）</Label>
                    <Input
                      value={newKeywords}
                      onChange={(e) => setNewKeywords(e.target.value)}
                      placeholder="例如：科幻,冒險,太空"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label>目標本數</Label>
                      <Input
                        type="number"
                        min="1"
                        value={newTargetCount}
                        onChange={(e) => setNewTargetCount(e.target.value)}
                        placeholder="1"
                      />
                      <p className="text-xs text-muted-foreground">設定為 1 代表每借一本即給獎；設定為 5 代表集滿 5 本才給獎</p>
                    </div>
                    <div className="grid gap-1">
                      <Label>達標獎勵點數</Label>
                      <Input
                        type="number"
                        min="1"
                        value={newRewardPoints}
                        onChange={(e) => setNewRewardPoints(e.target.value)}
                        placeholder="1"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                  <Button onClick={createEvent}>新增</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* 活動列表 */}
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>活動名稱</TableHead>
                  <TableHead>開始日期</TableHead>
                  <TableHead>結束日期</TableHead>
                  <TableHead>關鍵字</TableHead>
                  <TableHead className="text-center">目標本數</TableHead>
                  <TableHead className="text-center">獎勵點數</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-medium">{event.event_name}</TableCell>
                    <TableCell>{event.start_date}</TableCell>
                    <TableCell>{event.end_date}</TableCell>
                    <TableCell className="text-sm">
                      {event.keywords ? (
                        <span className="text-muted-foreground">{event.keywords}</span>
                      ) : (
                        <span className="text-amber-600 font-medium">不限書目</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono">{event.target_count}</TableCell>
                    <TableCell className="text-center font-mono">{event.reward_points}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteEvent(event.id)}
                      >
                        刪除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && events.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      尚無活動設定
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <IssueThemeEventRewardsPanel />
    </div>
  );
}
