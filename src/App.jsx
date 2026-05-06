import React, { useState, useEffect, useMemo } from "react";
import { TrendingUp, TrendingDown, DollarSign, Megaphone, Lock, LogOut, Plus, Calendar, BarChart3, FileText, Trash2, Eye, EyeOff, Sparkles, Download, Wifi, WifiOff } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Cell } from "recharts";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, getDoc,
} from "firebase/firestore";
import { db } from "./firebase";

// ---------- CONFIG ----------
const DEFAULT_PASSCODE = "99xbet2026";
const CURRENCY_SYMBOL = "K";
const CURRENCY_CODE = "MMK";
const CONFIG_DOC = doc(db, "config", "main");
const ENTRIES_COL = collection(db, "entries");

// ---------- HELPERS ----------
const fmt = (n) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " " + CURRENCY_SYMBOL;
};

const fmtCompact = (n) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return sign + (abs / 1_000_000_000).toFixed(2) + "B " + CURRENCY_SYMBOL;
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(2) + "M " + CURRENCY_SYMBOL;
  if (abs >= 1_000) return sign + (abs / 1_000).toFixed(1) + "K " + CURRENCY_SYMBOL;
  return sign + abs.toFixed(0) + " " + CURRENCY_SYMBOL;
};

const today = () => new Date().toISOString().slice(0, 10);

