import { useEffect, useState } from "react";
import { api } from "@/lib/customAuth";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import hero from "@/assets/hero_train_books.png";
import iconBook from "@/assets/icon_book.png";
import iconTicket from "@/assets/icon_ticket.png";

interface LoginPageProps {
  onDone?: () => void;
}

type TeacherOption = { account: string; display: string };

export default function LoginPage({ onDone }: LoginPageProps) {
  const auth = useAuth();
  const [studentNo, setStudentNo] = useState("");
  const [teacherAccount, setTeacherAccount] = useState("t01");
  const [adminPassword, setAdminPassword] = useState("114774");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const [teachers, setTeachers] = useState<TeacherOption[]>([]);

  // 從資料庫抓老師名單（後端回傳已遮名 display）
  useEffect(() => {
    api<{ ok: boolean; teachers: TeacherOption[] }>("/teachers")
      .then((r) => setTeachers(r.teachers))
      .catch(() => setTeachers([]));
  }, []);

  // 不使用 Supabase Auth；改走 custom-auth Edge Function

  async function signInAdmin() {
    if (!adminPassword) return toast.error("請輸入密碼");
    setLoading(true);
    const t = toast.loading("登入中…");
    try {
      const r = await api<{ ok: boolean; token: string; user: any }>("/login/admin", {
        method: "POST",
        body: JSON.stringify({ password: adminPassword }),
      });
      const { setSession } = await import("@/lib/customAuth");
      const next = { token: r.token, user: r.user };
      setSession(next);
      auth.set(next);
      toast.success("管理員登入成功");
      onDone?.();
    } catch (e: any) {
      toast.error("登入失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
      setLoading(false);
    }
  }

  async function signInTeacher() {
    if (!teacherPassword) return toast.error("請輸入密碼");
    setLoading(true);
    const t = toast.loading("登入中…");
    try {
      const r = await api<{ ok: boolean; token: string; user: any }>("/login/teacher", {
        method: "POST",
        body: JSON.stringify({ account: teacherAccount, password: teacherPassword }),
      });
      const { setSession } = await import("@/lib/customAuth");
      const next = { token: r.token, user: r.user };
      setSession(next);
      auth.set(next);
      toast.success("老師登入成功");
      onDone?.();
    } catch (e: any) {
      toast.error("登入失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
      setLoading(false);
    }
  }

  async function signInStudent() {
    const account = studentNo.trim();
    if (!/^\d{5}$/.test(account)) return toast.error("請輸入 5 碼學號");

    setLoading(true);
    const t = toast.loading("登入中…");
    try {
      const r = await api<{ ok: boolean; token: string; user: any }>("/login/student", {
        method: "POST",
        body: JSON.stringify({ account }),
      });
      const { setSession } = await import("@/lib/customAuth");
      const next = { token: r.token, user: r.user };
      setSession(next);
      auth.set(next);
      toast.success("學生登入成功");
      onDone?.();
    } catch (e: any) {
      toast.error("登入失敗：" + String(e?.message ?? e));
    } finally {
      toast.dismiss(t);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen p-6 bg-[radial-gradient(circle_at_20%_20%,oklch(0.92_0.12_80),transparent_40%),radial-gradient(circle_at_80%_10%,oklch(0.92_0.12_30),transparent_45%),radial-gradient(circle_at_70%_80%,oklch(0.92_0.12_210),transparent_45%)]">
      <div className="mx-auto max-w-5xl grid lg:grid-cols-2 gap-6 items-center min-h-[calc(100vh-3rem)]">
        <div className="order-2 lg:order-1">
          <Card className="shadow-sm border bg-white/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="tracking-tight text-2xl">青山國小圖書列車</CardTitle>
              <CardDescription>布可列車多功能圖書與閱讀能量管理</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="student">
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="student">學生</TabsTrigger>
                  <TabsTrigger value="teacher">老師</TabsTrigger>
                  <TabsTrigger value="admin">管理員</TabsTrigger>
                </TabsList>

                <TabsContent value="student" className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label>學號（5碼）</Label>
                    <Input value={studentNo} onChange={(e) => setStudentNo(e.target.value)} placeholder="例如 30105" inputMode="numeric" />
                  </div>
                  <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    學生登入免密碼（只要學號存在就能進入）
                  </div>
                  <Button className="w-full" onClick={signInStudent} disabled={loading}>
                    登入
                  </Button>
                </TabsContent>

                <TabsContent value="teacher" className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label>老師</Label>
                    <select
                      className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                      value={teacherAccount}
                      onChange={(e) => setTeacherAccount(e.target.value)}
                    >
                      {(teachers.length ? teachers : [{ account: "t01", display: "王O明" }, { account: "t02", display: "陳O麗" }]).map((t) => (
                        <option key={t.account} value={t.account}>
                          {t.display}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      遮名顯示：姓氏 + O + 最後一字（兩字姓名顯示「姓O」）
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label>密碼</Label>
                    <Input type="password" value={teacherPassword} onChange={(e) => setTeacherPassword(e.target.value)} placeholder="由管理員設定後提供" />
                  </div>
                  <Button className="w-full" onClick={signInTeacher} disabled={loading}>
                    登入
                  </Button>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    目前先提供 2 位預設老師（顯示遮名）。下一步會把「管理員新增老師」接到 Supabase 清單，讓下拉選單自動更新。
                  </p>
                </TabsContent>

                <TabsContent value="admin" className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label>管理員密碼</Label>
                    <Input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="預設 114774" />
                  </div>
                  <Button className="w-full" onClick={signInAdmin} disabled={loading}>
                    進入管理員
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/70 border p-3 flex items-center gap-3">
              <img src={iconBook} alt="" className="h-10 w-10" />
              <div>
                <div className="text-sm font-semibold">圖書管理</div>
                <div className="text-xs text-muted-foreground">書箱分班、借閱狀態</div>
              </div>
            </div>
            <div className="rounded-xl bg-white/70 border p-3 flex items-center gap-3">
              <img src={iconTicket} alt="" className="h-10 w-10" />
              <div>
                <div className="text-sm font-semibold">閱讀能量</div>
                <div className="text-xs text-muted-foreground">月報匯入、榮譽卡</div>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            管理員預設密碼：<span className="font-mono">114774</span>
          </p>
        </div>

        <div className="order-1 lg:order-2">
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-white/30 blur-2xl" />
            <img src={hero} alt="" className="relative w-full rounded-[1.75rem] border shadow-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
