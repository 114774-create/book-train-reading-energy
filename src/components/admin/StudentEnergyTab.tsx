// src/components/admin/StudentEnergyTab.tsx
// 後台學生累積能量分頁

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const CLASS_CODES = ["101","201","301","401","501","601"];
const ENERGY_PER_LEVEL = 500;

interface EnergyRow {
  account: string;
  name: string;
  class_id: string | null;
  total_energy: number;
  total_books: number;
}

export function StudentEnergyTab() {
  const [rows, setRows] = useState<EnergyRow[]>([]);
  const [latestMonth, setLatestMonth] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"energy" | "books" | "account">("energy");

  async function load() {
    setLoading(true);
    try {
      const [{ data: monthly, error: monthlyErr }, { data: users, error: usersErr }] = await Promise.all([
        supabase.from("app_reading_monthly").select("account, year_month, total_energy_snapshot, total_books_snapshot"),
        supabase.from("app_users").select("account, name, class_id").eq("role", "student"),
      ]);

      if (monthlyErr) throw monthlyErr;
      if (usersErr) throw usersErr;

      // 每個學生各自「最新一個月份」的快照值（Excel 裡「學生挖掘總能量/總本數」欄位原始值，
      // 學校自己系統算出來的累積值，含 2026-05 之前手動登記、沒有匯入本系統的歷史）。
      // 不是加總——如果同一個學生有多個月份，永遠以年月最大的那筆為準。
      const latestByAccount: Record<string, { year_month: string; energy: number; books: number }> = {};
      let latest = "";
      for (const r of monthly ?? []) {
        const acc = r.account as string;
        const ym = r.year_month as string;
        if (ym > latest) latest = ym;
        const cur = latestByAccount[acc];
        if (!cur || ym > cur.year_month) {
          latestByAccount[acc] = {
            year_month: ym,
            energy: (r.total_energy_snapshot as number) ?? 0,
            books: (r.total_books_snapshot as number) ?? 0,
          };
        }
      }
      setLatestMonth(latest);

      const userMap = new Map((users ?? []).map((u: any) => [u.account, u]));
      const mapped: EnergyRow[] = Object.entries(latestByAccount).map(([account, v]) => {
        const u = userMap.get(account);
        return {
          account,
          name:         u?.name ?? account,
          class_id:     u?.class_id ?? null,
          total_energy: v.energy,
          total_books:  v.books,
        };
      });
      setRows(mapped);
    } catch (e: any) {
      toast.error("讀取能量資料失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim();
    return rows
      .filter((r) => classFilter === "all" || r.class_id === classFilter)
      .filter((r) => !s || r.name.includes(s) || r.account.includes(s))
      .sort((a, b) => {
        if (sortBy === "energy") return b.total_energy - a.total_energy;
        if (sortBy === "books")  return b.total_books - a.total_books;
        return a.account.localeCompare(b.account);
      });
  }, [rows, q, classFilter, sortBy]);

  // 班級統計
  const classSummary = useMemo(() => {
    return CLASS_CODES.map((c) => {
      const classRows = rows.filter((r) => r.class_id === c);
      const totalEnergy = classRows.reduce((s, r) => s + r.total_energy, 0);
      const totalBooks  = classRows.reduce((s, r) => s + r.total_books, 0);
      return { class_id: c, count: classRows.length, totalEnergy, totalBooks };
    }).filter((c) => c.count > 0);
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* 班級統計卡 */}
      {classSummary.length > 0 && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {classSummary.map((c) => (
            <Card
              key={c.class_id}
              className={`cursor-pointer transition-all ${classFilter === c.class_id ? "ring-2 ring-amber-400" : ""}`}
              onClick={() => setClassFilter(classFilter === c.class_id ? "all" : c.class_id)}
            >
              <CardContent className="pt-4 pb-3 space-y-1">
                <p className="text-xs font-bold text-muted-foreground">{c.class_id} 班</p>
                <p className="text-xl font-extrabold text-amber-500">{c.totalEnergy}</p>
                <p className="text-xs text-muted-foreground">能量 / {c.count} 人 / {c.totalBooks} 本</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 篩選列 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base">⚡ 學生累積能量總覽</CardTitle>
              <CardDescription>
                每 {ENERGY_PER_LEVEL} 能量升一階；直接採用各學生「最新一次月報」的學生挖掘總能量/總本數
                {latestMonth ? <span className="font-mono font-bold text-amber-600"> （最新至 {latestMonth}）</span> : "（尚無資料）"}
                ，含匯入本系統前的歷史紀錄
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                placeholder="搜尋姓名/帳號"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-36"
              />
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
              >
                <option value="all">全部班級</option>
                {CLASS_CODES.map((c) => <option key={c} value={c}>{c} 班</option>)}
              </select>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="energy">能量排序</option>
                <option value="books">本數排序</option>
                <option value="account">學號排序</option>
              </select>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                重新整理
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 && !loading ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              尚無能量資料<br />
              <span className="text-xs">請先到「Excel 月報匯入」匯入月報資料</span>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>帳號</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>班級</TableHead>
                    <TableHead className="text-right">累積能量</TableHead>
                    <TableHead className="text-right">累積本數</TableHead>
                    <TableHead className="text-right">目前階段</TableHead>
                    <TableHead>進度</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r, idx) => {
                    const level = Math.floor(r.total_energy / ENERGY_PER_LEVEL);
                    const progress = (r.total_energy % ENERGY_PER_LEVEL) / ENERGY_PER_LEVEL * 100;
                    return (
                      <TableRow key={r.account}>
                        <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                        <TableCell className="font-mono text-sm">{r.account}</TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="font-mono text-sm">{r.class_id ?? ""}</TableCell>
                        <TableCell className="text-right font-bold text-amber-600">{r.total_energy}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.total_books}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm font-medium">第 {level} 階</span>
                        </TableCell>
                        <TableCell className="w-32">
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-amber-400"
                              style={{ width: `${Math.round(progress)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {r.total_energy % ENERGY_PER_LEVEL}/{ENERGY_PER_LEVEL}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        沒有符合的學生
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}