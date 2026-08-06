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
import { ThemeEventsTab } from "./ThemeEventsTab";
import { StudentEnergyTab } from "@/components/admin/StudentEnergyTab";
// ★ 新增：前端 PDF 解析套件
import * as pdfjsLib from "pdfjs-dist";
// Vite 環境下用 ?url 匯入 worker
// 若這行報錯，改成下一行的寫法
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// ── 工具函式 ──────────────────────────────────────────────────────────────────

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

/** 前端把 PDF 檔案解析成純文字（不依賴任何後端） */
async function pdfFileToText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(" ");
    pages.push(pageText);
  }
  return pages.join("\n");
}

// ── 常數 ──────────────────────────────────────────────────────────────────────

const CLASS_CODES: ClassCode[] = ["101", "201", "301", "401", "501", "601"];

function nextClass(code: ClassCode): ClassCode {
  const i = CLASS_CODES.indexOf(code);
  return CLASS_CODES[Math.min(CLASS_CODES.length - 1, i + 1)] ?? code;
}

function isGraduationClass(code: ClassCode) {
  return code.startsWith("6");
}

function maskName(name: string) {
  const s = name.trim();
  if (!s) return "";
  if (s.length === 1) return s;
  if (s.length === 2) return s[0] + "O";
  return s[0] + "O" + s[s.length - 1];
}

