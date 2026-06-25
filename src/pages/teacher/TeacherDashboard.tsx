import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { Book, UserProfile } from "@/lib/types";

export default function TeacherDashboard() {
  const { user } = useAuth();
  const [me, setMe] = useState<UserProfile | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const meUser = (user as any) ?? null;
      setMe(meUser);
      const classId = (meUser as any)?.class_id ?? (meUser as any)?.class_code ?? null;
      if (!classId) throw new Error("missing_class_id");

      const { data, error } = await supabase
        .from("books")
        .select("barcode,title,author,borrowing_class,return_date,status,borrowed_by,borrowed_at")
        .eq("borrowing_class", classId)
        .order("status", { ascending: true })
        .order("barcode", { ascending: true });
      if (error) throw error;
      setBooks((data as any) ?? []);
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim();
    if (!s) return books;
    return books.filter((b) => (b.barcode + b.title + (b.author ?? "")).includes(s));
  }, [books, q]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">老師端｜班級總覽</h2>
          <p className="text-sm text-muted-foreground mt-1">班級：{(me as any)?.class_id ?? (me as any)?.class_code ?? ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋：登錄號/書名/作者" className="w-64" />
          <Button variant="outline" onClick={load} disabled={loading}>重新整理</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>本班布可列車書籍清單</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>登錄號</TableHead>
                  <TableHead>書名</TableHead>
                  <TableHead className="hidden md:table-cell">作者</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="hidden md:table-cell">借閱時間</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b) => (
                  <TableRow key={b.barcode}>
                    <TableCell className="font-mono">{b.barcode}</TableCell>
                    <TableCell className="max-w-[18rem] truncate">{b.title}</TableCell>
                    <TableCell className="hidden md:table-cell">{b.author ?? ""}</TableCell>
                    <TableCell>{b.status === "available" ? "在架上" : "已借出"}</TableCell>
                    <TableCell className="hidden md:table-cell">{b.borrowed_at ? new Date(b.borrowed_at).toLocaleString() : ""}</TableCell>
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">沒有資料</TableCell>
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
