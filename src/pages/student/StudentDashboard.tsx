import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/customAuth";
import type { Book } from "@/lib/types";

const ENERGY_PER_LEVEL = 500;

interface ThemeEvent {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  keywords: string | null;
  target_count: number;
  reward_points: number;
}

export default function StudentDashboard() {
  const sess = getSession();
  const account = sess?.user?.account ?? null;
  const classId = sess?.user?.class_id ?? null;
  const studentName = sess?.user?.name ?? "";

  const [books, setBooks] = useState<Book[]>([]);
  const [totalEnergy, setTotalEnergy] = useState<number>(0);
  const [totalBooks, setTotalBooks] = useState<number>(0);
  const [events, setEvents] = useState<ThemeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  async function load() {
    if (!classId) return;
    setLoading(true);
    try {
      // 讀本班書籍
      const { data: bookData, error: bookErr } = await supabase
        .from("books")
        .select("barcode, title, author, borrowing_class, return_date, status, borrowed_by, borrowed_at")
        .eq("borrowing_class", classId)
        .order("barcode");
      if (bookErr) throw bookErr;
      setBooks((bookData as Book[]) ?? []);

      // 讀學生累積能量（從 app_reading_totals 表）
      if (account) {
        const { data: totals } = await supabase
          .from("app_reading_totals")
          .select("total_energy, total_books")
          .eq("account", account)
          .maybeSingle();
        setTotalEnergy(totals?.total_energy ?? 0);
        setTotalBooks(totals?.total_books ?? 0);
      }

      // 讀目前進行中的主題活動
      const today = new Date().toISOString().slice(0, 10);
      const { data: eventData } = await supabase
        .from("theme_events")
        .select("id, event_name, start_date, end_date, keywords, target_count, reward_points")
        .lte("start_date", today)
        .gte("end_date", today);
      setEvents((eventData as ThemeEvent[]) ?? []);
    } catch (e: any) {
      toast.error("讀取資料失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [classId, account]);

  // 自己借的書
  const myBooks = useMemo(
    () => books.filter((b) => b.borrowed_by === account),
    [books, account]
  );

  // 本班其他書籍（不是自己借的）
  const filtered = useMemo(() => {
    const s = q.trim();
    const others = books.filter((b) => b.borrowed_by !== account);
    if (!s) return others;
    return others.filter((b) =>
      (b.barcode + b.title + (b.author ?? "")).includes(s)
    );
  }, [books, account, q]);

  // 能量計算
  const currentLevel = Math.floor(totalEnergy / ENERGY_PER_LEVEL);
  const energyInCurrentLevel = totalEnergy % ENERGY_PER_LEVEL;
  const progressPercent = Math.round((energyInCurrentLevel / ENERGY_PER_LEVEL) * 100);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* 歡迎橫幅 */}
      <Card className="overflow-hidden">
        <div className="relative p-6 md:p-7 bg-[radial-gradient(circle_at_20%_20%,rgba(251,191,36,0.35),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(34,211,238,0.35),transparent_45%),radial-gradient(circle_at_70%_90%,rgba(167,139,250,0.35),transparent_45%)]">
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div>
              <div className="text-sm font-bold text-muted-foreground">🚂 布可列車</div>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">
                {studentName ? `${studentName}，歡迎回來！` : "歡迎回來！"} 📚
              </h2>
              <p className="text-sm text-muted-foreground mt-2">查看你的借閱狀況與本班書單。</p>
            </div>
            <div className="shrink-0">
              <div className="h-16 w-16 md:h-20 md:w-20 rounded-3xl bg-white/70 border shadow-[0_18px_45px_-28px_rgba(245,158,11,0.35)] flex items-center justify-center text-4xl">⭐</div>
            </div>
          </div>
        </div>
      </Card>

      {/* 布可能量 + 活動任務 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* 能量卡 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">⚡ 我的布可能量</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end gap-3">
              <span className="text-4xl font-extrabold text-amber-500">{totalEnergy}</span>
              <span className="text-sm text-muted-foreground mb-1">能量 / 累計 {totalBooks} 本</span>
            </div>
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>第 {currentLevel} 階</span>
                <span>距下一階還差 {ENERGY_PER_LEVEL - energyInCurrentLevel} 能量</span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-400 transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>{energyInCurrentLevel} / {ENERGY_PER_LEVEL}</span>
                <span>{progressPercent}%</span>
              </div>
            </div>
            {totalEnergy === 0 && (
              <p className="text-xs text-muted-foreground">能量由老師每月匯入報表後更新</p>
            )}
          </CardContent>
        </Card>

        {/* 活動任務卡 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">🎯 目前活動任務</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                目前沒有進行中的活動<br />
                <span className="text-xs">活動開始後會在這裡顯示任務進度</span>
              </div>
            ) : (
              <div className="space-y-3">
                {events.map((ev) => (
                  <div key={ev.id} className="rounded-lg border p-3 space-y-1">
                    <div className="font-semibold text-sm">{ev.event_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {ev.start_date} ～ {ev.end_date}
                    </div>
                    {ev.keywords && (
                      <div className="text-xs">關鍵字：{ev.keywords}</div>
                    )}
                    <div className="text-xs text-amber-600 font-medium">
                      目標 {ev.target_count} 本 → 獎勵 {ev.reward_points} 點
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 我借的書 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">📖 我目前借的書（{myBooks.length} 本）</CardTitle>
        </CardHeader>
        <CardContent>
          {myBooks.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">你目前沒有借閱中的書籍</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>登錄號</TableHead>
                    <TableHead>書名</TableHead>
                    <TableHead className="hidden md:table-cell">作者</TableHead>
                    <TableHead>借出時間</TableHead>
                    <TableHead>應還日期</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myBooks.map((b) => (
                    <TableRow key={b.barcode}>
                      <TableCell className="font-mono text-sm">{b.barcode}</TableCell>
                      <TableCell className="max-w-[14rem] truncate">{b.title}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {b.author ?? ""}
                      </TableCell>
                      <TableCell className="text-sm">
                        {b.borrowed_at
                          ? new Date(b.borrowed_at).toLocaleString("zh-TW", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-red-600">
                        {b.return_date ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 本班其他書籍 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold">📚 本班其他書籍狀況</h3>
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋：登錄號/書名/作者"
            className="w-56"
          />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            重新整理
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>登錄號</TableHead>
                  <TableHead>書名</TableHead>
                  <TableHead className="hidden md:table-cell">作者</TableHead>
                  <TableHead>狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b) => (
                  <TableRow key={b.barcode}>
                    <TableCell className="font-mono text-sm">{b.barcode}</TableCell>
                    <TableCell className="max-w-[14rem] truncate">{b.title}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {b.author ?? ""}
                    </TableCell>
                    <TableCell>
                      {b.status === "available" ? (
                        <span className="text-green-600 text-sm font-medium">可借閱</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">已借出</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      {books.length === 0 ? "本班尚無書箱資料" : "沒有符合的書籍"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
