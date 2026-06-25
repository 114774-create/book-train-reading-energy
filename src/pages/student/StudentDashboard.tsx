import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/customAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import WelcomeBanner from "@/components/WelcomeBanner";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { Book } from "@/lib/types";

export default function StudentDashboard() {
  const [books, setBooks] = useState<Book[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ ok: boolean; books: any[] }>("/books");
      setBooks((r.books as any) ?? []);
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

  async function borrow(barcode: string) {
    const t = toast.loading("借閱處理中…");
    try {
      await api("/borrow", { method: "POST", body: JSON.stringify({ barcode }) });
      toast.success("借閱成功");
      load();
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
    }
  }

  async function ret(barcode: string) {
    const t = toast.loading("歸還處理中…");
    try {
      await api("/return", { method: "POST", body: JSON.stringify({ barcode }) });
      toast.success("歸還成功");
      load();
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <WelcomeBanner roleLabel="學生專區" subtitle="你可以在下面查看本班書單，並點選借閱/歸還。" emoji="⭐" />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">學生｜借閱/歸還</h2>
        <div className="flex items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋：登錄號/書名/作者" className="w-64" />
          <Button variant="outline" onClick={load} disabled={loading}>重新整理</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>本班布可列車書籍</CardTitle>
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
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b) => (
                  <TableRow key={b.barcode}>
                    <TableCell className="font-mono">{b.barcode}</TableCell>
                    <TableCell className="max-w-[18rem] truncate">{b.title}</TableCell>
                    <TableCell className="hidden md:table-cell">{b.author ?? ""}</TableCell>
                    <TableCell>
                      {b.status === "available" ? "可借閱" : "已被學生借出"}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.status === "available" ? (
                        <Button size="sm" onClick={() => borrow(b.barcode)}>借閱</Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => ret(b.barcode)}>歸還</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      沒有資料
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