// ── 主元件 ────────────────────────────────────────────────────────────────────

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
  const [newRole, setNewRole] = useState<UserRole>("teacher");
  const [newAccount, setNewAccount] = useState("");
  const [newName, setNewName] = useState("");
  const [newClass, setNewClass] = useState<ClassCode>("101");
  const [newPassword, setNewPassword] = useState("");

  const [promoteFrom, setPromoteFrom] = useState<ClassCode>("101");
  const [promoteTo, setPromoteTo] = useState<ClassCode>("201");

  // 學生同步
  const [syncing, setSyncing] = useState(false);

  // 老師編輯
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<AppUserRow | null>(null);
  const [editAccount, setEditAccount] = useState("");
  const [editName, setEditName] = useState("");
  const [editClass, setEditClass] = useState<ClassCode>("101");

  // 排行榜
  const [lbYm, setLbYm] = useState("");
  const [leaderboard, setLeaderboard] = useState<any>(null);

  // 書箱管理
  const [boxLoans, setBoxLoans] = useState<any[]>([]);
  const [pdfImportResult, setPdfImportResult] = useState<any>(null);
  const [excelImportResult, setExcelImportResult] = useState<any>(null);
  const [returningBox, setReturningBox] = useState<number | null>(null);

  const ymDefault = useMemo(() => {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, []);

  useEffect(() => {
    setLbYm(ymDefault);
  }, [ymDefault]);

  // ★ 修改重點：前端先解析 PDF 文字，再傳 raw_text 給 Edge Function
  async function importPdf() {
    if (!pdf) return toast.error("請選擇 PDF");
    setLoading(true);
    const t = toast.loading("解析 PDF 中…");
    try {
      const sess = getSession();
      if (!sess) throw new Error("not_logged_in");

      // 1. 前端解析 PDF → 純文字
      toast.loading("擷取 PDF 文字中…", { id: t });
      const rawText = await pdfFileToText(pdf);
      if (!rawText || rawText.trim().length < 20) {
        throw new Error("PDF 擷取文字失敗，請確認 PDF 非掃描圖片格式");
      }

      // 2. 傳純文字給 Edge Function
      toast.loading("上傳並寫入資料庫中…", { id: t });
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-bookbox-pdf`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${sess.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw_text: rawText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);

      setPdfImportResult(data);
      if (data.count_mismatch) {
        toast.warning(`匯入 ${data.imported} 本（PDF 標示 ${data.declared_count} 本），本數不一致！`, { id: t });
      } else {
        toast.success(`完成：${data.imported} 本（書箱 ${data.box_code}，班級 ${data.borrowing_class}）`, { id: t });
      }
      loadBoxLoans();
    } catch (e: any) {
      toast.error("匯入失敗：" + String(e?.message ?? e), { id: t });
    } finally {
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
      const pdfBase64 = await fileToBase64(excel);
      const sess = getSession();
      if (!sess) throw new Error("not_logged_in");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-reading-excel`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${sess.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file_name: excel.name,
          file_base64: pdfBase64,
          target_year_month: ym,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      if (!data?.ok) throw new Error(data?.error || "import_failed");

      setExcelImportResult(data);
      setPdfImportResult(null);

      const missingCount = (data.not_found ?? []).length;
      if (missingCount > 0) {
        toast.warning(`匯入完成 ${data.processed} 筆，但有 ${missingCount} 筆找不到對應學生`);
      } else {
        toast.success(`完成：處理 ${data.processed} 筆（${ym}）`);
      }

      if (data.ym_mismatch) {
        toast.warning(`年月不匹配：檔案中為 ${data.ym_mismatch.file_ym}，您輸入的是 ${data.ym_mismatch.target_ym}`);
      }
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
    if (newRole === "student") return toast.error("學生帳號由 Google 試算表同步，無法手動新增");
    if (!newPassword) return toast.error("老師/管理員需要設定密碼");

    const t = toast.loading("新增中…");
    try {
      const row: any = {
        account,
        role: newRole,
        name,
        class_id: newRole === "admin" ? null : newClass,
        password_hash: newPassword,
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

  async function syncStudents() {
    setSyncing(true);
    const t = toast.loading("從 Google 試算表同步學生名單中…");
    try {
      const sess = getSession();
      if (!sess) throw new Error("not_logged_in");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-students`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${sess.token}`,
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      toast.success(`同步完成：${data.synced} 筆學生（更新 ${data.upserted} 筆，刪除 ${data.deleted} 筆畢業生）`);
      loadUsers();
    } catch (e: any) {
      toast.error("同步失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
      setSyncing(false);
    }
  }

  function openEditTeacher(user: AppUserRow) {
    setEditUser(user);
    setEditAccount(user.account);
    setEditName(user.name);
    setEditClass((user.class_id as ClassCode) ?? "101");
    setEditOpen(true);
  }

  async function saveEditTeacher() {
    if (!editUser) return;
    const account = editAccount.trim();
    const name = editName.trim();
    if (!account) return toast.error("請輸入帳號");
    if (!name) return toast.error("請輸入姓名");

    const t = toast.loading("儲存中…");
    try {
      const updates: any = {
        account,
        name,
        class_id: editUser.role === "admin" ? null : editClass,
      };
      const { error } = await supabase
        .from("app_users")
        .update(updates)
        .eq("account", editUser.account);
      if (error) throw error;
      toast.success("已更新");
      setEditOpen(false);
      setEditUser(null);
      loadUsers();
    } catch (e: any) {
      toast.error("更新失敗：" + String(e?.message ?? e));
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
    if (isGraduationClass(promoteFrom)) {
      if (!confirm(`確定將 ${promoteFrom} 的學生批次「畢業封存」？`)) return;
      const t = toast.loading("畢業封存處理中…");
      try {
        const { data, error } = await supabase
          .from("app_users")
          .update({ role: "alumni", class_id: null })
          .eq("role", "student")
          .eq("class_id", promoteFrom)
          .select("account");
        if (error) throw error;
        toast.success(`完成：封存 ${(data ?? []).length} 筆`);
        loadUsers();
      } catch (e: any) {
        toast.error("畢業封存失敗：" + String(e?.message ?? e));
      } finally {
        toast.dismiss(t);
      }
      return;
    }

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

  async function loadBoxLoans() {
    try {
      const { data, error } = await supabase
        .from("box_loans")
        .select("*")
        .eq("status", "borrowed")
        .order("borrow_date", { ascending: false });
      if (error) throw error;
      setBoxLoans((data as any[]) ?? []);
    } catch (e: any) {
      console.error("載入書箱清單失敗：", e);
    }
  }

  async function returnBox(boxLoanId: number) {
    if (!confirm("確定要整批歸還此書箱嗎？")) return;
    setReturningBox(boxLoanId);
    const t = toast.loading("處理整批歸還中…");
    try {
      const sess = getSession();
      if (!sess) throw new Error("not_logged_in");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/return-box`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${sess.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ box_loan_id: boxLoanId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      if (data.count_mismatch) {
        toast.warning(`歸還完成 ${data.returned_count} 本（當初借出 ${data.declared_count} 本），有 ${data.missing_books} 本可能遺失！`);
      } else {
        toast.success(`歸還完成：${data.returned_count} 本`);
      }
      loadBoxLoans();
    } catch (e: any) {
      toast.error("歸還失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
      setReturningBox(null);
    }
  }

  async function loadLeaderboard() {
    const ym = (lbYm || ymDefault).trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) return toast.error("月份格式需為 YYYY-MM");
    setLoading(true);
    try {
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
    loadUsers();
    loadBoxLoans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPromoteTo(nextClass(promoteFrom));
  }, [promoteFrom]);

  const promoteLabel = isGraduationClass(promoteFrom) ? "畢業封存" : "批次更新";

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight">匯入與管理 🛠️</h2>
        <p className="text-sm text-muted-foreground mt-1">核心功能：書箱 PDF 智慧匯入、每月 Excel 報表匯入比對、人事管理、排行榜與匯出</p>
      </div>

      <Tabs defaultValue="pdf">
        <TabsList className="grid grid-cols-7 w-full max-w-5xl">
          <TabsTrigger value="pdf">PDF 書箱匯入</TabsTrigger>
          <TabsTrigger value="excel">Excel 月報匯入</TabsTrigger>
          <TabsTrigger value="users">人事管理</TabsTrigger>
          <TabsTrigger value="energy">學生能量</TabsTrigger>
          <TabsTrigger value="rank">每月排行榜</TabsTrigger>
          <TabsTrigger value="export">匯出/圖表</TabsTrigger>
          <TabsTrigger value="events">主題活動</TabsTrigger>
        </TabsList>

        <TabsContent value="pdf" className="mt-4">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>書箱清單 PDF 智慧匯入</CardTitle>
                <CardDescription>自動解析：書箱編號、借閱班級、應還日期、登錄號、書名、作者（批次 upsert）</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label>上傳 PDF</Label>
                  <Input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
                </div>
                <Button onClick={importPdf} disabled={loading}>開始匯入</Button>

                {pdfImportResult && (
                  <div className="mt-4">
                    <div className="rounded-lg border bg-amber-50 p-3 space-y-2">
                      <p className="text-sm font-medium">匯入結果：</p>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>書箱編號：{pdfImportResult.box_code}</li>
                        <li>書箱名稱：{pdfImportResult.box_name}</li>
                        <li>借閱班級：{pdfImportResult.borrowing_class}</li>
                        <li>應還日期：{pdfImportResult.due_date}</li>
                        <li>實際解析：{pdfImportResult.imported} 本 / 標示：{pdfImportResult.declared_count} 本</li>
                      </ul>
                      {pdfImportResult.count_mismatch && (
                        <p className="text-sm font-medium text-amber-600">⚠️ 解析本數與 PDF 標示不一致，請手動檢查！</p>
                      )}
                      {pdfImportResult.warning && (
                        <p className="text-sm text-amber-600">{pdfImportResult.warning}</p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>📦 書箱管理</CardTitle>
                <CardDescription>目前借出中的書箱，可點擊「整批歸還」處理歸還作業</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>書箱編號</TableHead>
                        <TableHead>書箱名稱</TableHead>
                        <TableHead>借閱班級</TableHead>
                        <TableHead>借閱日期</TableHead>
                        <TableHead>應還日期</TableHead>
                        <TableHead>書籍冊數</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {boxLoans.length > 0 ? (
                        boxLoans.map((bl: any) => (
                          <TableRow key={bl.id}>
                            <TableCell className="font-mono">{bl.box_code}</TableCell>
                            <TableCell>{bl.box_name ?? ""}</TableCell>
                            <TableCell className="font-mono">{bl.borrowing_class ?? ""}</TableCell>
                            <TableCell>{bl.borrow_date ?? ""}</TableCell>
                            <TableCell>{bl.due_date ?? ""}</TableCell>
                            <TableCell className="text-right font-mono">{bl.book_count ?? 0}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => returnBox(bl.id)}
                                disabled={returningBox === bl.id}
                              >
                                {returningBox === bl.id ? "歸還中…" : "整批歸還"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-6">目前沒有借出中的書箱</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
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

              {excelImportResult && (
                <div className="mt-4">
                  <div className="rounded-lg border bg-green-50 p-3 space-y-2">
                    <p className="text-sm font-medium">匯入結果：處理 {excelImportResult.processed} 筆</p>
                    {excelImportResult.ym_mismatch && (
                      <p className="text-sm font-medium text-amber-600">
                        ⚠️ 年月不匹配：檔案中為 {excelImportResult.ym_mismatch.file_ym}，您輸入的是 {excelImportResult.ym_mismatch.target_ym}（已繼續匯入）
                      </p>
                    )}
                    {(excelImportResult.not_found ?? []).length > 0 && (
                      <div className="mt-2">
                        <p className="text-sm font-medium text-red-600">找不到對應學生的筆數：{(excelImportResult.not_found ?? []).length}</p>
                        <div className="overflow-auto mt-2">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>姓名</TableHead>
                                <TableHead>推算帳號</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(excelImportResult.not_found ?? []).map((m: any, idx: number) => (
                                <TableRow key={idx}>
                                  <TableCell>{m.name}</TableCell>
                                  <TableCell className="font-mono">{m.account}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
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
              <CardDescription>學生名單由 Google 試算表單向同步；老師帳號由管理員手動新增與編輯</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border bg-blue-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-bold text-base">👨‍🎓 學生管理（Google 試算表同步）</h3>
                    <p className="text-xs text-muted-foreground mt-1">學生名單由外部 Google 試算表單向同步，本系統不提供手動新增/編輯/刪除功能。同步時會自動移除已畢業（不在試算表中）的學生。</p>
                  </div>
                  <Button onClick={syncStudents} disabled={syncing}>
                    {syncing ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                        同步中…
                      </span>
                    ) : (
                      "🔄 從 Google 試算表同步學生名單"
                    )}
                  </Button>
                </div>
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>帳號</TableHead>
                        <TableHead>姓名</TableHead>
                        <TableHead>班級</TableHead>
                        <TableHead className="text-right">狀態</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.filter((u) => u.role === "student").map((u) => (
                        <TableRow key={u.account}>
                          <TableCell className="font-mono">{u.account}</TableCell>
                          <TableCell>{u.name}</TableCell>
                          <TableCell className="font-mono">{u.class_id ?? ""}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">唯讀</TableCell>
                        </TableRow>
                      ))}
                      {!loading && filteredUsers.filter((u) => u.role === "student").length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-6">尚未有學生資料，請點擊上方按鈕同步</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="rounded-xl border bg-amber-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-bold text-base">👩‍🏫 老師管理（手動管理）</h3>
                    <p className="text-xs text-muted-foreground mt-1">新增老師帳號或編輯現有老師的姓名、班級與帳號</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading}>重新整理</Button>
                    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm">新增老師帳號</Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                          <DialogTitle>新增老師帳號</DialogTitle>
                          <DialogDescription>老師登入下拉選單會顯示遮名，需設定密碼。</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3">
                          <div className="grid gap-1">
                            <Label>帳號</Label>
                            <Input value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder="例如 t03" />
                          </div>
                          <div className="grid gap-1">
                            <Label>姓名</Label>
                            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如 王小明" />
                          </div>
                          <div className="grid gap-1">
                            <Label>班級 / 負責年級</Label>
                            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={newClass} onChange={(e) => setNewClass(e.target.value as any)}>
                              {CLASS_CODES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-1">
                            <Label>密碼</Label>
                            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="請設定密碼" />
                          </div>
                          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            老師登入下拉選單會顯示遮名：{maskName(newName || "王小明")}
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                          <Button onClick={createUser}>新增</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
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
                      {filteredUsers.filter((u) => u.role === "teacher" || u.role === "admin").map((u) => (
                        <TableRow key={u.account}>
                          <TableCell className="font-mono">{u.account}</TableCell>
                          <TableCell>{u.name}</TableCell>
                          <TableCell>{u.role === "admin" ? "管理員" : "老師"}</TableCell>
                          <TableCell className="font-mono">{u.class_id ?? ""}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => openEditTeacher(u)}>編輯</Button>
                              {u.role !== "admin" ? (
                                <Button size="sm" variant="destructive" onClick={() => removeUser(u.account)}>移除</Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!loading && filteredUsers.filter((u) => u.role === "teacher" || u.role === "admin").length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-6">尚未有老師資料</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>編輯老師資料</DialogTitle>
                    <DialogDescription>修改姓名、班級與帳號</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <Label>帳號</Label>
                      <Input value={editAccount} onChange={(e) => setEditAccount(e.target.value)} placeholder="例如 t03" />
                    </div>
                    <div className="grid gap-1">
                      <Label>姓名</Label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="例如 王小明" />
                    </div>
                    <div className="grid gap-1">
                      <Label>班級 / 負責年級</Label>
                      <select className="h-10 rounded-md border bg-background px-3 text-sm" value={editClass} onChange={(e) => setEditClass(e.target.value as any)}>
                        {CLASS_CODES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      遮名預覽：{maskName(editName || "王小明")}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
                    <Button onClick={saveEditTeacher}>儲存</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="energy" className="mt-4">
          <StudentEnergyTab />
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

        <TabsContent value="events" className="mt-4">
          <ThemeEventsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExportPanel({ ymDefault }: { ymDefault: string }) {
  const now = new Date();
  const rocNow = now.getUTCFullYear() - 1911;

  const [rocYear, setRocYear] = useState<number>(rocNow);
  const [semester, setSemester] = useState<"year" | "first" | "second">("year");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassCode | "all">("all");

  function ymRangeFor(roc: number, sem: "year" | "first" | "second") {
    const startYear = roc + 1911;
    const endYear = startYear + 1;
    if (sem === "first") return { start: `${startYear}-08`, end: `${endYear}-01` };
    if (sem === "second") return { start: `${endYear}-02`, end: `${endYear}-07` };
    return { start: `${startYear}-08`, end: `${endYear}-07` };
  }

  const range = useMemo(() => ymRangeFor(rocYear, semester), [rocYear, semester]);

  async function loadExportData() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("reading_monthly")
        .select("student_no, class_id, name, energy, books, year_month")
        .gte("year_month", range.start)
        .lte("year_month", range.end);
      if (error) throw error;

      const map = new Map<string, any>();
      for (const r of (data as any[]) ?? []) {
        const k = String(r.student_no);
        const prev = map.get(k) ?? {
          student_no: k,
          account: k,
          name: r.name ?? "",
          class_id: r.class_id ?? null,
          total_energy: 0,
          total_books: 0,
        };
        prev.total_energy += Number(r.energy ?? 0) || 0;
        prev.total_books += Number(r.books ?? 0) || 0;
        if (r.name) prev.name = r.name;
        if (r.class_id) prev.class_id = r.class_id;
        map.set(k, prev);
      }

      const out = Array.from(map.values())
        .sort((a, b) => String(a.class_id ?? "").localeCompare(String(b.class_id ?? "")) || String(a.student_no).localeCompare(String(b.student_no)));

      setRows(out);
      if (out.length === 0) {
        toast.warning("此期間尚無資料，請先匯入 Excel 月報");
      } else {
        toast.success(`已載入 ${out.length} 筆（${range.start} ~ ${range.end}）`);
      }
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

    const semLabel = semester === "year" ? "全學年" : semester === "first" ? "上學期" : "下學期";
    const filename = `布可列車_${rocYear}學年度_${semLabel}_${selectedClass === "all" ? "全校" : selectedClass}.xlsx`;

    const sheetRows = data.map((r) => ({
      學號: r.student_no,
      姓名: r.name,
      班級: r.class_id,
      能量: r.total_energy,
      本數: r.total_books,
      榮譽卡: Math.floor((r.total_energy ?? 0) / 500),
    }));

    downloadXlsx(filename, [{ name: "總紀錄", rows: sheetRows }]);
    toast.success("已下載 Excel");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>📤 匯出 Excel / 布可能量圖表下載</CardTitle>
        <CardDescription>匯出學期/學年總紀錄 Excel；並生成刻度 500 的長條圖（PNG）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label>學年（民國）</Label>
            <select className="h-12 rounded-2xl border bg-white/60 px-4 text-sm shadow-[0_12px_24px_-18px_rgba(2,132,199,0.22)]" value={rocYear} onChange={(e) => setRocYear(Number(e.target.value))}>
              {Array.from({ length: 6 }).map((_, i) => {
                const y = rocNow - i;
                return <option key={y} value={y}>{y} 學年度</option>;
              })}
            </select>
          </div>
          <div className="space-y-1">
            <Label>學期</Label>
            <select className="h-12 rounded-2xl border bg-white/60 px-4 text-sm shadow-[0_12px_24px_-18px_rgba(2,132,199,0.22)]" value={semester} onChange={(e) => setSemester(e.target.value as any)}>
              <option value="year">全學年</option>
              <option value="first">上學期（8~1月）</option>
              <option value="second">下學期（2~7月）</option>
            </select>
          </div>
          <div className="text-xs text-muted-foreground pt-7">
            期間：<span className="font-mono">{range.start}</span> ~ <span className="font-mono">{range.end}</span>
          </div>
          <div className="space-y-1">
            <Label>班級</Label>
            <select className="h-12 rounded-2xl border bg-white/60 px-4 text-sm shadow-[0_12px_24px_-18px_rgba(2,132,199,0.22)]" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value as any)}>
              <option value="all">全校</option>
              {CLASS_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Button onClick={loadExportData} disabled={loading} variant="outline">載入資料</Button>
          <Button onClick={exportExcel} disabled={loading}>下載 Excel</Button>
        </div>

        {rows.length === 0 && !loading && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground text-center">
            尚未載入資料，請先匯入 Excel 月報，再點「載入資料」
          </div>
        )}

        <EnergyChartCard data={rows} classFilter={selectedClass} ym={`${rocYear}學年度_${semester === "year" ? "全學年" : semester === "first" ? "上學期" : "下學期"}`} />

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
    return [...rows]
      .sort((a, b) => (b.total_energy ?? 0) - (a.total_energy ?? 0))
      .slice(0, 20)
      .map((r) => ({ name: r.name, energy: r.total_energy ?? 0 }));
  }, [data, classFilter]);

  async function downloadChart() {
    const svg = document.querySelector(`#${refId} svg`) as SVGSVGElement | null;
    if (!svg) return toast.error("找不到圖表（請先載入資料）");
    const { downloadSvgAsPng } = await import("@/lib/exporters");
    const filename = `布可能量長條圖_${ym}_${classFilter === "all" ? "全校" : classFilter}.png`;
    await downloadSvgAsPng(svg, filename, 2);
    toast.success("已下載圖表 PNG");
  }

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
          <div className="min-w-[720px]">
            <EnergyBarChart data={chartData} maxTick={maxTick} />
          </div>
        </div>
        {chartData.length === 0 && (
          <div className="text-sm text-muted-foreground py-6 text-center">尚無資料（先按「載入資料」）</div>
        )}
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
