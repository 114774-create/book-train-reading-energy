import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/customAuth";

interface Book {
  barcode: string;
  title: string;
  author: string | null;
  status: string;
  borrowed_by: string | null;
  borrowed_at: string | null;
  return_date: string | null;
  box_code: string | null;
}

interface Student {
  account: string;
  name: string;
}

export default function TeacherDashboard() {
  const sess = getSession();
  const classId = sess?.user?.class_id ?? null;
  const [books, setBooks] = useState<Book[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // 每本書選的借閱學生（barcode → account）
  const [selectedBorrower, setSelectedBorrower] = useState<Record<string, string>>({});
  // 勾選要歸還的書（barcode set）
  const [returnSelected, setReturnSelected] = useState<Set<string>>(new Set());
  // 勾選要借出的書（barcode set）
  const [borrowSelected, setBorrowSelected] = useState<Set<string>>(new Set());

  const [processing, setProcessing] = useState(false);

  // 應還日期（從 box_loans 取得）
  const [dueDate, setDueDate] = useState<string | null>(null);

  async function loadBooks() {
    if (!classId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("books")
        .select("barcode, title, author, status, borrowed_by, borrowed_at, return_date, box_code")
        .eq("borrowing_class", classId)
        .order("barcode");
      if (error) throw error;
      setBooks((data as Book[]) ?? []);

      // 取應還日期
      const boxCodes = [...new Set((data ?? []).map((b: any) => b.box_code).filter(Boolean))];
      if (boxCodes.length > 0) {
        const { data: loanData } = await supabase
          .from("box_loans")
          .select("due_date")
          .eq("box_code", boxCodes[0])
          .eq("status", "borrowed")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        setDueDate(loanData?.due_date ?? null);
      }
    } catch (e: any) {
      toast.error("讀取書籍清單失敗：" + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function loadStudents() {
    if (!classId) return;
    try {
      const { data, error } = await supabase
        .from("app_users")
        .select("account, name")
        .eq("class_id", classId)
        .eq("role", "student")
        .order("account");
      if (error) throw error;
      setStudents((data as Student[]) ?? []);
    } catch (e: any) {
      console.error("讀取學生清單失敗：", e);
    }
  }

  useEffect(() => {
    loadBooks();
    loadStudents();
  }, [classId]);

  const filteredBooks = useMemo(() => {
    const s = search.trim();
    if (!s) return books;
    return books.filter(
      (b) =>
        b.barcode.includes(s) ||
        b.title.includes(s) ||
        (b.author ?? "").includes(s) ||
        (b.borrowed_by ?? "").includes(s)
    );
  }, [books, search]);

  const availableBooks = filteredBooks.filter((b) => b.status === "available");
  const borrowedBooks = filteredBooks.filter((b) => b.status === "borrowed");

  // 批次借出
  async function handleBorrow() {
    const targets = availableBooks.filter((b) => borrowSelected.has(b.barcode));
    if (targets.length === 0) return toast.error("請先勾選要借出的書");

    const missing = targets.filter((b) => !selectedBorrower[b.barcode]);
    if (missing.length > 0) {
      return toast.error(`請為 ${missing.length} 本書選擇借閱學生`);
    }

    // 二次確認：列出「書名 → 學生」完整對照，避免勾選/選錯人卻沒發現就直接送出
    const studentNameMap: Record<string, string> = {};
    students.forEach((s) => { studentNameMap[s.account] = s.name; });
    const summary = targets
      .map((b) => `《${b.title}》 → ${studentNameMap[selectedBorrower[b.barcode]] ?? selectedBorrower[b.barcode]}`)
      .join("\n");
    if (!confirm(`確定要借出以下 ${targets.length} 本書嗎？\n\n${summary}`)) return;

    setProcessing(true);
    const t = toast.loading(`借出 ${targets.length} 本書中…`);
    try {
      const now = new Date().toISOString();

      // 更新 books 狀態
      for (const book of targets) {
        const account = selectedBorrower[book.barcode];
        const { error } = await supabase
          .from("books")
          .update({
            status: "borrowed",
            borrowed_by: account,
            borrowed_at: now,
          })
          .eq("barcode", book.barcode);
        if (error) throw error;
      }

      // 寫入 borrow_logs（student_account 記錄真正借閱的學生帳號，
      // 讓「哪個學生借了哪本書」的歷史記錄不會因為之後歸還而遺失）
      const logRows = targets.map((book) => ({
        barcode: book.barcode,
        action: "borrow",
        at: now,
        student_account: selectedBorrower[book.barcode],
      }));
      await supabase.from("borrow_logs").insert(logRows);

      toast.success(`成功借出 ${targets.length} 本`, { id: t });
      setBorrowSelected(new Set());
      setSelectedBorrower({});
      loadBooks();
    } catch (e: any) {
      toast.error("借出失敗：" + String(e?.message ?? e), { id: t });
    } finally {
      setProcessing(false);
    }
  }

  // 批次歸還
  async function handleReturn() {
    const targets = borrowedBooks.filter((b) => returnSelected.has(b.barcode));
    if (targets.length === 0) return toast.error("請先勾選要歸還的書");

    setProcessing(true);
    const t = toast.loading(`歸還 ${targets.length} 本書中…`);
    try {
      const now = new Date().toISOString();

      for (const book of targets) {
        const { error } = await supabase
          .from("books")
          .update({
            status: "available",
            borrowed_by: null,
            borrowed_at: null,
          })
          .eq("barcode", book.barcode);
        if (error) throw error;
      }

      const logRows = targets.map((book) => ({
        barcode: book.barcode,
        action: "return",
        at: now,
      }));
      await supabase.from("borrow_logs").insert(logRows);

      toast.success(`成功歸還 ${targets.length} 本`, { id: t });
      setReturnSelected(new Set());
      loadBooks();
    } catch (e: any) {
      toast.error("歸還失敗：" + String(e?.message ?? e), { id: t });
    } finally {
      setProcessing(false);
    }
  }

  function toggleBorrowSelect(barcode: string) {
    setBorrowSelected((prev) => {
      const next = new Set(prev);
      next.has(barcode) ? next.delete(barcode) : next.add(barcode);
      return next;
    });
  }

  function toggleReturnSelect(barcode: string) {
    setReturnSelected((prev) => {
      const next = new Set(prev);
      next.has(barcode) ? next.delete(barcode) : next.add(barcode);
      return next;
    });
  }

  function selectAllAvailable() {
    setBorrowSelected(new Set(availableBooks.map((b) => b.barcode)));
  }

  function selectAllBorrowed() {
    setReturnSelected(new Set(borrowedBooks.map((b) => b.barcode)));
  }

  function getStudentName(account: string | null) {
    if (!account) return "";
    return students.find((s) => s.account === account)?.name ?? account;
  }

  if (!classId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">無法取得班級資料，請重新登入。</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">班級總覽 🚂</h2>
          <p className="text-sm text-muted-foreground">班級：{classId}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜尋：登錄號/書名/作者"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Button variant="outline" onClick={() => { loadBooks(); loadStudents(); }} disabled={loading}>
            重新整理
          </Button>
        </div>
      </div>

      {dueDate && (
        <div className="rounded-xl border bg-red-50 px-4 py-3 flex items-center gap-2">
          <span className="text-red-500 font-bold text-lg">📌</span>
          <div>
            <p className="font-semibold text-red-700">本次列車應還日期：{dueDate}</p>
            <p className="text-sm text-red-500">請提醒同學準時歸還，謝謝！</p>
          </div>
        </div>
      )}

      {/* 可借書籍 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">
              📗 可借書籍（{availableBooks.length} 本）
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={selectAllAvailable}>
                全選
              </Button>
              <Button
                size="sm"
                onClick={handleBorrow}
                disabled={processing || borrowSelected.size === 0}
              >
                借出勾選 {borrowSelected.size > 0 ? `(${borrowSelected.size})` : ""}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {availableBooks.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">
              {books.length === 0 ? "本班尚無書箱資料，請管理員先匯入 PDF 書箱清單" : "目前所有書籍均已借出"}
            </p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">勾選</TableHead>
                    <TableHead className="w-56">借給學生</TableHead>
                    <TableHead>登錄號</TableHead>
                    <TableHead>書名</TableHead>
                    <TableHead>作者</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableBooks.map((book) => (
                    <TableRow
                      key={book.barcode}
                      className={borrowSelected.has(book.barcode) ? "bg-green-50" : ""}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={borrowSelected.has(book.barcode)}
                          onChange={() => toggleBorrowSelect(book.barcode)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </TableCell>
                      <TableCell>
                        <select
                          className="h-11 w-full rounded-md border bg-background px-3 text-base"
                          value={selectedBorrower[book.barcode] ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedBorrower((prev) => ({ ...prev, [book.barcode]: val }));
                            if (val) {
                              setBorrowSelected((prev) => new Set([...prev, book.barcode]));
                            }
                          }}
                        >
                          <option value="">— 選學生 —</option>
                          {students.map((s) => (
                            <option key={s.account} value={s.account}>
                              {s.name}（{s.account}）
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{book.barcode}</TableCell>
                      <TableCell>{book.title}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{book.author ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 借出中書籍 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">
              📕 借出中書籍（{borrowedBooks.length} 本）
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={selectAllBorrowed}>
                全選
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReturn}
                disabled={processing || returnSelected.size === 0}
              >
                歸還勾選 {returnSelected.size > 0 ? `(${returnSelected.size})` : ""}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {borrowedBooks.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">目前沒有借出中的書籍</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">勾選</TableHead>
                    <TableHead>登錄號</TableHead>
                    <TableHead>書名</TableHead>
                    <TableHead>作者</TableHead>
                    <TableHead>借閱學生</TableHead>
                    <TableHead>借出時間</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {borrowedBooks.map((book) => (
                    <TableRow
                      key={book.barcode}
                      className={returnSelected.has(book.barcode) ? "bg-amber-50" : ""}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={returnSelected.has(book.barcode)}
                          onChange={() => toggleReturnSelect(book.barcode)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{book.barcode}</TableCell>
                      <TableCell>{book.title}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{book.author ?? ""}</TableCell>
                      <TableCell>
                        <span className="font-medium">{getStudentName(book.borrowed_by)}</span>
                        <span className="text-xs text-muted-foreground ml-1">({book.borrowed_by})</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {book.borrowed_at
                          ? new Date(book.borrowed_at).toLocaleString("zh-TW", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}