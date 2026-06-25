import { useEffect, useState } from "react";
import { api } from "@/lib/customAuth";
import { supabase } from "@/lib/supabase";
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

  function maskName(name: string) {
    const s = name.trim();
    if (!s) return "";
    if (s.length === 1) return s;
    if (s.length === 2) return s[0] + "O";
    return s[0] + "O" + s[s.length - 1];
  }

  // 老師名單：直接從 app_users 撈取並在前端遮名（不依賴 Edge Function）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.from("app_users").select("account,name").eq("role", "teacher").order("account");
        if (error) throw error;
        const opts = (data ?? []).map((t: any) => ({ account: t.account, display: maskName(String(t.name ?? "")) }));
        if (alive) setTeachers(opts);
      } catch {
        if (alive) setTeachers([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 不使用 Supabase Auth；老師/學生仍沿用既有 custom-auth；管理員改用 DB RPC

  async function signInAdmin() {
    if (!adminPassword) return toast.error("請輸入密碼");
    setLoading(true);
    const t = toast.loading("登入中…");
    try {
      // 改用 Supabase DB RPC：不需要 Edge Function、不需要 JWT。
      // 注意：RPC 會在 DB 端比對 app_users(account='admin') 的 password_hash（目前存明文）。
      const { data, error } = await supabase.rpc("rpc_login_admin", { p_password: adminPassword });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "login_failed");

      const { setSession } = await import("@/lib/customAuth");
      const next = { token: `local-rpc:${Date.now()}`, user: data.user };
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
    <div className="min-h-screen p-6 bg-[radial-gradient(circle_at_18%_18%,oklch(0.94_0.13_85),transparent_42%),radial-gradient(circle_at_85%_12%,oklch(0.95_0.14_35),transparent_48%),radial-gradient(circle_at_70%_85%,oklch(0.94_0.14_215),transparent_48%)]">
      <div className="mx-auto max-w-5xl grid lg:grid-cols-2 gap-6 items-center min-h-[calc(100vh-3rem)]">
        <div className="order-2 lg:order-1">
          <Card className="rounded-3xl border bg-white/90 backdrop-blur shadow-[0_18px_45px_-18px_rgba(245,158,11,0.45),0_14px_35px_-22px_rgba(59,130,246,0.35)]">
            <CardHeader>
              <CardTitle className="tracking-tight text-3xl">青山國小圖書列車</CardTitle>
              <CardDescription>布可列車多功能圖書與閱讀能量管理</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="student" className="">
                <TabsList className="grid grid-cols-3 w-full rounded-2xl bg-white/70 p-1 shadow-[0_10px_25px_-18px_rgba(2,132,199,0.35)]">
                  <TabsTrigger value="student" className="rounded-xl data-[state=active]:bg-amber-400 data-[state=active]:text-white transition-transform hover:-translate-y-0.5 hover:shadow-lg">學生</TabsTrigger>
                  <TabsTrigger value="teacher" className="rounded-xl data-[state=active]:bg-sky-500 data-[state=active]:text-white transition-transform hover:-translate-y-0.5 hover:shadow-lg">老師</TabsTrigger>
                  <TabsTrigger value="admin" className="rounded-xl data-[state=active]:bg-violet-500 data-[state=active]:text-white transition-transform hover:-translate-y-0.5 hover:shadow-lg">管理員</TabsTrigger>
                </TabsList>

                <TabsContent value="student" className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label>學號（5碼）</Label>
                    <Input className="h-12 rounded-2xl px-4" value={studentNo} onChange={(e) => setStudentNo(e.target.value)} placeholder="例如 30105" inputMode="numeric" />
                  </div>
                  <div className="rounded-2xl border bg-amber-50/60 px-4 py-3 text-sm text-muted-foreground">
                    學生登入免密碼（只要學號存在就能進入）
                  </div>
                  <Button className="w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-400 text-white shadow-[0_14px_28px_-18px_rgba(245,158,11,0.85)] transition-transform hover:-translate-y-1 hover:shadow-lg active:translate-y-0" onClick={signInStudent} disabled={loading}>
                    登入
                  </Button>
                </TabsContent>

                <TabsContent value="teacher" className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label>老師</Label>
                    <select
                      className="w-full h-12 rounded-2xl border bg-white px-4 text-sm shadow-[0_12px_24px_-18px_rgba(59,130,246,0.35)] focus:outline-none"
                      value={teacherAccount}
                      onChange={(e) => setTeacherAccount(e.target.value)}
                    >
                      {(teachers.length ? teachers : [{ account: "t01", display: "王O明" }, { account: "t02", display: "陳O麗" }]).map((t) => (
                        <option key={t.account} value={t.account}>
                          {t.display}
                        </option>
                      ))}
                    </select>

                  </div>
                  <div className="space-y-1">
                    <Label>密碼</Label>
                    <Input className="h-12 rounded-2xl px-4" type="password" value={teacherPassword} onChange={(e) => setTeacherPassword(e.target.value)} placeholder="請輸入密碼" />
                  </div>
                  <Button className="w-full h-12 rounded-2xl bg-sky-500 hover:bg-sky-400 text-white shadow-[0_14px_28px_-18px_rgba(14,165,233,0.85)] transition-transform hover:-translate-y-1 hover:shadow-lg active:translate-y-0" onClick={signInTeacher} disabled={loading}>
                    登入
                  </Button>

                </TabsContent>

                <TabsContent value="admin" className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label>管理員密碼</Label>
                    <Input className="h-12 rounded-2xl px-4" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="請輸入密碼" />
                  </div>
                  <Button className="w-full h-12 rounded-2xl bg-violet-500 hover:bg-violet-400 text-white shadow-[0_14px_28px_-18px_rgba(139,92,246,0.85)] transition-transform hover:-translate-y-1 hover:shadow-lg active:translate-y-0" onClick={signInAdmin} disabled={loading}>
                    進入管理員
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-3xl bg-white/80 border p-4 flex items-center gap-3 shadow-[0_16px_30px_-22px_rgba(245,158,11,0.35)] transition-transform hover:-translate-y-1">
              <img src={iconBook} alt="" className="h-10 w-10" />
              <div>
                <div className="text-sm font-semibold">圖書管理</div>
                <div className="text-xs text-muted-foreground">書箱分班、借閱狀態</div>
              </div>
            </div>
            <div className="rounded-3xl bg-white/80 border p-4 flex items-center gap-3 shadow-[0_16px_30px_-22px_rgba(14,165,233,0.35)] transition-transform hover:-translate-y-1">
              <img src={iconTicket} alt="" className="h-10 w-10" />
              <div>
                <div className="text-sm font-semibold">閱讀能量</div>
                <div className="text-xs text-muted-foreground">月報匯入、榮譽卡</div>
              </div>
            </div>
          </div>


        </div>

        <div className="order-1 lg:order-2">
          <div className="relative">
            <div className="absolute -inset-5 rounded-[2.5rem] bg-white/40 blur-2xl" />
            <img src={hero} alt="" className="relative w-full rounded-[2.25rem] border shadow-[0_24px_60px_-30px_rgba(14,165,233,0.35)] transition-transform duration-300 hover:scale-[1.02]" />
          </div>
        </div>
      </div>
    </div>
  );
}
