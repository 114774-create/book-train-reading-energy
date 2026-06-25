import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import type { AppUserRow, ClassCode, UserRole } from "@/lib/types";
import { getSession } from "@/lib/customAuth";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const b64 = s.split(",")[1];
      if (!b64) reject(new Error("bad_file"));
      else resolve(b64);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

const CLASS_CODES: ClassCode[] = ["101", "201", "301", "401", "501", "601"];

function nextClass(code: ClassCode): ClassCode {
  const i = CLASS_CODES.indexOf(code);
  return CLASS_CODES[Math.min(CLASS_CODES.length - 1, i + 1)] ?? code;
}

function maskName(name: string) {
  const s = name.trim();
  if (!s) return "";
  if (s.length === 1) return s;
  if (s.length === 2) return s[0] + "O";
  return s[0] + "O" + s[s.length - 1];
}

export default function AdminDashboard() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [excel, setExcel] = useState<File | null>(null);
  const [yearMonth, setYearMonth] = useState("");
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState<{ student_no: string; name: string }[]>([]);

  // 人事管理
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [uq, setUq] = useState("");
  const [uRole, setURole] = useState<UserRole | "all">("all");
  const [uClass, setUClass] = useState<ClassCode | "all">("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [newRole, setNewRole] = useState<UserRole>("student");
  const [newAccount, setNewAccount] = useState("");
  const [newName, setNewName] = useState("");
  const [newClass, setNewClass] = useState<ClassCode>("101");
  const [newPassword, setNewPassword] = useState("");

  const [promoteFrom, setPromoteFrom] = useState<ClassCode>("101");
  const [promoteTo, setPromoteTo] = useState<ClassCode>("201");

  // 排行榜
  const [lbYm, setLbYm] = useState("");
  const [leaderboard, setLeaderboard] = useState<any>(null);

  const ymDefault = useMemo(() => {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, []);

  useEffect(() => {
    setLbYm(ymDefault);
  }, [ymDefault]);

  async function importPdf() {
    if (!pdf) return toast.error("請選擇 PDF");
    setLoading(true);
    const t = toast.loading("解析 PDF 並匯入中…");
    try {
      const pdf_base64 = await fileToBase64(pdf);
      const sess = getSession();
      if (!sess) throw new Error("not_logged_in");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-bookbox-pdf`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${sess.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pdf_base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      toast.success(`完成：${data.imported} 本（班級 ${data.borrowing_class}）`);
    } catch (e: any) {
      toast.error("匯入失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
      setLoading(false);
    }
  }

  function normalizeHeader(s: string) {
    return s.replace(/\s+/g, "").trim();
  }

  function parseMonthlyExcel(file: File): Promise<{ year_month: string; rows: any[] }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        try {
          const data = new Uint8Array(reader.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) throw new Error("no_sheet");

          // 先用 header:1 讀取第一列標題
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
          if (!aoa.length) throw new Error("empty");

          const headerRow = (aoa[0] ?? []).map((h) => normalizeHeader(String(h ?? "")));

          const idxStudent = headerRow.findIndex((h) => ["學號", "学生编号", "studentno", "student_no"].includes(h.toLowerCase()) || h === "學號");
          const idxName = headerRow.findIndex((h) => ["姓名", "学生姓名", "name"].includes(h.toLowerCase()) || h === "姓名");
          const idxEnergy = headerRow.findIndex((h) => h.includes("能量") || h.toLowerCase().includes("energy"));
          const idxBooks = headerRow.findIndex((h) => h.includes("本數") || h.includes("本月挖掘本數") || h.toLowerCase().includes("books"));

          if (idxStudent < 0 || idxName < 0 || idxEnergy < 0 || idxBooks < 0) {
            throw new Error("bad_header");
          }

          const rows = aoa
            .slice(1)
            .filter((r) => r && r.length)
            .map((r) => {
              const student_no = String(r[idxStudent] ?? "").trim();
              const name = String(r[idxName] ?? "").trim();
              const energy = Number(r[idxEnergy] ?? 0) || 0;
              const books = Number(r[idxBooks] ?? 0) || 0;
              return { student_no, name, energy, books };
            })
            .filter((r) => /^\d{5}$/.test(r.student_no) && r.name);

          resolve({ year_month: (yearMonth || ymDefault).trim(), rows });
        } catch (e) {
          reject(e);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function importExcel() {
    if (!excel) return toast.error("請選擇 Excel");
    const ym = (yearMonth || ymDefault).trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) return toast.error("月份格式需為 YYYY-MM");

    setLoading(true);
    const t = toast.loading("解析 Excel 並匯入中…");
    try {
      const parsed = await parseMonthlyExcel(excel);
      if (!parsed.rows.length) throw new Error("沒有可匯入的資料列");

      // 走 DB RPC：不使用 Edge Function
      const { data, error } = await supabase.rpc("rpc_import_reading_month", {
        p_year_month: ym,
        p_rows: parsed.rows,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "import_failed");

      setMissing(data.missing_in_report ?? []);
      toast.success(`完成：處理 ${data.processed} 筆（${ym}）`);
    } catch (e: any) {
      toast.error("匯入失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
      setLoading(false);
    }
  }

  async function loadUsers() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("app_users")
        .select("account, role, name, class_id")
        .order("role")
        .order("class_id")
        .order("account");
      if (error) throw error;
      setUsers((data as any) ?? []);
    } catch (e: any) {
      toast.error("讀取人事清單失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function createUser() {
    const account = newAccount.trim();
    const name = newName.trim();
    if (!account) return toast.error("請輸入帳號");
    if (!name) return toast.error("請輸入姓名");
    if (newRole !== "student" && !newPassword) return toast.error("老師/管理員需要設定密碼");
    if (newRole === "student" && !/^\d{5}$/.test(account)) return toast.error("學生帳號建議使用 5 碼學號（如 30105）");

    const t = toast.loading("新增中…");
    try {
      const row: any = {
        account,
        role: newRole,
        name,
        class_id: newRole === "admin" ? null : newClass,
        // 依你目前 DB 設計：password_hash 欄位存放明文（之後若要加密，再統一調整）
        password_hash: newRole === "student" ? null : newPassword,
      };
      const { error } = await supabase.from("app_users").insert(row);
      if (error) throw error;
      toast.success("新增完成");
      setCreateOpen(false);
      setNewAccount("");
      setNewName("");
      setNewPassword("");
      loadUsers();
    } catch (e: any) {
      toast.error("新增失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
    }
  }

  async function removeUser(account: string) {
    if (!confirm(`確定移除帳號 ${account}？\n（建議用於轉校/畢業）`)) return;
    const t = toast.loading("移除中…");
    try {
      const { error } = await supabase.from("app_users").delete().eq("account", account);
      if (error) throw error;
      toast.success("已移除");
      loadUsers();
    } catch (e: any) {
      toast.error("移除失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
    }
  }

  async function promote() {
    if (promoteFrom === promoteTo) return toast.error("升年級目標班級不可相同");
    if (!confirm(`確定將 ${promoteFrom} 的學生批次改為 ${promoteTo}？`)) return;
    const t = toast.loading("批次升年級中…");
    try {
      const { data, error } = await supabase
        .from("app_users")
        .update({ class_id: promoteTo })
        .eq("role", "student")
        .eq("class_id", promoteFrom)
        .select("account");
      if (error) throw error;
      toast.success(`完成：更新 ${(data ?? []).length} 筆`);
      loadUsers();
    } catch (e: any) {
      toast.error("批次升年級失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
    }
  }

  async function loadLeaderboard() {
    const ym = (lbYm || ymDefault).trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) return toast.error("月份格式需為 YYYY-MM");
    setLoading(true);
    try {
      // 直接查 DB monthly 表（需配合你在 Supabase SQL Editor 建立 reading_monthly + 匯入 RPC）
      const classes: any = {};
      for (const c of CLASS_CODES) {
        const { data, error } = await supabase
          .from("reading_monthly")
          .select("student_no, name, energy, books")
          .eq("year_month", ym)
          .eq("class_id", c)
          .gte("books", 2)
          .order("energy", { ascending: false })
          .order("books", { ascending: false })
          .limit(5);
        if (error) throw error;
        classes[c] = data ?? [];
      }
      setLeaderboard({ ok: true, year_month: ym, classes });
    } catch (e: any) {
      toast.error("讀取排行榜失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const filteredUsers = useMemo(() => {
    const s = uq.trim();
    return users
      .filter((u) => (uRole === "all" ? true : u.role === uRole))
      .filter((u) => (uClass === "all" ? true : (u.class_id ?? null) === uClass))
      .filter((u) => {
        if (!s) return true;
        return (u.account + u.name + (u.class_id ?? "")).includes(s);
      });
  }, [users, uq, uRole, uClass]);

  useEffect(() => {
    // 進到管理員後先把人事資料拉下來
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPromoteTo(nextClass(promoteFrom));
  }, [promoteFrom]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">管理員端｜匯入與管理</h2>
        <p className="text-sm text-muted-foreground mt-1">核心功能：書箱 PDF 智慧匯入、每月 Excel 報表匯入比對、人事管理、排行榜與匯出</p>
      </div>

      <Tabs defaultValue="pdf">
        <TabsList className="grid grid-cols-5 w-full max-w-4xl">
          <TabsTrigger value="pdf">PDF 書箱匯入</TabsTrigger>
          <TabsTrigger value="excel">Excel 月報匯入</TabsTrigger>
          <TabsTrigger value="users">人事管理</TabsTrigger>
          <TabsTrigger value="rank">每月排行榜</TabsTrigger>
          <TabsTrigger value="export">匯出/圖表</TabsTrigger>
        </TabsList>

        <TabsContent value="pdf" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>書箱清單 PDF 智慧匯入</CardTitle>
              <CardDescription>自動解析：借閱班級、應還日期、登錄號、書名、作者（批次 upsert）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>上傳 PDF</Label>
                <Input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
              </div>
              <Button onClick={importPdf} disabled={loading}>開始匯入</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="excel" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>每月 Excel 報表匯入與比對</CardTitle>
              <CardDescription>自動加總至總能量/總本數，並計算榮譽卡（每 500 點）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>年份-月份（YYYY-MM）</Label>
                  <Input value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} placeholder={ymDefault} />
                </div>
                <div className="space-y-1">
                  <Label>上傳 Excel</Label>
                  <Input type="file" accept=".xlsx,.xls" onChange={(e) => setExcel(e.target.files?.[0] ?? null)} />
                </div>
              </div>
              <Button onClick={importExcel} disabled={loading}>開始匯入</Button>

              {missing.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-red-600">本月無閱讀紀錄學生名單（或未建檔）</p>
                  <div className="overflow-auto mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>學號</TableHead>
                          <TableHead>姓名</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {missing.map((m) => (
                          <TableRow key={m.student_no}>
                            <TableCell className="font-mono">{m.student_no}</TableCell>
                            <TableCell>{m.name}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>人事管理（師生資料）</CardTitle>
              <CardDescription>支援：新增/移除、學生升年級批次更改班級（轉校/畢業移除）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Input value={uq} onChange={(e) => setUq(e.target.value)} placeholder="搜尋：學號/帳號/姓名" className="w-64" />
                  <select className="h-10 rounded-md border bg-background px-3 text-sm" value={uRole} onChange={(e) => setURole(e.target.value as any)}>
                    <option value="all">全部角色</option>
                    <option value="student">學生</option>
                    <option value="teacher">老師</option>
                    <option value="admin">管理員</option>
                  </select>
                  <select className="h-10 rounded-md border bg-background px-3 text-sm" value={uClass} onChange={(e) => setUClass(e.target.value as any)}>
                    <option value="all">全部班級</option>
                    {CLASS_CODES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={loadUsers} disabled={loading}>重新整理</Button>

                  <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                      <Button>新增帳號</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>新增師生帳號</DialogTitle>
                        <DialogDescription>學生可免密碼登入；老師/管理員需設定密碼。</DialogDescription>
                      </DialogHeader>

                      <div className="grid gap-3">
                        <div className="grid gap-1">
                          <Label>角色</Label>
                          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={newRole} onChange={(e) => setNewRole(e.target.value as any)}>
                            <option value="student">學生</option>
                            <option value="teacher">老師</option>
                            <option value="admin">管理員</option>
                          </select>
                        </div>

                        <div className="grid gap-1">
                          <Label>帳號</Label>
                          <Input value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder={newRole === "student" ? "例如 30105" : "例如 t03"} />
                        </div>

                        <div className="grid gap-1">
                          <Label>姓名</Label>
                          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={newRole === "teacher" ? "例如 王小明" : "例如 林小華"} />
                        </div>

                        {newRole !== "admin" && (
                          <div className="grid gap-1">
                            <Label>班級</Label>
                            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={newClass} onChange={(e) => setNewClass(e.target.value as any)}>
                              {CLASS_CODES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {newRole !== "student" && (
                          <div className="grid gap-1">
                            <Label>密碼</Label>
                            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="請設定密碼" />
                          </div>
                        )}

                        {newRole === "teacher" && (
                          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            老師登入下拉選單會顯示遮名：{maskName(newName || "王小明")}
                          </div>
                        )}
                      </div>

                      <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                        <Button onClick={createUser}>新增</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              <div className="rounded-xl border p-4 bg-muted/10">
                <div className="font-medium">學生升年級（批次）</div>
                <div className="text-xs text-muted-foreground mt-1">以班級為單位，把該班所有「學生」改到下一個年級班。</div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <select className="h-10 rounded-md border bg-background px-3 text-sm" value={promoteFrom} onChange={(e) => setPromoteFrom(e.target.value as any)}>
                    {CLASS_CODES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <span className="text-sm text-muted-foreground">→</span>
                  <select className="h-10 rounded-md border bg-background px-3 text-sm" value={promoteTo} onChange={(e) => setPromoteTo(e.target.value as any)}>
                    {CLASS_CODES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <Button onClick={promote} disabled={loading}>批次更新</Button>
                </div>
              </div>

              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>帳號</TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>班級</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((u) => (
                      <TableRow key={u.account}>
                        <TableCell className="font-mono">{u.account}</TableCell>
                        <TableCell>{u.name}</TableCell>
                        <TableCell>{u.role}</TableCell>
                        <TableCell className="font-mono">{u.class_id ?? ""}</TableCell>
                        <TableCell className="text-right">
                          {u.role !== "admin" ? (
                            <Button size="sm" variant="destructive" onClick={() => removeUser(u.account)}>
                              移除
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}

                    {!loading && filteredUsers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">沒有資料</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rank" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>每月排行榜（各班前 5 名）</CardTitle>
              <CardDescription>門檻：本月 2 本以上；排序：能量優先，本數次之；無人達標顯示「從缺」</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="space-y-1">
                  <Label>月份（YYYY-MM）</Label>
                  <Input value={lbYm} onChange={(e) => setLbYm(e.target.value)} placeholder={ymDefault} className="w-40" />
                </div>
                <div className="pt-6">
                  <Button onClick={loadLeaderboard} disabled={loading}>查詢</Button>
                </div>
              </div>

              {leaderboard && (
                <div className="grid gap-4 md:grid-cols-2">
                  {CLASS_CODES.map((c) => {
                    const rows: any[] = leaderboard?.classes?.[c] ?? [];
                    return (
                      <Card key={c}>
                        <CardHeader>
                          <CardTitle className="text-base">班級 {c}｜前 5 名</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-12">#</TableHead>
                                  <TableHead>學號</TableHead>
                                  <TableHead>姓名</TableHead>
                                  <TableHead className="text-right">能量</TableHead>
                                  <TableHead className="text-right">本數</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {rows.length ? (
                                  rows.map((r, idx) => (
                                    <TableRow key={r.student_no ?? r.account ?? idx}>
                                      <TableCell>{idx + 1}</TableCell>
                                      <TableCell className="font-mono">{r.student_no ?? r.account ?? ""}</TableCell>
                                      <TableCell>{r.name ?? ""}</TableCell>
                                      <TableCell className="text-right font-mono">{r.energy ?? 0}</TableCell>
                                      <TableCell className="text-right font-mono">{r.books ?? 0}</TableCell>
                                    </TableRow>
                                  ))
                                ) : (
                                  <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">從缺</TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="export" className="mt-4">
          <ExportPanel ymDefault={ymDefault} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExportPanel({ ymDefault }: { ymDefault: string }) {
  const [ym, setYm] = useState(ymDefault);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassCode | "all">("all");

  useEffect(() => {
    setYm(ymDefault);
  }, [ymDefault]);

  async function loadExportData() {
    const y = (ym || ymDefault).trim();
    if (!/^\d{4}-\d{2}$/.test(y)) return toast.error("月份格式需為 YYYY-MM");

    setLoading(true);
    try {
      // 直接查 app_users + reading_totals（需在 Supabase 建好 reading_totals）
      const { data, error } = await supabase
        .from("app_users")
        .select("account,name,class_id,reading_totals(total_energy,total_books)")
        .eq("role", "student")
        .order("class_id")
        .order("account");
      if (error) throw error;
      const out = (data ?? []).map((r: any) => ({
        student_no: r.account,
        account: r.account,
        name: r.name,
        class_id: r.class_id,
        total_energy: r.reading_totals?.total_energy ?? 0,
        total_books: r.reading_totals?.total_books ?? 0,
      }));
      setRows(out);
      toast.success(`已載入 ${out.length} 筆`);
    } catch (e: any) {
      toast.error("載入匯出資料失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function exportExcel() {
    const { downloadXlsx } = await import("@/lib/exporters");
    const data = selectedClass === "all" ? rows : rows.filter((r) => r.class_id === selectedClass);
    if (!data.length) return toast.error("沒有資料可匯出");

    const filename = `布可列車_總紀錄_${ym || ymDefault}_${selectedClass === "all" ? "全校" : selectedClass}.xlsx`;
    downloadXlsx(filename, [{ name: "總紀錄", rows: data }]);
    toast.success("已下載 Excel");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>匯出 Excel / 布可能量圖表下載</CardTitle>
        <CardDescription>匯出學期/學年總紀錄 Excel；並生成刻度 500 的長條圖（PNG）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label>月份（用來指定學期範圍）</Label>
            <Input value={ym} onChange={(e) => setYm(e.target.value)} placeholder={ymDefault} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label>班級</Label>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value as any)}>
              <option value="all">全校</option>
              {CLASS_CODES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <Button onClick={loadExportData} disabled={loading} variant="outline">載入資料</Button>
          <Button onClick={exportExcel} disabled={loading}>下載 Excel</Button>
        </div>

        <EnergyChartCard data={rows} classFilter={selectedClass} ym={ym || ymDefault} />

        {rows.length > 0 && (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>學號</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>班級</TableHead>
                  <TableHead className="text-right">總能量</TableHead>
                  <TableHead className="text-right">總本數</TableHead>
                  <TableHead className="text-right">榮譽卡(累計)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(selectedClass === "all" ? rows : rows.filter((r) => r.class_id === selectedClass)).map((r) => (
                  <TableRow key={r.student_no ?? r.account}>
                    <TableCell className="font-mono">{r.student_no ?? r.account}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="font-mono">{r.class_id}</TableCell>
                    <TableCell className="text-right font-mono">{r.total_energy ?? 0}</TableCell>
                    <TableCell className="text-right font-mono">{r.total_books ?? 0}</TableCell>
                    <TableCell className="text-right font-mono">{Math.floor((r.total_energy ?? 0) / 500)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EnergyChartCard({ data, classFilter, ym }: { data: any[]; classFilter: ClassCode | "all"; ym: string }) {
  const refId = "energy-chart";

  const chartData = useMemo(() => {
    const rows = classFilter === "all" ? data : data.filter((r) => r.class_id === classFilter);
    const top = [...rows]
      .sort((a, b) => (b.total_energy ?? 0) - (a.total_energy ?? 0))
      .slice(0, 20)
      .map((r) => ({ name: r.name, energy: r.total_energy ?? 0 }));
    return top;
  }, [data, classFilter]);

  async function downloadChart() {
    const svg = document.querySelector(`#${refId} svg`) as SVGSVGElement | null;
    if (!svg) return toast.error("找不到圖表（請先載入資料）");
    const { downloadSvgAsPng } = await import("@/lib/exporters");
    const filename = `布可能量長條圖_${ym}_${classFilter === "all" ? "全校" : classFilter}.png`;
    await downloadSvgAsPng(svg, filename, 2);
    toast.success("已下載圖表 PNG");
  }

  // 以 500 為刻度：Recharts 的 tick formatter + domain
  const maxE = Math.max(0, ...chartData.map((d) => d.energy));
  const maxTick = Math.ceil(maxE / 500) * 500;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">布可能量長條圖（Top 20）</CardTitle>
          <CardDescription>刻度固定 500；可下載 PNG</CardDescription>
        </div>
        <Button variant="outline" onClick={downloadChart}>下載圖表</Button>
      </CardHeader>
      <CardContent>
        <div id={refId} className="w-full overflow-x-auto">
          {/* 使用現成 ui/chart wrapper（內部仍是 recharts） */}
          <div className="min-w-[720px]">
            <EnergyBarChart data={chartData} maxTick={maxTick} />
          </div>
        </div>
        {chartData.length === 0 && <div className="text-sm text-muted-foreground py-6">尚無資料（先按「載入資料」）</div>}
      </CardContent>
    </Card>
  );
}

function EnergyBarChart({ data, maxTick }: { data: { name: string; energy: number }[]; maxTick: number }) {
  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 24, left: 12, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" interval={0} angle={-18} textAnchor="end" height={60} />
          <YAxis domain={[0, maxTick || 500]} tickCount={Math.max(2, (maxTick || 500) / 500 + 1)} />
          <Tooltip />
          <Bar dataKey="energy" fill="#f59e0b" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
