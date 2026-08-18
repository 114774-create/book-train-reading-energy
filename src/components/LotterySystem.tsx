// src/components/LotterySystem.tsx
// 布可列車抽獎系統
// 抽獎權重：借1本=1籤，借2本以上=2籤
// 需要 Supabase 連線，從 app_reading_monthly 取資料

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

const CLASS_CODES = ["101", "201", "301", "401", "501", "601"];
const CLASS_LABELS: Record<string, string> = {
  "101": "一甲", "201": "二甲", "301": "三甲",
  "401": "四甲", "501": "五甲", "601": "六甲",
};

interface Student {
  account: string;
  name: string;
  class_id: string;
  books_added: number;
  tickets: number; // 1 or 2
}

interface Winner {
  account: string;
  name: string;
  class_id: string;
  rank: number;
}

type Phase = "idle" | "spinning" | "done";

// 遮蔽姓名
function maskName(name: string) {
  const s = name.trim();
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + "○";
  return s[0] + "○" + s[s.length - 1];
}

// 從名單＋權重中抽出一個 (不重複)
function drawOne(pool: Student[], excluded: Set<string>): Student | null {
  const available: Student[] = [];
  for (const s of pool) {
    if (excluded.has(s.account)) continue;
    for (let t = 0; t < s.tickets; t++) available.push(s);
  }
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

interface LotterySystemProps {
  onClose: () => void;
}

export default function LotterySystem({ onClose }: LotterySystemProps) {
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  // 篩選
  const [months, setMonths] = useState<string[]>([]); // 可選月份
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedClass, setSelectedClass] = useState<string>("all");

  // 資料
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataReady, setDataReady] = useState(false);

  // 抽獎
  const [drawCount, setDrawCount] = useState(1);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [spinning, setSpinning] = useState<string>("");
  const spinRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showParticipants, setShowParticipants] = useState(true);

  // 後台抽獎完成記錄（per month per class），從 Supabase lottery_records 讀取，跨裝置/跨登入都會保留
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set());

  // 讀取歷史中獎記錄，換算出「哪些月份+班級已經抽過獎」
  async function loadCompletedKeys() {
    const { data } = await supabase
      .from("lottery_records")
      .select("year_month, class_id");
    const keys = new Set<string>();
    (data ?? []).forEach((r: any) => {
      keys.add(`${r.year_month}-${r.class_id}`);
      keys.add(`${r.year_month}-all`); // 只要該月有任何一筆記錄，全校抽獎也視為已進行過
    });
    setCompletedKeys(keys);
  }

  // 管理員密碼驗證（從 app_users 取 admin 的 password_hash 比對）
  async function handleAuth() {
    const { data } = await supabase
      .from("app_users")
      .select("password_hash")
      .eq("account", "admin")
      .single();
    if (data?.password_hash === pwInput) {
      setAuthed(true);
      setPwError(false);
    } else {
      setPwError(true);
    }
  }

  // 載入可用月份 + 已完成的抽獎狀態
  useEffect(() => {
    if (!authed) return;
    supabase
      .from("app_reading_monthly")
      .select("year_month")
      .then(({ data }) => {
        const yms = [...new Set((data ?? []).map((r: any) => r.year_month as string))].sort().reverse();
        setMonths(yms);
        if (yms.length > 0) setSelectedMonth(yms[0]);
      });
    loadCompletedKeys();
  }, [authed]);

  // 載入學生資料
  async function loadStudents() {
    if (!selectedMonth) return;
    setLoading(true);
    setDataReady(false);
    setWinners([]);
    setPhase("idle");

    const query = supabase
      .from("app_reading_monthly")
      .select("account, books_added")
      .eq("year_month", selectedMonth)
      .gte("books_added", 1);

    const { data: monthly } = await query;

    // 補上學生姓名和班級
    const accounts = (monthly ?? []).map((r: any) => r.account);
    let userMap: Record<string, { name: string; class_id: string }> = {};
    if (accounts.length > 0) {
      const { data: users } = await supabase
        .from("app_users")
        .select("account, name, class_id")
        .in("account", accounts);
      (users ?? []).forEach((u: any) => { userMap[u.account] = u; });
    }

    const all: Student[] = (monthly ?? [])
      .map((r: any) => {
        const u = userMap[r.account];
        if (!u) return null;
        return {
          account: r.account,
          name: u.name ?? r.account,
          class_id: u.class_id ?? "",
          books_added: r.books_added ?? 0,
          tickets: Math.min(r.books_added ?? 0, 2),
        };
      })
      .filter(Boolean) as Student[];

    setStudents(all);
    setDataReady(true);
    setLoading(false);
  }

  useEffect(() => {
    if (authed && selectedMonth) loadStudents();
  }, [selectedMonth, authed]);

  const filtered = useMemo(() => {
    if (selectedClass === "all") return students;
    return students.filter(s => s.class_id === selectedClass);
  }, [students, selectedClass]);

  const totalTickets = filtered.reduce((s, r) => s + r.tickets, 0);

  const sortedParticipants = useMemo(() => {
    return [...filtered].sort((a, b) => b.tickets - a.tickets || a.name.localeCompare(b.name, "zh-Hant"));
  }, [filtered]);

  // 抽獎動畫
  async function startDraw() {
    if (phase !== "idle" || !filtered.length) return;
    const key = `${selectedMonth}-${selectedClass}`;
    if (completedKeys.has(key)) {
      if (!confirm(`「${selectedMonth} ${selectedClass === "all" ? "全校" : CLASS_LABELS[selectedClass] ?? selectedClass}」已完成抽獎，確定要重新抽？`)) return;
    }

    const excluded = new Set(winners.map(w => w.account));
    setPhase("spinning");

    // 跑馬燈動畫
    let tick = 0;
    const names = filtered.map(s => s.name);
    spinRef.current = setInterval(() => {
      setSpinning(names[tick % names.length]);
      tick++;
    }, 80);

    // 抽出所有得獎者
    await new Promise(res => setTimeout(res, 2000));
    if (spinRef.current) clearInterval(spinRef.current);

    const newWinners: Winner[] = [];
    const usedAccounts = new Set(excluded);
    for (let i = 0; i < drawCount; i++) {
      const winner = drawOne(filtered, usedAccounts);
      if (!winner) break;
      usedAccounts.add(winner.account);
      newWinners.push({
        account: winner.account,
        name: winner.name,
        class_id: winner.class_id,
        rank: winners.length + i + 1,
      });
    }

    setSpinning(newWinners[0]?.name ?? "");
    setWinners(prev => [...prev, ...newWinners]);
    setPhase("done");

    // 寫入 Supabase，記錄本次中獎名單
    if (newWinners.length) {
      const rows = newWinners.map(w => ({
        year_month: selectedMonth,
        class_id: w.class_id || "unknown",
        winner_account: w.account,
        winner_name: w.name,
        rank: w.rank,
      }));
      const { error } = await supabase.from("lottery_records").insert(rows);
      if (error) {
        console.error("寫入中獎記錄失敗:", error);
      } else {
        loadCompletedKeys();
      }
    }
  }

  function handleClose() {
    setPhase("idle");
    setWinners([]);
  }

  function handleReset() {
    setWinners([]);
    setPhase("idle");
    setSpinning("");
  }

  // 未驗證：密碼輸入
  if (!authed) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-white rounded-3xl shadow-2xl p-8 w-80 flex flex-col gap-4 items-center">
          <div className="text-4xl">🎰</div>
          <h2 className="text-xl font-bold text-center">布可抽獎系統</h2>
          <p className="text-sm text-gray-500 text-center">請輸入管理員密碼以開啟抽獎</p>
          <input
            type="password"
            className={`w-full border rounded-xl px-4 py-2 text-center text-lg tracking-widest focus:outline-none focus:ring-2 ${pwError ? "border-red-400 focus:ring-red-300" : "border-gray-300 focus:ring-amber-300"}`}
            placeholder="••••••"
            value={pwInput}
            onChange={e => setPwInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAuth()}
            autoFocus
          />
          {pwError && <p className="text-red-500 text-sm">密碼錯誤，請再試一次</p>}
          <button
            onClick={handleAuth}
            className="w-full bg-amber-400 hover:bg-amber-500 text-white font-bold py-2 rounded-xl transition"
          >
            進入抽獎
          </button>
        </div>
      </div>
    );
  }

  // 沒有資料
  if (dataReady && students.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-white rounded-3xl shadow-2xl p-8 w-96 flex flex-col gap-4 items-center">
          <div className="text-5xl">📭</div>
          <h2 className="text-xl font-bold">目前非開放時間</h2>
          <p className="text-gray-500 text-sm text-center">尚無本月借閱資料，請先匯入 Excel 月報。</p>
          <button onClick={() => onClose()} className="mt-2 px-6 py-2 bg-gray-200 hover:bg-gray-300 rounded-xl font-medium transition">關閉</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-amber-900/80 to-orange-800/80 backdrop-blur-sm p-4">
      <div
        className="relative bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        style={{ width: "min(700px, 96vw)", maxHeight: "92vh" }}
      >
        {/* 頂部裝飾 */}
        <div className="bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-400 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-white tracking-wide">⛏️ 布可星球挖寶抽獎</h1>
            <p className="text-amber-100 text-xs mt-0.5">閱讀越多、中獎機率越高！</p>
          </div>
          <button
            onClick={() => onClose()}
            className="text-white/70 hover:text-white text-2xl leading-none font-bold"
          >✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* 篩選 */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-32">
              <label className="block text-xs font-bold text-gray-500 mb-1">月份</label>
              <select
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                disabled={phase === "spinning"}
              >
                {months.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-32">
              <label className="block text-xs font-bold text-gray-500 mb-1">班級</label>
              <select
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                value={selectedClass}
                onChange={e => { setSelectedClass(e.target.value); setWinners([]); setPhase("idle"); }}
                disabled={phase === "spinning"}
              >
                <option value="all">全校</option>
                {CLASS_CODES.map(c => (
                  <option key={c} value={c}>{CLASS_LABELS[c] ?? c}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-24">
              <label className="block text-xs font-bold text-gray-500 mb-1">抽出幾名</label>
              <input
                type="number"
                min={1}
                max={filtered.length}
                value={drawCount}
                onChange={e => setDrawCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                disabled={phase === "spinning"}
              />
            </div>
          </div>

          {/* 統計 */}
          {dataReady && (
            <div className="flex gap-3">
              <div className="flex-1 bg-amber-50 rounded-2xl p-3 text-center border border-amber-100">
                <p className="text-2xl font-extrabold text-amber-600">{filtered.length}</p>
                <p className="text-xs text-gray-500 mt-0.5">參加人數</p>
              </div>
              <div className="flex-1 bg-orange-50 rounded-2xl p-3 text-center border border-orange-100">
                <p className="text-2xl font-extrabold text-orange-500">{totalTickets}</p>
                <p className="text-xs text-gray-500 mt-0.5">總籤數</p>
              </div>
              <div className="flex-1 bg-yellow-50 rounded-2xl p-3 text-center border border-yellow-100">
                <p className="text-2xl font-extrabold text-yellow-600">{winners.length}</p>
                <p className="text-xs text-gray-500 mt-0.5">已抽出</p>
              </div>
            </div>
          )}

          {/* 參加名單：姓名 + 各自機會（籤數） */}
          {dataReady && filtered.length > 0 && (
            <div className="rounded-2xl border overflow-hidden">
              <button
                type="button"
                onClick={() => setShowParticipants(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition text-left"
              >
                <span className="text-sm font-bold text-gray-600">🧒 參加名單（{filtered.length} 人）</span>
                <span className="text-xs text-gray-400">{showParticipants ? "收合 ▲" : "展開 ▼"}</span>
              </button>
              {showParticipants && (
                <div className="max-h-48 overflow-y-auto p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {sortedParticipants.map(s => {
                      const isWinner = winners.some(w => w.account === s.account);
                      return (
                        <div
                          key={s.account}
                          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-sm ${isWinner ? "bg-amber-50 border-amber-300" : "bg-white border-gray-100"}`}
                        >
                          <span className={`font-medium truncate ${isWinner ? "text-amber-700" : "text-gray-700"}`}>
                            {isWinner ? "🏆 " : ""}{maskName(s.name)}
                          </span>
                          <span className="shrink-0 text-xs font-bold text-orange-500 bg-orange-50 rounded-full px-2 py-0.5">
                            ⛏️ ×{s.tickets}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 抽獎動畫 */}
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-6 text-center min-h-32 flex flex-col items-center justify-center gap-3">
            {phase === "idle" && winners.length === 0 && (
              <p className="text-gray-400 text-sm">✨ 按下「開始抽獎」開始挖寶！</p>
            )}
            {phase === "spinning" && (
              <>
                <p className="text-xs text-amber-500 font-bold animate-pulse">⛏️ 挖掘中…</p>
                <p className="text-4xl font-extrabold text-amber-700 tracking-widest animate-bounce">{spinning}</p>
              </>
            )}
            {phase === "done" && (
              <>
                <p className="text-sm text-green-600 font-bold">🎉 恭喜得獎！</p>
                <div className="flex flex-wrap gap-4 justify-center">
                  {winners.slice(-drawCount).map(w => (
                    <div key={w.account} className="flex flex-col items-center animate-bounce">
                      <span className="text-5xl md:text-6xl font-black text-amber-600 drop-shadow-sm tracking-wide">
                        {maskName(w.name)}
                      </span>
                      <span className="mt-1 text-sm font-bold text-white bg-amber-400 px-3 py-0.5 rounded-full shadow">
                        {CLASS_LABELS[w.class_id] ?? w.class_id}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 按鈕區 */}
          <div className="flex gap-3">
            <button
              onClick={startDraw}
              disabled={phase === "spinning" || !dataReady || filtered.length === 0}
              className="flex-1 bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-500 hover:to-orange-500 disabled:opacity-40 text-white font-extrabold py-3 rounded-2xl text-base shadow transition"
            >
              {phase === "spinning" ? "⛏️ 抽獎中…" : "⛏️ 開始抽獎"}
            </button>
            {winners.length > 0 && phase !== "spinning" && (
              <button
                onClick={handleReset}
                className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-2xl transition"
              >
                重置
              </button>
            )}
          </div>

          {/* 中獎名單 */}
          {winners.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-600 mb-2">📋 本次中獎名單</h3>
              <div className="rounded-2xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-amber-50 text-gray-500 text-xs">
                      <th className="py-2 px-3 text-left">#</th>
                      <th className="py-2 px-3 text-left">班級</th>
                      <th className="py-2 px-3 text-left">姓名</th>
                      <th className="py-2 px-3 text-left">學號</th>
                    </tr>
                  </thead>
                  <tbody>
                    {winners.map((w) => (
                      <tr key={w.account} className="border-t hover:bg-amber-50/50">
                        <td className="py-2 px-3 font-bold text-amber-600">{w.rank}</td>
                        <td className="py-2 px-3">{CLASS_LABELS[w.class_id] ?? w.class_id}</td>
                        <td className="py-2 px-3 font-medium">{maskName(w.name)}</td>
                        <td className="py-2 px-3 font-mono text-gray-400">{w.account}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 結束按鈕 */}
          <button
            onClick={handleClose}
            className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-500 text-sm font-medium rounded-2xl transition"
          >
            清空本次結果，繼續抽下一批
          </button>

          {/* 完成提示 */}
          {completedKeys.size > 0 && (
            <div className="text-xs text-gray-400 text-center">
              已完成：{[...completedKeys].map(k => {
                const [m, c] = k.split("-");
                return `${m} ${c === "all" ? "全校" : CLASS_LABELS[c] ?? c}`;
              }).join("、")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
