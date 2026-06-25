import { useMemo, useState } from "react";
import { getSession } from "@/lib/customAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

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

export default function AdminDashboard() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [excel, setExcel] = useState<File | null>(null);
  const [yearMonth, setYearMonth] = useState("");
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState<{ student_no: string; name: string }[]>([]);

  const ymDefault = useMemo(() => {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, []);

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

  async function importExcel() {
    if (!excel) return toast.error("請選擇 Excel");
    setLoading(true);
    const t = toast.loading("匯入 Excel 月報中…");
    try {
      const excel_base64 = await fileToBase64(excel);
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
        body: JSON.stringify({ excel_base64, year_month: (yearMonth || ymDefault).trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || res.statusText);
      setMissing(data.missing_in_db ?? []);
      toast.success(`完成：處理 ${data.processed} 筆（${data.year_month}）`);
    } catch (e: any) {
      toast.error("匯入失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">管理員端｜匯入與管理</h2>
        <p className="text-sm text-muted-foreground mt-1">核心功能：書箱 PDF 智慧匯入、每月 Excel 報表匯入比對</p>
      </div>

      <Tabs defaultValue="pdf">
        <TabsList className="grid grid-cols-2 w-full max-w-lg">
          <TabsTrigger value="pdf">PDF 書箱匯入</TabsTrigger>
          <TabsTrigger value="excel">Excel 月報匯入</TabsTrigger>
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
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>後續功能（下一版接續）</CardTitle>
          <CardDescription>人事管理（升年級/轉出）、排行榜、匯出 Excel、圖表下載</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          本版先把 Supabase DB/RLS、檔案匯入核心流程與三角色基本頁面打通，後續我會在同一專案內繼續加上完整的管理/報表/圖表。
        </CardContent>
      </Card>
    </div>
  );
}