// ---------- AUTH ----------
function PasscodeScreen({ onUnlock }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      const snap = await getDoc(CONFIG_DOC);
      const correct = snap.exists() ? snap.data().passcode : DEFAULT_PASSCODE;
      if (!snap.exists()) {
        // First-time setup — write default
        await setDoc(CONFIG_DOC, { passcode: DEFAULT_PASSCODE });
      }
      if (code === correct) {
        sessionStorage.setItem("99xbet:unlocked", "1");
        onUnlock();
      } else {
        setError("Incorrect passcode");
        setCode("");
      }
    } catch (e) {
      console.error(e);
      setError("Could not connect. Check Firebase config.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "radial-gradient(ellipse at top, #1a1f2e 0%, #0a0d14 60%)" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}>
              <Sparkles className="w-6 h-6 text-black" strokeWidth={2.5} />
            </div>
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-white mb-2" style={{ fontFamily: "'Playfair Display', serif", letterSpacing: "-0.02em" }}>
            99xBet
          </h1>
          <p className="text-sm text-zinc-500 tracking-[0.3em] uppercase">Partner Ledger</p>
        </div>

        <div className="bg-zinc-900/60 backdrop-blur-xl border border-zinc-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-zinc-300 tracking-wide">Authorized Access Only</span>
          </div>

          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleSubmit()}
              placeholder="Enter passcode"
              className="w-full bg-black/40 border border-zinc-800 focus:border-amber-400/60 rounded-xl px-4 py-4 text-white text-lg tracking-widest outline-none transition-colors"
              autoFocus
            />
            <button
              onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full mt-6 py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}
          >
            {loading ? "Connecting…" : "Unlock Dashboard"}
          </button>

          <p className="text-xs text-zinc-600 text-center mt-6">
            Default passcode: <span className="text-zinc-400 font-mono">99xbet2026</span> · Change after first login
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- ENTRY FORM ----------
function EntryForm({ onSave, existingDates }) {
  const [date, setDate] = useState(today());
  const [income, setIncome] = useState("");
  const [expenses, setExpenses] = useState("");
  const [marketing, setMarketing] = useState("");
  const [partner, setPartner] = useState(localStorage.getItem("99xbet:partner") || "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const inc = parseFloat(income) || 0;
  const exp = parseFloat(expenses) || 0;
  const mkt = parseFloat(marketing) || 0;
  const profit = inc - exp - mkt;
  const isOverwrite = existingDates.includes(date);

  const handleSave = async () => {
    if (!income && !expenses && !marketing) return;
    setSaving(true);
    if (partner.trim()) localStorage.setItem("99xbet:partner", partner.trim());
    const entry = {
      id: date,
      date,
      income: inc,
      expenses: exp,
      marketing: mkt,
      profit,
      partner: partner.trim() || "—",
      notes: notes.trim(),
      timestamp: new Date().toISOString(),
    };
    try {
      await onSave(entry);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setIncome(""); setExpenses(""); setMarketing(""); setNotes("");
    } catch (e) {
      console.error(e);
      alert("Save failed: " + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
          <Plus className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Daily Entry</h2>
          <p className="text-xs text-zinc-500">Log today's numbers in seconds</p>
        </div>
      </div>

      {isOverwrite && (
        <div className="mb-4 p-3 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-300 text-sm">
          An entry for {date} already exists — saving will overwrite it.
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Date</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <input
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-black/40 border border-zinc-800 rounded-lg pl-10 pr-4 py-3 text-white outline-none focus:border-amber-400/60"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FieldInput label={`Income / Revenue (${CURRENCY_CODE})`} value={income} onChange={setIncome} icon={<TrendingUp className="w-4 h-4" />} accent="emerald" />
          <FieldInput label={`Operating Expenses (${CURRENCY_CODE})`} value={expenses} onChange={setExpenses} icon={<TrendingDown className="w-4 h-4" />} accent="rose" />
          <FieldInput label={`Marketing Spend (${CURRENCY_CODE})`} value={marketing} onChange={setMarketing} icon={<Megaphone className="w-4 h-4" />} accent="sky" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Logged by</label>
            <input
              type="text"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
              placeholder="Your name"
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth flagging"
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60"
            />
          </div>
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl bg-black/40 border border-zinc-800 mt-2">
          <span className="text-sm text-zinc-400 uppercase tracking-wider">Day P/L Preview</span>
          <span className={`text-2xl font-bold ${profit >= 0 ? "text-emerald-400" : "text-rose-400"}`} style={{ fontFamily: "'Playfair Display', serif" }}>
            {fmt(profit)}
          </span>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || (!income && !expenses && !marketing)}
          className="w-full py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : isOverwrite ? "Update Entry" : "Save Entry"}
        </button>
      </div>
    </div>
  );
}

function FieldInput({ label, value, onChange, icon, accent }) {
  const colors = {
    emerald: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    rose: "text-rose-400 bg-rose-400/10 border-rose-400/20",
    sky: "text-sky-400 bg-sky-400/10 border-sky-400/20",
  };
  return (
    <div>
      <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">{label}</label>
      <div className="relative">
        <div className={`absolute left-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center border ${colors[accent]}`}>
          {icon}
        </div>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="w-full bg-black/40 border border-zinc-800 rounded-lg pl-14 pr-4 py-3 text-white text-lg outline-none focus:border-amber-400/60"
        />
      </div>
    </div>
  );
}

// ---------- KPI CARDS ----------
function KpiCard({ label, value, sub, accent, icon }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden">
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-10" style={{ background: accent }} />
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">{label}</span>
        <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: accent + "20", color: accent }}>
          {icon}
        </div>
      </div>
      <div className="text-xl md:text-2xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

// ---------- DASHBOARD ----------
function Dashboard({ entries }) {
  const stats = useMemo(() => {
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const totalIncome = entries.reduce((s, e) => s + e.income, 0);
    const totalExpenses = entries.reduce((s, e) => s + e.expenses, 0);
    const totalMarketing = entries.reduce((s, e) => s + e.marketing, 0);
    const totalProfit = totalIncome - totalExpenses - totalMarketing;
    const last7 = sorted.slice(-7);
    const sum7 = last7.reduce((s, e) => s + e.profit, 0);
    const margin = totalIncome > 0 ? (totalProfit / totalIncome) * 100 : 0;

    let running = 0;
    const chartData = sorted.map((e) => {
      running += e.profit;
      return {
        date: e.date.slice(5),
        income: e.income,
        expenses: e.expenses + e.marketing,
        profit: e.profit,
        cumulative: running,
      };
    });

    return {
      totalIncome, totalExpenses, totalMarketing, totalProfit,
      sum7, margin, chartData,
      last30Data: chartData.slice(-30),
      bestDay: sorted.length ? sorted.reduce((a, b) => (b.profit > a.profit ? b : a)) : null,
      worstDay: sorted.length ? sorted.reduce((a, b) => (b.profit < a.profit ? b : a)) : null,
    };
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center">
        <BarChart3 className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>No data yet</h3>
        <p className="text-zinc-500 text-sm">Add your first daily entry to see the dashboard come to life.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Profit" value={fmtCompact(stats.totalProfit)} sub={`${stats.margin.toFixed(1)}% margin`} accent={stats.totalProfit >= 0 ? "#10b981" : "#f43f5e"} icon={<DollarSign className="w-4 h-4" />} />
        <KpiCard label="Total Revenue" value={fmtCompact(stats.totalIncome)} sub={`${entries.length} entries`} accent="#d4af37" icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Total Costs" value={fmtCompact(stats.totalExpenses + stats.totalMarketing)} sub={`Mkt: ${fmtCompact(stats.totalMarketing)}`} accent="#f43f5e" icon={<TrendingDown className="w-4 h-4" />} />
        <KpiCard label="Last 7 Days" value={fmtCompact(stats.sum7)} sub="Net P/L" accent="#0ea5e9" icon={<Calendar className="w-4 h-4" />} />
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
        <div className="mb-4">
          <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Cumulative Profit</h3>
          <p className="text-xs text-zinc-500">Running total over time</p>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.chartData}>
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d4af37" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#d4af37" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtCompact} />
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8 }}
                labelStyle={{ color: "#a1a1aa" }}
                formatter={(v) => fmt(v)}
              />
              <Area type="monotone" dataKey="cumulative" stroke="#d4af37" strokeWidth={2} fill="url(#cumGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
        <div className="mb-4">
          <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Daily P/L (last 30)</h3>
          <p className="text-xs text-zinc-500">Profit per day</p>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.last30Data}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtCompact} />
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8 }}
                labelStyle={{ color: "#a1a1aa" }}
                formatter={(v) => fmt(v)}
              />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {stats.last30Data.map((d, i) => (
                  <Cell key={i} fill={d.profit >= 0 ? "#10b981" : "#f43f5e"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {stats.bestDay && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-emerald-400/5 border border-emerald-400/20 rounded-2xl p-5">
            <div className="text-xs text-emerald-400 uppercase tracking-wider font-semibold mb-2">Best Day</div>
            <div className="text-xl md:text-2xl font-bold text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>{fmt(stats.bestDay.profit)}</div>
            <div className="text-xs text-zinc-400">{stats.bestDay.date} · by {stats.bestDay.partner}</div>
          </div>
          <div className="bg-rose-400/5 border border-rose-400/20 rounded-2xl p-5">
            <div className="text-xs text-rose-400 uppercase tracking-wider font-semibold mb-2">Worst Day</div>
            <div className="text-xl md:text-2xl font-bold text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>{fmt(stats.worstDay.profit)}</div>
            <div className="text-xs text-zinc-400">{stats.worstDay.date} · by {stats.worstDay.partner}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- HISTORY ----------
function History({ entries, onDelete }) {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const [confirmId, setConfirmId] = useState(null);

  if (entries.length === 0) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center">
        <FileText className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
        <p className="text-zinc-500">No entries yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800">
        <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Ledger</h3>
        <p className="text-xs text-zinc-500">{entries.length} {entries.length === 1 ? "entry" : "entries"} · live synced</p>
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black/30">
            <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider">
              <th className="px-6 py-3 font-semibold">Date</th>
              <th className="px-6 py-3 font-semibold text-right">Income</th>
              <th className="px-6 py-3 font-semibold text-right">Expenses</th>
              <th className="px-6 py-3 font-semibold text-right">Marketing</th>
              <th className="px-6 py-3 font-semibold text-right">P/L</th>
              <th className="px-6 py-3 font-semibold">By</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id} className="border-t border-zinc-800 hover:bg-black/20">
                <td className="px-6 py-4 text-white font-medium">{e.date}</td>
                <td className="px-6 py-4 text-right text-emerald-400">{fmt(e.income)}</td>
                <td className="px-6 py-4 text-right text-rose-400">{fmt(e.expenses)}</td>
                <td className="px-6 py-4 text-right text-sky-400">{fmt(e.marketing)}</td>
                <td className={`px-6 py-4 text-right font-bold ${e.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(e.profit)}</td>
                <td className="px-6 py-4 text-zinc-400">{e.partner}</td>
                <td className="px-6 py-4 text-right">
                  {confirmId === e.id ? (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { onDelete(e.id); setConfirmId(null); }} className="text-rose-400 text-xs font-semibold">Confirm</button>
                      <button onClick={() => setConfirmId(null)} className="text-zinc-500 text-xs">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmId(e.id)} className="text-zinc-500 hover:text-rose-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden divide-y divide-zinc-800">
        {sorted.map((e) => (
          <div key={e.id} className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-white font-semibold">{e.date}</div>
                <div className="text-xs text-zinc-500">by {e.partner}</div>
              </div>
              <div className={`text-lg font-bold ${e.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`} style={{ fontFamily: "'Playfair Display', serif" }}>
                {fmtCompact(e.profit)}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-zinc-500 uppercase tracking-wider">In</div>
                <div className="text-emerald-400 font-medium">{fmtCompact(e.income)}</div>
              </div>
              <div>
                <div className="text-zinc-500 uppercase tracking-wider">Out</div>
                <div className="text-rose-400 font-medium">{fmtCompact(e.expenses)}</div>
              </div>
              <div>
                <div className="text-zinc-500 uppercase tracking-wider">Mkt</div>
                <div className="text-sky-400 font-medium">{fmtCompact(e.marketing)}</div>
              </div>
            </div>
            {e.notes && <div className="mt-3 text-xs text-zinc-400 italic">{e.notes}</div>}
            <div className="mt-3 text-right">
              {confirmId === e.id ? (
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { onDelete(e.id); setConfirmId(null); }} className="text-rose-400 text-xs font-semibold">Confirm delete</button>
                  <button onClick={() => setConfirmId(null)} className="text-zinc-500 text-xs">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(e.id)} className="text-zinc-500 text-xs flex items-center gap-1 ml-auto">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- SETTINGS ----------
function Settings({ entries }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [working, setWorking] = useState(false);

  const handleChange = async () => {
    setMsg(""); setErr(""); setWorking(true);
    try {
      const snap = await getDoc(CONFIG_DOC);
      const correct = snap.exists() ? snap.data().passcode : DEFAULT_PASSCODE;
      if (current !== correct) { setErr("Current passcode is wrong"); setWorking(false); return; }
      if (next.length < 4) { setErr("New passcode must be at least 4 characters"); setWorking(false); return; }
      if (next !== confirm) { setErr("New passcodes don't match"); setWorking(false); return; }
      await setDoc(CONFIG_DOC, { passcode: next });
      setMsg("Passcode updated for all partners");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      setErr("Update failed: " + e.message);
    }
    setWorking(false);
  };

  const exportCSV = () => {
    const headers = ["Date", "Income (MMK)", "Expenses (MMK)", "Marketing (MMK)", "Profit (MMK)", "Logged By", "Notes"];
    const rows = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map(e => [
      e.date, e.income, e.expenses, e.marketing, e.profit, e.partner, (e.notes || "").replace(/"/g, '""')
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `99xbet-ledger-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8 max-w-xl">
        <h3 className="text-xl font-bold text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Change Passcode</h3>
        <p className="text-xs text-zinc-500 mb-6">Shared across all partners — everyone will need the new one.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Current Passcode</label>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">New Passcode</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Confirm New Passcode</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60" />
          </div>
          {err && <p className="text-rose-400 text-sm">{err}</p>}
          {msg && <p className="text-emerald-400 text-sm">{msg}</p>}
          <button onClick={handleChange} disabled={working} className="w-full py-3 rounded-lg font-semibold text-black hover:opacity-90 active:scale-[0.98] transition disabled:opacity-50" style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}>
            {working ? "Updating…" : "Update Passcode"}
          </button>
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8 max-w-xl">
        <h3 className="text-xl font-bold text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Export Data</h3>
        <p className="text-xs text-zinc-500 mb-6">Download a CSV of the full ledger for accounting or backup.</p>
        <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>
    </div>
  );
}

// ---------- MAIN APP ----------
export default function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("99xbet:unlocked") === "1");
  const [entries, setEntries] = useState([]);
  const [tab, setTab] = useState("entry");
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    setLoading(true);
    const unsub = onSnapshot(
      ENTRIES_COL,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        setEntries(list);
        setLoading(false);
      },
      (err) => {
        console.error("Firestore error:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [unlocked]);

  const saveEntry = async (entry) => {
    await setDoc(doc(db, "entries", entry.id), entry);
  };

  const deleteEntry = async (id) => {
    await deleteDoc(doc(db, "entries", id));
  };

  const handleLock = () => {
    sessionStorage.removeItem("99xbet:unlocked");
    setUnlocked(false);
  };

  if (!unlocked) return <PasscodeScreen onUnlock={() => setUnlocked(true)} />;

  const existingDates = entries.map((e) => e.date);

  return (
    <div className="min-h-screen text-white" style={{ background: "radial-gradient(ellipse at top, #1a1f2e 0%, #0a0d14 60%)" }}>
      <header className="border-b border-zinc-800/60 backdrop-blur-xl sticky top-0 z-40 bg-black/40">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}>
              <Sparkles className="w-5 h-5 text-black" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-lg font-bold leading-none" style={{ fontFamily: "'Playfair Display', serif" }}>99xBet</div>
              <div className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase">Partner Ledger</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-1.5 text-xs ${online ? "text-emerald-400" : "text-rose-400"}`}>
              {online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{online ? "Live" : "Offline"}</span>
            </div>
            <button onClick={handleLock} className="flex items-center gap-2 text-zinc-400 hover:text-white text-sm">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Lock</span>
            </button>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 md:px-6 flex gap-1 overflow-x-auto">
          {[
            { id: "entry", label: "New Entry", icon: <Plus className="w-4 h-4" /> },
            { id: "dashboard", label: "Dashboard", icon: <BarChart3 className="w-4 h-4" /> },
            { id: "history", label: "History", icon: <FileText className="w-4 h-4" /> },
            { id: "settings", label: "Settings", icon: <Lock className="w-4 h-4" /> },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                tab === t.id ? "border-amber-400 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8 pb-20">
        {loading ? (
          <div className="text-center py-20 text-zinc-500">Connecting to Firebase…</div>
        ) : (
          <>
            {tab === "entry" && <EntryForm onSave={saveEntry} existingDates={existingDates} />}
            {tab === "dashboard" && <Dashboard entries={entries} />}
            {tab === "history" && <History entries={entries} onDelete={deleteEntry} />}
            {tab === "settings" && <Settings entries={entries} />}
          </>
        )}

        <footer className="mt-12 text-center text-xs text-zinc-600">
          99xBet Partner Ledger · Real-time sync · MMK
        </footer>
      </main>
    </div>
  );
}
