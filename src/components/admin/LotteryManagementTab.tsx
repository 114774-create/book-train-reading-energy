// src/components/admin/LotteryManagementTab.tsx
// 後台「抽獎管理」分頁：顯示各月各班的抽獎完成狀態與中獎記錄

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const CLASS_CODES = ["101", "201", "301", "401", "501", "601"];
const CLASS_LABELS: Record<string, string> = {
  "101": "一甲", "201": "二甲", "301": "三甲",
  "401": "四甲", "501": "五甲", "601": "六甲",
};

interface LotteryRecord {
  id: number;
  year_month: string;
  class_id: string;
  winner_account: string;
  winner_name: string;
  rank: number;
  drawn_at: string;
}

export function LotteryManagementTab() {
  const [records, setRecords] = useState<LotteryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("lottery_records")
        .select("id, year_month, class_id, winner_account, winner_name, rank, drawn_at")
        .order("year_month", { ascending: false })
        .order("class_id", { ascending: true })
        .order("rank", { ascending: true });
      if (error) throw error;
      setRecords((data ?? []) as LotteryRecord[]);
    } catch (e: any) {
      toast.error("讀取抽獎記錄失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const months = useMemo(() => {
    return [...new Set(records.map(r => r.year_month))].sort().reverse();
  }, [records]);

  useEffect(() => {
    if (selectedMonth === "all" && months.length > 0) setSelectedMonth(months[0]);
  }, [months, selectedMonth]);

  // 該月各班的完成狀態＋中獎人數
  const classStatus = useMemo(() => {
    const monthRecords = records.filter(r => r.year_month === selectedMonth);
    return CLASS_CODES.map(c => {
      const winners = monthRecords.filter(r => r.class_id === c);
      return { class_id: c, done: winners.length > 0, winners };
    });
  }, [records, selectedMonth]);

  // 未分類（class_id 不在已知班級對照表內，例如舊資料或例外狀況）
  const unknownWinners = useMemo(() => {
    return records.filter(r => r.year_month === selectedMonth && !CLASS_LABELS[r.class_id]);
  }, [records, selectedMonth]);

  const monthWinnerCount = useMemo(
    () => records.filter(r => r.year_month === selectedMonth).length,
    [records, selectedMonth]
  );

  async function handleDeleteRecord(id: number) {
    if (!confirm("確定要刪除這筆中獎記錄嗎？")) return;
    const { error } = await supabase.from("lottery_records").delete().eq("id", id);
    if (error) {
      toast.error("刪除失敗：" + String(error.message ?? error));
    } else {
      toast.success("已刪除");
      load();
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base">🎰 抽獎管理總覽</CardTitle>
              <CardDescription>各月、各班的抽獎完成狀態與中獎記錄（資料來自 lottery_records）</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                {months.length === 0 && <option value="all">尚無資料</option>}
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                重新整理
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {records.length === 0 && !loading ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              尚無任何抽獎記錄<br />
              <span className="text-xs">請先到「PDF 書箱匯入」上方按下「🎰 開啟抽獎系統」進行抽獎</span>
            </div>
          ) : (
            <>
              {/* 各班完成狀態卡片 */}
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-4">
                {classStatus.map((c) => (
                  <Card
                    key={c.class_id}
                    className={c.done ? "border-emerald-300 bg-emerald-50/60" : "border-dashed"}
                  >
                    <CardContent className="pt-4 pb-3 space-y-1">
                      <p className="text-xs font-bold text-muted-foreground">{CLASS_LABELS[c.class_id]}（{c.class_id}）</p>
                      <p className={`text-xl font-extrabold ${c.done ? "text-emerald-600" : "text-gray-300"}`}>
                        {c.done ? "✅ 已抽獎" : "⏳ 未抽獎"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.done ? `已中獎 ${c.winners.length} 人` : "尚無中獎記錄"}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <p className="text-xs text-muted-foreground mb-2">
                {selectedMonth} 共 {monthWinnerCount} 筆中獎記錄
              </p>

              {/* 中獎名單明細 */}
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">名次</TableHead>
                      <TableHead>班級</TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>學號</TableHead>
                      <TableHead>抽獎時間</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records
                      .filter(r => r.year_month === selectedMonth)
                      .map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-bold text-amber-600">{r.rank}</TableCell>
                          <TableCell>{CLASS_LABELS[r.class_id] ?? r.class_id}</TableCell>
                          <TableCell className="font-medium">{r.winner_name}</TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">{r.winner_account}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(r.drawn_at).toLocaleString("zh-TW")}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteRecord(r.id)}>
                              刪除
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    {monthWinnerCount === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          該月尚無中獎記錄
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {unknownWinners.length > 0 && (
                <p className="text-xs text-amber-600 mt-2">
                  ⚠️ 有 {unknownWinners.length} 筆記錄的班級代碼無法對照，請檢查資料
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
