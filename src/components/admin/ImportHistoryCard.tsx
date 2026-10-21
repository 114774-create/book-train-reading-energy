// src/components/admin/ImportHistoryCard.tsx
// 「已上傳月份歷史紀錄」：除了原本的匯入筆數之外，多一欄「未於月報內學生」——
// 學生名單裡有、但該月月報完全沒出現的學生（通常代表該生在學校原始系統的 OpenID 對應有問題），
// 可展開查看，並一鍵匯出 Excel 給人事主任確認或通知班級導師。

import { Fragment, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const CLASS_LABELS: Record<string, string> = {
  "101": "一甲", "201": "二甲", "301": "三甲",
  "401": "四甲", "501": "五甲", "601": "六甲",
};

function classText(classId: string | null): string {
  if (!classId) return "（無班級）";
  return CLASS_LABELS[classId] ? `${CLASS_LABELS[classId]}（${classId}）` : classId;
}

interface HistoryRow {
  ym: string;
  processed: number;
  not_found: number;
  at: string;
}

interface MissingStudent {
  account: string;
  name: string;
  class_id: string | null;
}

function sortStudents(list: MissingStudent[]): MissingStudent[] {
  return [...list].sort(
    (a, b) =>
      String(a.class_id ?? "").localeCompare(String(b.class_id ?? "")) ||
      a.account.localeCompare(b.account)
  );
}

export function ImportHistoryCard({ rows }: { rows: HistoryRow[] }) {
  // ym -> 該月月報沒出現的學生；null 表示計算中或失敗
  const [missing, setMissing] = useState<Record<string, MissingStudent[]> | null>(null);
  // class_id -> 導師姓名（多位以「、」連接）
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (rows.length === 0) {
        setMissing({});
        return;
      }
      setMissing(null);
      try {
        const [stuRes, tchRes] = await Promise.all([
          supabase.from("app_users").select("account, name, class_id").eq("role", "student"),
          supabase.from("app_users").select("name, class_id").eq("role", "teacher"),
        ]);
        if (stuRes.error) throw stuRes.error;
        const students = (stuRes.data ?? []) as MissingStudent[];

        const teacherMap: Record<string, string[]> = {};
        (tchRes.data ?? []).forEach((t: any) => {
          if (!t.class_id) return;
          (teacherMap[t.class_id] ??= []).push(t.name);
        });

        // 逐月查（每月筆數遠小於 PostgREST 單次 1000 筆上限）
        const perMonth = await Promise.all(
          rows.map(async (r) => {
            const { data, error } = await supabase
              .from("app_reading_monthly")
              .select("account")
              .eq("year_month", r.ym);
            if (error) throw error;
            return [r.ym, new Set((data ?? []).map((x: any) => x.account as string))] as const;
          })
        );

        const result: Record<string, MissingStudent[]> = {};
        for (const [ym, present] of perMonth) {
          result[ym] = sortStudents(students.filter((s) => !present.has(s.account)));
        }

        if (!cancelled) {
          setTeachers(Object.fromEntries(Object.entries(teacherMap).map(([k, v]) => [k, v.join("、")])));
          setMissing(result);
        }
      } catch (e: any) {
        if (!cancelled) {
          setMissing(null);
          toast.error("計算「未於月報內學生」失敗：" + String(e?.message ?? e));
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [rows]);

  function exportMissing(ym: string) {
    const list = missing?.[ym] ?? [];
    if (list.length === 0) return toast.error(`${ym} 沒有需要匯出的名單`);

    const aoa: (string | number)[][] = [
      ["年月", "班級", "帳號", "姓名", "班級導師", "備註"],
      ...list.map((s) => [ym, classText(s.class_id), s.account, s.name, teachers[s.class_id ?? ""] ?? "", ""]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "未於月報內學生");
    XLSX.writeFile(wb, `未於月報內學生_${ym}.xlsx`);
    toast.success(`已匯出 ${ym}，共 ${list.length} 位`);
  }

  // 展開時依班級分組顯示
  function renderGrouped(list: MissingStudent[]) {
    const groups: Record<string, MissingStudent[]> = {};
    list.forEach((s) => { (groups[s.class_id ?? ""] ??= []).push(s); });
    return Object.entries(groups).map(([classId, members]) => (
      <div key={classId} className="text-sm">
        <span className="font-medium">{classText(classId || null)}</span>
        {teachers[classId] && <span className="text-muted-foreground">　導師：{teachers[classId]}</span>}
        <span className="text-muted-foreground">　→　</span>
        {members.map((m) => `${m.name}（${m.account}）`).join("、")}
      </div>
    ));
  }

  const sorted = [...rows].sort((a, b) => b.ym.localeCompare(a.ym));

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">📋 已上傳月份歷史紀錄</CardTitle>
        <CardDescription>同月份重複匯入會自動覆蓋原資料；此清單會持續保留，與登入狀態無關</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">尚未匯入過任何月份報表</div>
        ) : (
          <>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>年月</TableHead>
                    <TableHead className="text-right">處理筆數</TableHead>
                    <TableHead className="text-right">
                      未找到學生
                      <div className="text-xs font-normal text-muted-foreground">月報有、名單無（可忽略）</div>
                    </TableHead>
                    <TableHead>
                      未於月報內學生
                      <div className="text-xs font-normal text-muted-foreground">名單有、月報無（需確認）</div>
                    </TableHead>
                    <TableHead>匯入時間</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((h) => {
                    const list = missing?.[h.ym];
                    const isOpen = expanded === h.ym;
                    return (
                      <Fragment key={h.ym}>
                        <TableRow>
                          <TableCell className="font-mono font-medium">{h.ym}</TableCell>
                          <TableCell className="text-right font-medium">{h.processed}</TableCell>
                          <TableCell className="text-right">
                            {h.not_found > 0 ? (
                              <span className="text-red-600 font-medium">{h.not_found}</span>
                            ) : (
                              <span className="text-green-600">0 ✓</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {list === undefined ? (
                              <span className="text-xs text-muted-foreground">計算中…</span>
                            ) : list.length === 0 ? (
                              <span className="text-green-600">0 ✓</span>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  className="text-red-600 font-medium underline underline-offset-2"
                                  onClick={() => setExpanded(isOpen ? null : h.ym)}
                                >
                                  {list.length} 位 {isOpen ? "▴" : "▾"}
                                </button>
                                <Button size="sm" variant="outline" onClick={() => exportMissing(h.ym)}>
                                  匯出名單
                                </Button>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{h.at}</TableCell>
                        </TableRow>
                        {isOpen && list && list.length > 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-red-50/50">
                              <div className="space-y-1 py-1">{renderGrouped(list)}</div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              「未於月報內學生」是拿「目前學生名單」去比對各月月報。升年級或新生入學前匯入的月份，
              名單可能包含當時還沒入學、或帳號不同的學生，判斷是否異常請以最新一個月為準。
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
