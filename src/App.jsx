import React, { useState, useEffect, useMemo } from "react";
import { TrendingUp, TrendingDown, DollarSign, Megaphone, Lock, LogOut, Plus, Calendar, BarChart3, FileText, Trash2, Eye, EyeOff, Sparkles, Download, Wifi, WifiOff, CalendarDays, ChevronLeft, ChevronRight, Upload, Image as ImageIcon, Loader2, X, ArrowDownCircle, ArrowUpCircle, Users, PiggyBank, HandCoins, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Cell } from "recharts";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, getDoc,
} from "firebase/firestore";
import { db, auth } from "./firebase";
import { signInAnonymously, onAuthStateChanged, signOut } from "firebase/auth";

// ---------- CONFIG ----------
const DEFAULT_PASSCODE = "99xbet2026";
const CURRENCY_SYMBOL = "Kyats";
const CURRENCY_CODE = "MMK";
const CONFIG_DOC = doc(db, "config", "main");
const ENTRIES_COL = collection(db, "entries");
const TX_COL = collection(db, "transactions");
const PARTNERS_COL = collection(db, "partners");
const RECURRING_COL = collection(db, "recurringExpenses");

// ---------- HELPERS ----------
// Full-number currency formatter — used everywhere except chart Y-axes.
// Example: fmt(7860000) -> "7,860,000 Kyats"
const fmt = (n) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " " + CURRENCY_SYMBOL;
};

// Compact, axis-only formatter — used ONLY on chart Y-axis labels where
// space is tight. No currency unit (the chart title makes it clear).
// Example: fmtAxis(7860000) -> "7.86M"
const fmtAxis = (n) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return sign + (abs / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return sign + (abs / 1_000).toFixed(1) + "K";
  return sign + abs.toFixed(0);
};

const today = () => new Date().toISOString().slice(0, 10);

// Advance an ISO date string by one cycle (monthly, yearly, or weekly).
// Pure string math to avoid timezone footguns: `new Date("2026-02-10T00:00:00")`
// parses as local midnight, which becomes a different UTC date in any
// non-UTC timezone, and toISOString() returns UTC — causing the date to
// drift backwards by a day each cycle in timezones west of UTC.
function advanceDate(isoDate, cycle) {
  const [yStr, mStr, dStr] = isoDate.split("-");
  let year = parseInt(yStr, 10);
  let month = parseInt(mStr, 10); // 1-12
  let day = parseInt(dStr, 10);

  if (cycle === "weekly") {
    // Weekly add 7 days — use UTC math to stay timezone-safe
    const utc = Date.UTC(year, month - 1, day);
    const next = new Date(utc + 7 * 24 * 60 * 60 * 1000);
    return next.toISOString().slice(0, 10);
  }
  if (cycle === "yearly") {
    year += 1;
    // Feb 29 -> Feb 28 in non-leap year
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    day = Math.min(day, lastDay);
  } else {
    // monthly (default)
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    // Cap day at month-end (Jan 31 -> Feb 28)
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    day = Math.min(day, lastDay);
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

// ---------- DATA MODEL HELPERS ----------
// We have two collections:
//   "entries"     - legacy daily summary entries (one per date) — historical/imported
//   "transactions" - per-transaction records, going forward
// This function unifies them into a single per-day shape for charts/dashboards.
//
// Each transaction shape:
//   { id, date, time, amount, kind: "income" | "expense" | "marketing",
//     name, notes, partner, source: "manual" | "slip", timestamp }
function buildDayMap(legacyEntries, transactions) {
  const map = {};

  // Layer in legacy daily entries first
  legacyEntries.forEach((e) => {
    map[e.date] = {
      date: e.date,
      income: e.income || 0,
      expenses: e.expenses || 0,
      // Legacy entries don't have fixed/variable split — count all as variable
      // by default. They can be retro-tagged if needed via direct edit.
      fixedExpenses: 0,
      variableExpenses: e.expenses || 0,
      // Shared expenses are absorbed by all current partners equally,
      // not by partners-active-on-that-day. Used for startup/setup costs.
      sharedExpenses: 0,
      regularExpenses: e.expenses || 0,
      marketing: e.marketing || 0,
      profit: 0,
      partner: e.partner || "—",
      notes: e.notes || "",
      transactions: [],
      hasLegacy: true,
    };
  });

  // Layer transactions on top
  transactions.forEach((t) => {
    if (!map[t.date]) {
      map[t.date] = {
        date: t.date,
        income: 0,
        expenses: 0,
        fixedExpenses: 0,
        variableExpenses: 0,
        sharedExpenses: 0,
        regularExpenses: 0,
        marketing: 0,
        profit: 0,
        partner: t.partner || "—",
        notes: "",
        transactions: [],
        hasLegacy: false,
      };
    }
    if (t.kind === "income") map[t.date].income += t.amount;
    else if (t.kind === "expense") {
      map[t.date].expenses += t.amount;
      // Default to variable if not tagged (back-compat with old expense records)
      if (t.category === "fixed") map[t.date].fixedExpenses += t.amount;
      else map[t.date].variableExpenses += t.amount;
      // Shared vs regular for partner attribution
      if (t.shared === true) map[t.date].sharedExpenses += t.amount;
      else map[t.date].regularExpenses += t.amount;
    }
    else if (t.kind === "marketing") map[t.date].marketing += t.amount;
    map[t.date].transactions.push(t);
  });

  // Recompute profit
  Object.values(map).forEach((d) => {
    d.profit = d.income - d.expenses - d.marketing;
    // Sort transactions by time (descending — most recent first)
    d.transactions.sort((a, b) => (b.time || "").localeCompare(a.time || ""));
  });

  return map;
}

// ---------- AUTH ----------
// Lockout configuration
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPTS_KEY = "99xbet:attempts";
const LOCKOUT_KEY = "99xbet:lockedUntil";

function PasscodeScreen({ onUnlock }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authReady, setAuthReady] = useState(!!auth.currentUser);
  const [lockedUntil, setLockedUntil] = useState(() => {
    const stored = parseInt(localStorage.getItem(LOCKOUT_KEY) || "0", 10);
    return stored > Date.now() ? stored : 0;
  });
  const [now, setNow] = useState(Date.now());

  // Sign in anonymously as soon as the passcode screen mounts. Without this,
  // we can't read the config doc (which holds the passcode) under locked-down
  // Firestore rules. The anonymous sign-in itself doesn't grant meaningful
  // access — the real check is still the passcode below.
  useEffect(() => {
    if (auth.currentUser) {
      setAuthReady(true);
      return;
    }
    let cancelled = false;
    signInAnonymously(auth)
      .then(() => { if (!cancelled) setAuthReady(true); })
      .catch((err) => {
        console.error("Anonymous sign-in failed:", err);
        if (!cancelled) setError("Could not connect. Check Firebase Auth setup.");
      });
    return () => { cancelled = true; };
  }, []);

  // Tick every second while locked, so the countdown updates and unlocks itself when time's up
  useEffect(() => {
    if (!lockedUntil) return;
    const interval = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        // Lock expired — clear it
        localStorage.removeItem(LOCKOUT_KEY);
        localStorage.removeItem(ATTEMPTS_KEY);
        setLockedUntil(0);
        setError("");
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  const isLocked = lockedUntil > now;
  const remaining = Math.max(0, lockedUntil - now);
  const remainingMin = Math.floor(remaining / 60000);
  const remainingSec = Math.floor((remaining % 60000) / 1000);

  const recordFailedAttempt = () => {
    const current = parseInt(localStorage.getItem(ATTEMPTS_KEY) || "0", 10);
    const newCount = current + 1;
    if (newCount >= MAX_ATTEMPTS) {
      const lockTime = Date.now() + LOCKOUT_MS;
      localStorage.setItem(LOCKOUT_KEY, String(lockTime));
      localStorage.setItem(ATTEMPTS_KEY, String(newCount));
      setLockedUntil(lockTime);
      setError(`Too many failed attempts. Locked for 15 minutes.`);
    } else {
      localStorage.setItem(ATTEMPTS_KEY, String(newCount));
      const remaining = MAX_ATTEMPTS - newCount;
      setError(`Incorrect passcode. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before lockout.`);
    }
  };

  const resetAttempts = () => {
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
  };

  const handleSubmit = async () => {
    if (isLocked) return;
    if (!authReady) {
      setError("Still connecting… please wait a moment.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const snap = await getDoc(CONFIG_DOC);
      const data = snap.exists() ? snap.data() : null;
      const editorPasscode = data?.passcode || DEFAULT_PASSCODE;
      const viewerPasscode = data?.viewerPasscode || null;

      if (!snap.exists()) {
        // First-time setup — write default editor passcode
        await setDoc(CONFIG_DOC, { passcode: DEFAULT_PASSCODE });
      }

      let role = null;
      if (code === editorPasscode) role = "editor";
      else if (viewerPasscode && code === viewerPasscode) role = "viewer";

      if (role) {
        // We're already signed in anonymously (happened when this screen mounted).
        // Just record the role and route into the app.
        resetAttempts();
        sessionStorage.setItem("99xbet:unlocked", "1");
        sessionStorage.setItem("99xbet:role", role);
        onUnlock(role);
      } else {
        recordFailedAttempt();
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
            Ledger
          </h1>
          <p className="text-sm text-zinc-500 tracking-[0.3em] uppercase">Partner Access</p>
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
              onChange={(e) => { setCode(e.target.value); if (!isLocked) setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && !loading && !isLocked && handleSubmit()}
              placeholder={isLocked ? "Locked" : "Enter passcode"}
              disabled={isLocked}
              className="w-full bg-black/40 border border-zinc-800 focus:border-amber-400/60 rounded-xl px-4 py-4 text-white text-lg tracking-widest outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              autoFocus={!isLocked}
            />
            <button
              onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          {isLocked ? (
            <div className="mt-4 p-4 rounded-lg bg-rose-400/10 border border-rose-400/30 text-center">
              <p className="text-rose-300 text-sm font-semibold mb-1">Locked due to too many failed attempts</p>
              <p className="text-rose-400 text-2xl font-semibold tabular-nums">
                {String(remainingMin).padStart(2, "0")}:{String(remainingSec).padStart(2, "0")}
              </p>
              <p className="text-zinc-500 text-xs mt-1">until next attempt allowed</p>
            </div>
          ) : (
            error && <p className="text-rose-400 text-sm mt-3">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || isLocked}
            className="w-full mt-6 py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}
          >
            {isLocked ? "Locked" : loading ? "Connecting…" : "Unlock Dashboard"}
          </button>

          <p className="text-xs text-zinc-600 text-center mt-6">
            Authorized partners only
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- SLIP UPLOAD ----------
function SlipUpload({ onSave, dayMap }) {
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState(null); // "income" or "expense"
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const existingEntry = dayMap[date];

  const parseAmount = (text) => {
    // Find the most prominent monetary amount in the text.
    // Tesseract output for KBZPay usually has the amount as the largest standalone number.
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    // Pass 1: minus-sign amount (KBZPay outgoing slips show "-50,000.00")
    for (const line of lines) {
      const m = line.match(/[-−–]\s*([\d,]+\.?\d{0,2})/);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ""));
        if (num >= 100) return num;
      }
    }

    // Pass 2: amount with Ks/MMK/Kyat marker
    for (const line of lines) {
      const m = line.match(/([\d,]+\.?\d{0,2})\s*(?:\(?ks\)?|mmk|kyat)/i);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ""));
        if (num >= 100) return num;
      }
    }

    // Pass 3: amount on a line with "Amount" label
    for (const line of lines) {
      if (/amount/i.test(line)) {
        const m = line.match(/([\d,]+\.?\d{0,2})/);
        if (m) {
          const num = parseFloat(m[1].replace(/,/g, ""));
          if (num >= 100) return num;
        }
      }
    }

    // Pass 4: largest reasonable number anywhere
    const allNums = (text.match(/[\d,]+\.?\d{0,2}/g) || [])
      .map((n) => parseFloat(n.replace(/,/g, "")))
      .filter((n) => !isNaN(n) && n >= 100 && n < 1_000_000_000);
    if (allNums.length) return Math.max(...allNums);

    return null;
  };

  const handlePickFiles = (cat) => (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;
    setCategory(cat);
    setFiles(picked);
    setResults([]);
    setSaveMsg("");
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress({ current: 0, total: files.length });
    setResults([]);

    const Tesseract = (await import("tesseract.js")).default;

    const out = [];
    for (let i = 0; i < files.length; i++) {
      setProgress({ current: i + 1, total: files.length });
      // Stable per-result uid generated once. Used to build a deterministic
      // Firestore doc ID at save time so accidental double-taps overwrite
      // the same record instead of creating duplicates.
      const uid = `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 9)}`;
      try {
        const { data } = await Tesseract.recognize(files[i], "eng");
        const amount = parseAmount(data.text);
        out.push({
          uid,
          fileName: files[i].name,
          fileUrl: URL.createObjectURL(files[i]),
          amount,
          error: false,
        });
      } catch (err) {
        console.error("OCR failed:", err);
        out.push({
          uid,
          fileName: files[i].name,
          fileUrl: URL.createObjectURL(files[i]),
          amount: null,
          error: true,
        });
      }
      setResults([...out]);
    }
    setProcessing(false);
  };

  const updateAmount = (idx, val) => {
    setResults((prev) => prev.map((r, i) => (i === idx ? { ...r, amount: val } : r)));
  };

  const removeResult = (idx) => {
    setResults((prev) => prev.filter((_, i) => i !== idx));
  };

  const reset = () => {
    setFiles([]);
    setResults([]);
    setCategory(null);
    setSaveMsg("");
  };

  const totals = useMemo(() => {
    let sum = 0, ready = 0;
    results.forEach((r) => {
      if (r.amount && r.amount > 0) {
        sum += r.amount;
        ready++;
      }
    });
    return { sum, ready };
  }, [results]);

  const handleSave = async () => {
    if (totals.ready === 0 || !category || saving) return;
    setSaving(true);
    setSaveMsg("");

    const partner = localStorage.getItem("99xbet:partner") || "—";
    const now = new Date();

    // Snapshot what we're about to save so the UI can clear immediately after
    const toSave = results.filter((r) => r.amount && r.amount > 0);
    const savedSum = toSave.reduce((s, r) => s + r.amount, 0);
    const savedCount = toSave.length;
    const savedCategory = category;
    const savedDate = date;

    try {
      let i = 0;
      for (const r of toSave) {
        // Deterministic ID per result: ties to the result's own uid (set at OCR time).
        // If this same handleSave somehow fires twice with the same results, Firestore
        // setDoc will overwrite the same document instead of creating a duplicate.
        const id = `${date}_slip_${r.uid}`;
        const tx = {
          id,
          date,
          time: now.toTimeString().slice(0, 5),
          amount: r.amount,
          kind: category,
          name: "",
          notes: "",
          partner,
          source: "slip",
          timestamp: new Date().toISOString(),
        };
        await onSave(tx);
        i++;
      }

      // Clear the form IMMEDIATELY so partner can't double-tap
      setFiles([]);
      setResults([]);
      setCategory(null);
      setSaveMsg(`✓ Added ${savedCount} ${savedCategory} transaction${savedCount > 1 ? "s" : ""} (${fmt(savedSum)}) to ${savedDate}`);
      // Auto-clear the success message after a moment
      setTimeout(() => setSaveMsg(""), 4000);
    } catch (err) {
      setSaveMsg("Save failed: " + err.message);
    }
    setSaving(false);
  };

  const isIncome = category === "income";
  const isExpense = category === "expense";

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
          <Upload className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Upload Slips</h2>
          <p className="text-xs text-zinc-500">Auto-extract amounts from KBZPay, Wave, AYA receipts</p>
        </div>
      </div>

      {/* Date picker */}
      <div className="mb-5">
        <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Apply to date</label>
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
        {existingEntry && (
          <p className="text-xs text-amber-300 mt-2">
            This date already has an entry — slip totals will be added to existing values.
          </p>
        )}
      </div>

      {/* Two upload buttons (or active panel) */}
      {!category && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-emerald-400/30 bg-emerald-400/5 hover:bg-emerald-400/10 hover:border-emerald-400/60 cursor-pointer transition">
            <ArrowDownCircle className="w-8 h-8 text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-300">Incoming</span>
            <span className="text-xs text-zinc-500 text-center">Customer paid you<br />(adds to income)</span>
            <input type="file" accept="image/*" multiple onChange={handlePickFiles("income")} className="hidden" />
          </label>
          <label className="flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-rose-400/30 bg-rose-400/5 hover:bg-rose-400/10 hover:border-rose-400/60 cursor-pointer transition">
            <ArrowUpCircle className="w-8 h-8 text-rose-400" />
            <span className="text-sm font-semibold text-rose-300">Outgoing</span>
            <span className="text-xs text-zinc-500 text-center">You paid out<br />(adds to expenses)</span>
            <input type="file" accept="image/*" multiple onChange={handlePickFiles("expense")} className="hidden" />
          </label>
        </div>
      )}

      {/* Active category panel */}
      {category && (
        <>
          <div className={`flex items-center justify-between p-3 rounded-lg mb-4 ${isIncome ? "bg-emerald-400/10 border border-emerald-400/20" : "bg-rose-400/10 border border-rose-400/20"}`}>
            <div className="flex items-center gap-2">
              {isIncome ? <ArrowDownCircle className="w-5 h-5 text-emerald-400" /> : <ArrowUpCircle className="w-5 h-5 text-rose-400" />}
              <span className={`text-sm font-semibold ${isIncome ? "text-emerald-300" : "text-rose-300"}`}>
                {isIncome ? "Incoming slips" : "Outgoing slips"} · {files.length} selected
              </span>
            </div>
            <button onClick={reset} className="text-xs text-zinc-400 hover:text-white">Change</button>
          </div>

          {/* Process button */}
          {files.length > 0 && results.length === 0 && (
            <button
              onClick={processFiles}
              disabled={processing}
              className="w-full py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}
            >
              {processing ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reading slip {progress.current} of {progress.total}…
                </span>
              ) : (
                `Read ${files.length} slip${files.length > 1 ? "s" : ""}`
              )}
            </button>
          )}

          {/* Results */}
          {results.length > 0 && (
            <>
              <div className="mt-6 mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-300">Extracted Amounts</h3>
                <span className="text-xs text-zinc-500">{totals.ready} of {results.length} ready</span>
              </div>

              <div className="space-y-3">
                {results.map((r, idx) => (
                  <div key={idx} className="bg-black/40 border border-zinc-800 rounded-xl p-3">
                    <div className="flex gap-3 items-center">
                      <img src={r.fileUrl} alt="slip" className="w-14 h-14 object-cover rounded-lg border border-zinc-800 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        {r.error ? (
                          <p className="text-xs text-rose-400">Could not read this image — enter manually</p>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={r.amount || ""}
                            onChange={(e) => updateAmount(idx, parseFloat(e.target.value) || null)}
                            placeholder="Amount"
                            className={`flex-1 bg-zinc-900 border rounded px-3 py-2 text-white text-base outline-none ${
                              isIncome ? "border-emerald-400/30 focus:border-emerald-400/60" : "border-rose-400/30 focus:border-rose-400/60"
                            }`}
                          />
                          <span className="text-xs text-zinc-500">K</span>
                        </div>
                      </div>
                      <button
                        onClick={() => removeResult(idx)}
                        className="text-zinc-500 hover:text-rose-400 flex-shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary + save */}
              {!processing && totals.ready > 0 && (
                <div className={`mt-6 p-4 rounded-xl ${isIncome ? "bg-emerald-400/5 border border-emerald-400/20" : "bg-rose-400/5 border border-rose-400/20"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">
                      Total {isIncome ? "income" : "expenses"} to add
                    </span>
                    <span className={`text-2xl font-semibold tabular-nums ${isIncome ? "text-emerald-400" : "text-rose-400"}`}>
                      {fmt(totals.sum)}
                    </span>
                  </div>
                </div>
              )}

              {!processing && (
                <button
                  onClick={handleSave}
                  disabled={saving || totals.ready === 0}
                  className="w-full mt-4 py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: saving ? "#d4af37" : "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving {totals.ready} transaction{totals.ready > 1 ? "s" : ""}…
                    </span>
                  ) : existingEntry ? `Add to ${date} entry` : `Save to ${date} entry`}
                </button>
              )}

              {saveMsg && <p className="text-sm text-emerald-400 mt-3 text-center">{saveMsg}</p>}
            </>
          )}
        </>
      )}

      <p className="text-xs text-zinc-600 mt-6 leading-relaxed flex items-center gap-1.5">
        <Lock className="w-3 h-3" />
        Slips are processed entirely on your device — never uploaded anywhere
      </p>
    </div>
  );
}


// ---------- ENTRY FORM ----------
function EntryForm({ onSave, dayMap, partners = [] }) {
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState("income");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [partner, setPartner] = useState(localStorage.getItem("99xbet:partner") || "");
  const [partnerId, setPartnerId] = useState("");  // for capital/distribution
  const [expenseCategory, setExpenseCategory] = useState("variable"); // "fixed" or "variable"
  const [expenseShared, setExpenseShared] = useState(false); // shared by all current partners?
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isPartnerKind = kind === "capital" || kind === "distribution";
  const day = dayMap[date];
  const amt = parseFloat(amount) || 0;

  const handleSave = async () => {
    if (!amount || amt <= 0 || saving) return;
    if (isPartnerKind && !partnerId) {
      alert("Please select which partner this " + kind + " belongs to");
      return;
    }
    setSaving(true);
    if (partner.trim()) localStorage.setItem("99xbet:partner", partner.trim());

    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    const id = `${date}_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;

    // For capital/distribution, "name" field shows the selected partner's name
    const selectedPartner = isPartnerKind ? partners.find((p) => p.id === partnerId) : null;
    const tx = {
      id,
      date,
      time,
      amount: amt,
      kind,
      name: isPartnerKind ? (selectedPartner?.name || "") : name.trim(),
      notes: notes.trim(),
      partner: partner.trim() || "—",
      source: "manual",
      timestamp: now.toISOString(),
    };
    if (isPartnerKind) {
      tx.partnerId = partnerId;
    }
    // Tag expense transactions as fixed or variable for break-even reporting
    if (kind === "expense") {
      tx.category = expenseCategory;
      if (expenseShared) tx.shared = true;
    }

    try {
      await onSave(tx);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setAmount(""); setName(""); setNotes("");
      setExpenseShared(false); // reset — should be opt-in per transaction
      // Don't reset partnerId — likely logging multiple for same partner
    } catch (e) {
      console.error(e);
      alert("Save failed: " + e.message);
    }
    setSaving(false);
  };

  const kindConfig = {
    income: { label: "Income", color: "emerald", icon: <TrendingUp className="w-4 h-4" /> },
    expense: { label: "Expense", color: "rose", icon: <TrendingDown className="w-4 h-4" /> },
    marketing: { label: "Marketing", color: "sky", icon: <Megaphone className="w-4 h-4" /> },
    capital: { label: "Capital", color: "violet", icon: <PiggyBank className="w-4 h-4" /> },
    distribution: { label: "Distribution", color: "amber", icon: <HandCoins className="w-4 h-4" /> },
  };
  const kindActive = {
    emerald: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
    rose: "border-rose-400/50 bg-rose-400/10 text-rose-300",
    sky: "border-sky-400/50 bg-sky-400/10 text-sky-300",
    violet: "border-violet-400/50 bg-violet-400/10 text-violet-300",
    amber: "border-amber-400/50 bg-amber-400/10 text-amber-300",
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
          <Plus className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>New Transaction</h2>
          <p className="text-xs text-zinc-500">One transaction = one history entry</p>
        </div>
      </div>

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

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Type</label>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {Object.entries(kindConfig).map(([k, cfg]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex items-center justify-center gap-2 py-3 rounded-lg border-2 text-sm font-medium transition ${
                  kind === k ? kindActive[cfg.color] : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {cfg.icon}
                {cfg.label}
              </button>
            ))}
          </div>
          {isPartnerKind && partners.length === 0 && (
            <p className="text-xs text-amber-400 mt-2">
              No partners set up yet. Go to Settings → Partners to add them first.
            </p>
          )}
        </div>

        {kind === "expense" && (
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Category</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setExpenseCategory("variable")}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-medium transition ${
                  expenseCategory === "variable"
                    ? "border-rose-400/50 bg-rose-400/10 text-rose-300"
                    : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Variable
              </button>
              <button
                onClick={() => setExpenseCategory("fixed")}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-sm font-medium transition ${
                  expenseCategory === "fixed"
                    ? "border-rose-400/50 bg-rose-400/10 text-rose-300"
                    : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Fixed
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              Fixed = recurring monthly costs (server, salaries). Variable = one-off purchases.
            </p>

            <label className="mt-3 flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-zinc-800 hover:border-amber-400/40 transition">
              <input
                type="checkbox"
                checked={expenseShared}
                onChange={(e) => setExpenseShared(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-amber-400 cursor-pointer"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-white">Shared by all partners</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Use for startup costs (equipment, licenses) that benefit everyone. Cost splits equally among all current partners regardless of join date. Leave unchecked for normal operating expenses.
                </div>
              </div>
            </label>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Amount ({CURRENCY_CODE})</label>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white text-lg outline-none focus:border-amber-400/60"
          />
        </div>

        {isPartnerKind ? (
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">
              {kind === "capital" ? "Capital from which partner" : "Distribution to which partner"}
            </label>
            <select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60"
            >
              <option value="" className="bg-zinc-900">Select a partner…</option>
              {partners.filter((p) => p.active !== false).map((p) => (
                <option key={p.id} value={p.id} className="bg-zinc-900">{p.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">
              {kind === "income" ? "From (optional)" : "To (optional)"}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "income" ? "Customer name" : "Vendor / recipient"}
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60"
            />
          </div>
        )}

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

        {day && (day.income > 0 || day.expenses > 0 || day.marketing > 0) && (
          <div className="p-3 rounded-lg bg-black/40 border border-zinc-800 text-xs">
            <div className="text-zinc-500 uppercase tracking-wider mb-2">{date} so far</div>
            <div className="grid grid-cols-3 gap-2">
              <div><span className="text-zinc-500">In:</span> <span className="text-emerald-400 font-medium ml-1">{fmt(day.income)}</span></div>
              <div><span className="text-zinc-500">Exp:</span> <span className="text-rose-400 font-medium ml-1">{fmt(day.expenses)}</span></div>
              <div><span className="text-zinc-500">Mkt:</span> <span className="text-sky-400 font-medium ml-1">{fmt(day.marketing)}</span></div>
            </div>
            <div className="mt-2 pt-2 border-t border-zinc-800 flex justify-between">
              <span className="text-zinc-400">P/L:</span>
              <span className={`font-bold ${day.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(day.profit)}</span>
            </div>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !amount || amt <= 0}
          className="w-full py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : `Save ${kindConfig[kind].label.toLowerCase()} transaction`}
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
      <div className="text-xl md:text-2xl font-semibold text-white tabular-nums">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

// ---------- DASHBOARD ----------
// Custom tooltip for Daily P/L charts — shows Date, Profit, Income, Outgoing.
// Marketing is intentionally excluded (treated as a monthly cost in the dashboard).
function DailyPLTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  // Prefer fullDate (YYYY-MM-DD) for nice formatting; fall back to whatever's there
  const dateLabel = d.fullDate
    ? new Date(d.fullDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : d.date;
  const profitColor = d.profit >= 0 ? "#10b981" : "#f43f5e";
  return (
    <div style={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8, padding: "10px 12px", minWidth: 160 }}>
      <div style={{ color: "#fafafa", fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{dateLabel}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: "#a1a1aa" }}>Profit</span>
        <span style={{ color: profitColor, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(d.profit)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: "#a1a1aa" }}>Income</span>
        <span style={{ color: "#10b981", fontVariantNumeric: "tabular-nums" }}>{fmt(d.income || 0)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12 }}>
        <span style={{ color: "#a1a1aa" }}>Outgoing</span>
        <span style={{ color: "#f43f5e", fontVariantNumeric: "tabular-nums" }}>{fmt(d.expensesOnly != null ? d.expensesOnly : (d.expenses || 0))}</span>
      </div>
    </div>
  );
}

// Tooltip for Monthly P&L chart — shows Month, Profit, Income, Outgoing, Marketing
function MonthlyPLTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const profitColor = d.profit >= 0 ? "#10b981" : "#f43f5e";
  return (
    <div style={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8, padding: "10px 12px", minWidth: 180 }}>
      <div style={{ color: "#fafafa", fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{d.label}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: "#a1a1aa" }}>Profit</span>
        <span style={{ color: profitColor, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(d.profit)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: "#a1a1aa" }}>Income</span>
        <span style={{ color: "#10b981", fontVariantNumeric: "tabular-nums" }}>{fmt(d.income)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: "#a1a1aa" }}>Outgoing</span>
        <span style={{ color: "#f43f5e", fontVariantNumeric: "tabular-nums" }}>{fmt(d.expenses)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12 }}>
        <span style={{ color: "#a1a1aa" }}>Marketing</span>
        <span style={{ color: "#f59e0b", fontVariantNumeric: "tabular-nums" }}>{fmt(d.marketing)}</span>
      </div>
    </div>
  );
}

function Dashboard({ entries, transactions = [], recurring = [] }) {
  const stats = useMemo(() => {
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const totalIncome = entries.reduce((s, e) => s + e.income, 0);
    const totalExpenses = entries.reduce((s, e) => s + e.expenses, 0);
    const totalFixed = entries.reduce((s, e) => s + (e.fixedExpenses || 0), 0);
    const totalVariable = entries.reduce((s, e) => s + (e.variableExpenses || 0), 0);
    const totalMarketing = entries.reduce((s, e) => s + e.marketing, 0);
    const totalProfit = totalIncome - totalExpenses - totalMarketing;
    const last7 = sorted.slice(-7);
    const sum7 = last7.reduce((s, e) => s + e.profit, 0);
    const margin = totalIncome > 0 ? (totalProfit / totalIncome) * 100 : 0;

    // Recurring expense metrics
    // Predicted monthly burn = sum of all active recurring templates, normalized to monthly
    const activeRecurring = recurring.filter((r) => r.status !== "paused");
    const monthlyBurn = activeRecurring.reduce((sum, r) => {
      const factor = r.cycle === "weekly" ? 4.33 : r.cycle === "yearly" ? 1 / 12 : 1;
      return sum + (r.amount || 0) * factor;
    }, 0);
    // Actual recurring spend logged this month
    const ymThis = today().slice(0, 7);
    const recurringThisMonth = transactions
      .filter((t) => t.source === "recurring" && t.date && t.date.startsWith(ymThis))
      .reduce((s, t) => s + t.amount, 0);
    // All-time recurring total
    const recurringAllTime = transactions
      .filter((t) => t.source === "recurring")
      .reduce((s, t) => s + t.amount, 0);

    let running = 0;
    const chartData = sorted.map((e) => {
      running += e.profit;
      return {
        date: e.date.slice(5),
        fullDate: e.date,           // YYYY-MM-DD for tooltip formatting
        income: e.income,
        expensesOnly: e.expenses,   // expenses without marketing
        marketing: e.marketing,
        expenses: e.expenses + e.marketing, // legacy combined (kept for cumulative chart)
        profit: e.profit,
        cumulative: running,
      };
    });

    // Monthly aggregation — used by Monthly P&L + Monthly Marketing charts
    const monthMap = {};
    sorted.forEach((e) => {
      const ym = e.date.slice(0, 7); // YYYY-MM
      if (!monthMap[ym]) {
        monthMap[ym] = { ym, income: 0, expenses: 0, marketing: 0, profit: 0 };
      }
      monthMap[ym].income += e.income;
      monthMap[ym].expenses += e.expenses;
      monthMap[ym].marketing += e.marketing;
      monthMap[ym].profit += e.profit;
    });
    const monthlyData = Object.values(monthMap)
      .sort((a, b) => a.ym.localeCompare(b.ym))
      .map((m) => ({
        ...m,
        // Short label like "May" or "May 26" for the X axis
        label: new Date(m.ym + "-01T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      }));

    return {
      totalIncome, totalExpenses, totalFixed, totalVariable, totalMarketing, totalProfit,
      monthlyBurn, recurringThisMonth, recurringAllTime, activeRecurringCount: activeRecurring.length,
      sum7, margin, chartData,
      last30Data: chartData.slice(-30),
      monthlyData,
      bestDay: sorted.length ? sorted.reduce((a, b) => (b.profit > a.profit ? b : a)) : null,
      worstDay: sorted.length ? sorted.reduce((a, b) => (b.profit < a.profit ? b : a)) : null,
    };
  }, [entries, transactions, recurring]);

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
        <KpiCard label="Total Profit" value={fmt(stats.totalProfit)} sub={`${stats.margin.toFixed(1)}% margin`} accent={stats.totalProfit >= 0 ? "#10b981" : "#f43f5e"} icon={<DollarSign className="w-4 h-4" />} />
        <KpiCard label="Total Revenue" value={fmt(stats.totalIncome)} sub={`${entries.length} entries`} accent="#d4af37" icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Total Costs" value={fmt(stats.totalExpenses + stats.totalMarketing)} sub={`Fixed: ${fmt(stats.totalFixed)} · Var: ${fmt(stats.totalVariable)}`} accent="#f43f5e" icon={<TrendingDown className="w-4 h-4" />} />
        <KpiCard label="Last 7 Days" value={fmt(stats.sum7)} sub="Net P/L" accent="#0ea5e9" icon={<Calendar className="w-4 h-4" />} />
      </div>

      {stats.activeRecurringCount > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard label="Monthly Burn" value={fmt(stats.monthlyBurn)} sub={`${stats.activeRecurringCount} active recurring`} accent="#a78bfa" icon={<RefreshCw className="w-4 h-4" />} />
          <KpiCard label="Recurring This Month" value={fmt(stats.recurringThisMonth)} sub="Auto-logged so far this month" accent="#0ea5e9" icon={<RefreshCw className="w-4 h-4" />} />
          <KpiCard label="Recurring All-Time" value={fmt(stats.recurringAllTime)} sub="Total auto-logged" accent="#f43f5e" icon={<RefreshCw className="w-4 h-4" />} />
        </div>
      )}

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
              <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtAxis} />
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
              <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtAxis} />
              <Tooltip content={<DailyPLTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {stats.last30Data.map((d, i) => (
                  <Cell key={i} fill={d.profit >= 0 ? "#10b981" : "#f43f5e"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {stats.monthlyData.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
          <div className="mb-4">
            <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Monthly P&amp;L</h3>
            <p className="text-xs text-zinc-500">Income minus expenses minus marketing, per month</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.monthlyData}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtAxis} />
                <Tooltip content={<MonthlyPLTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                  {stats.monthlyData.map((d, i) => (
                    <Cell key={i} fill={d.profit >= 0 ? "#10b981" : "#f43f5e"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {stats.monthlyData.some((m) => m.marketing > 0) && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
          <div className="mb-4">
            <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Monthly Marketing</h3>
            <p className="text-xs text-zinc-500">Marketing spend per month</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.monthlyData}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#71717a" fontSize={11} />
                <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtAxis} />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8 }}
                  labelStyle={{ color: "#fafafa", fontWeight: 600 }}
                  formatter={(v) => [fmt(v), "Marketing"]}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar dataKey="marketing" radius={[4, 4, 0, 0]} fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {stats.bestDay && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-emerald-400/5 border border-emerald-400/20 rounded-2xl p-5">
            <div className="text-xs text-emerald-400 uppercase tracking-wider font-semibold mb-2">Best Day</div>
            <div className="text-xl md:text-2xl font-semibold text-white tabular-nums mb-1">{fmt(stats.bestDay.profit)}</div>
            <div className="text-xs text-zinc-400">{stats.bestDay.date} · by {stats.bestDay.partner}</div>
          </div>
          <div className="bg-rose-400/5 border border-rose-400/20 rounded-2xl p-5">
            <div className="text-xs text-rose-400 uppercase tracking-wider font-semibold mb-2">Worst Day</div>
            <div className="text-xl md:text-2xl font-semibold text-white tabular-nums mb-1">{fmt(stats.worstDay.profit)}</div>
            <div className="text-xs text-zinc-400">{stats.worstDay.date} · by {stats.worstDay.partner}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- HISTORY ----------
function History({ entries, onDeleteTransaction, onDeleteLegacy, readOnly = false }) {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const [expanded, setExpanded] = useState(null); // date string
  const [confirmTxId, setConfirmTxId] = useState(null);
  const [confirmDayId, setConfirmDayId] = useState(null);

  if (entries.length === 0) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center">
        <FileText className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
        <p className="text-zinc-500">No entries yet.</p>
      </div>
    );
  }

  const toggleExpand = (date) => {
    setExpanded(expanded === date ? null : date);
    setConfirmTxId(null);
    setConfirmDayId(null);
  };

  const kindStyle = (k) =>
    k === "income" ? "text-emerald-400" :
    k === "expense" ? "text-rose-400" :
    k === "capital" ? "text-violet-400" :
    k === "distribution" ? "text-amber-400" :
    "text-sky-400";

  const kindIcon = (k) =>
    k === "income" ? <ArrowDownCircle className="w-4 h-4" /> :
    k === "expense" ? <ArrowUpCircle className="w-4 h-4" /> :
    k === "capital" ? <PiggyBank className="w-4 h-4" /> :
    k === "distribution" ? <HandCoins className="w-4 h-4" /> :
    <Megaphone className="w-4 h-4" />;

  const kindLabel = (k) => k.charAt(0).toUpperCase() + k.slice(1);

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800">
        <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Ledger</h3>
        <p className="text-xs text-zinc-500">{entries.length} {entries.length === 1 ? "day" : "days"} · tap to expand</p>
      </div>

      <div className="divide-y divide-zinc-800">
        {sorted.map((day) => {
          const isOpen = expanded === day.date;
          const txCount = day.transactions.length;
          const isLegacy = day.hasLegacy && txCount === 0;

          return (
            <div key={day.date}>
              {/* Day summary row */}
              <button
                onClick={() => toggleExpand(day.date)}
                className="w-full text-left p-4 md:px-6 hover:bg-black/20 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`} />
                    <div className="min-w-0">
                      <div className="text-white font-semibold">{day.date}</div>
                      <div className="text-xs text-zinc-500">
                        {isLegacy ? "Imported summary" : `${txCount} transaction${txCount !== 1 ? "s" : ""}`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-lg md:text-xl font-semibold tabular-nums ${day.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {fmt(day.profit)}
                    </div>
                    <div className="text-xs text-zinc-500 tabular-nums">
                      <span className="text-emerald-400">{fmt(day.income)}</span>
                      <span className="mx-1">·</span>
                      <span className="text-rose-400">{fmt(day.expenses)}</span>
                      {day.marketing > 0 && (
                        <>
                          <span className="mx-1">·</span>
                          <span className="text-sky-400">{fmt(day.marketing)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="bg-black/30 px-4 md:px-6 py-3 border-t border-zinc-800">
                  {isLegacy ? (
                    <div>
                      <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                        <div>
                          <div className="text-zinc-500 uppercase tracking-wider">Income</div>
                          <div className="text-emerald-400 font-medium">{fmt(day.income)}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500 uppercase tracking-wider">Expenses</div>
                          <div className="text-rose-400 font-medium">{fmt(day.expenses)}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500 uppercase tracking-wider">Marketing</div>
                          <div className="text-sky-400 font-medium">{fmt(day.marketing)}</div>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-500 italic mb-3">
                        This is a historical summary entry — no individual transaction detail available.
                      </p>
                      {!readOnly && (confirmDayId === day.date ? (
                        <div className="flex gap-2">
                          <button onClick={() => { onDeleteLegacy(day.date); setConfirmDayId(null); }} className="text-rose-400 text-xs font-semibold">Confirm delete day</button>
                          <button onClick={() => setConfirmDayId(null)} className="text-zinc-500 text-xs">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDayId(day.date)} className="text-zinc-500 hover:text-rose-400 text-xs flex items-center gap-1">
                          <Trash2 className="w-3 h-3" /> Delete entire day
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {day.hasLegacy && (day.income > 0 || day.expenses > 0 || day.marketing > 0) && (
                        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs flex items-center justify-between">
                          <div>
                            <div className="text-zinc-400 mb-1">Imported summary (also for this day)</div>
                            <div className="text-zinc-500">
                              In: {fmt(day.income - day.transactions.filter(t => t.kind === "income").reduce((s, t) => s + t.amount, 0))} ·
                              Exp: {fmt(day.expenses - day.transactions.filter(t => t.kind === "expense").reduce((s, t) => s + t.amount, 0))} ·
                              Mkt: {fmt(day.marketing - day.transactions.filter(t => t.kind === "marketing").reduce((s, t) => s + t.amount, 0))}
                            </div>
                          </div>
                          {!readOnly && (confirmDayId === day.date ? (
                            <div className="flex gap-2">
                              <button onClick={() => { onDeleteLegacy(day.date); setConfirmDayId(null); }} className="text-rose-400 text-xs font-semibold">Delete</button>
                              <button onClick={() => setConfirmDayId(null)} className="text-zinc-500 text-xs">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDayId(day.date)} className="text-zinc-500 hover:text-rose-400">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ))}
                        </div>
                      )}

                      {day.transactions.map((tx) => (
                        <div key={tx.id} className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <div className={kindStyle(tx.kind) + " flex-shrink-0"}>{kindIcon(tx.kind)}</div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-sm font-bold ${kindStyle(tx.kind)}`}>{fmt(tx.amount)}</span>
                                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">{kindLabel(tx.kind)}</span>
                                  {tx.kind === "expense" && tx.category === "fixed" && (
                                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-400/10 text-violet-400 border border-violet-400/20">Fixed</span>
                                  )}
                                  {tx.kind === "expense" && tx.shared === true && (
                                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 flex items-center gap-1">
                                      <Users className="w-2.5 h-2.5" /> Shared
                                    </span>
                                  )}
                                  {tx.source === "slip" && <span className="text-[10px] uppercase tracking-wider text-amber-400/80">Slip</span>}
                                  {tx.source === "recurring" && (
                                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-400/10 text-sky-400 border border-sky-400/20 flex items-center gap-1">
                                      <RefreshCw className="w-2.5 h-2.5" /> Auto
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-zinc-500 mt-0.5 truncate">
                                  {tx.time && <span>{tx.time}</span>}
                                  {tx.name && <span> · {tx.name}</span>}
                                  {tx.partner && tx.partner !== "—" && <span> · {tx.partner}</span>}
                                </div>
                                {tx.notes && <div className="text-xs text-zinc-400 italic mt-1">{tx.notes}</div>}
                              </div>
                            </div>
                            {!readOnly && (confirmTxId === tx.id ? (
                              <div className="flex gap-2 flex-shrink-0">
                                <button onClick={() => { onDeleteTransaction(tx.id); setConfirmTxId(null); }} className="text-rose-400 text-xs font-semibold">Confirm</button>
                                <button onClick={() => setConfirmTxId(null)} className="text-zinc-500 text-xs">Cancel</button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmTxId(tx.id)} className="text-zinc-500 hover:text-rose-400 flex-shrink-0">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}



// ---------- MONTHLY ----------
function Monthly({ entries, transactions = [] }) {
  const months = useMemo(() => {
    const map = {};
    entries.forEach((e) => {
      const ym = e.date.slice(0, 7);
      if (!map[ym]) map[ym] = { ym, entries: [], income: 0, expenses: 0, marketing: 0, profit: 0, fixedExpenses: 0, variableExpenses: 0, recurringExpenses: 0 };
      map[ym].entries.push(e);
      map[ym].income += e.income;
      map[ym].expenses += e.expenses;
      map[ym].marketing += e.marketing;
      map[ym].profit += e.profit;
      map[ym].fixedExpenses += e.fixedExpenses || 0;
      map[ym].variableExpenses += e.variableExpenses || 0;
    });
    // Layer recurring totals from transactions
    transactions.forEach((t) => {
      if (t.source !== "recurring" || !t.date) return;
      const ym = t.date.slice(0, 7);
      if (map[ym]) map[ym].recurringExpenses += t.amount;
    });
    return Object.values(map).sort((a, b) => b.ym.localeCompare(a.ym));
  }, [entries, transactions]);

  const [selectedYm, setSelectedYm] = useState(null);

  useEffect(() => {
    if (months.length > 0 && !selectedYm) setSelectedYm(months[0].ym);
  }, [months, selectedYm]);

  if (entries.length === 0) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center">
        <CalendarDays className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>No data yet</h3>
        <p className="text-zinc-500 text-sm">Add transactions to see monthly summaries.</p>
      </div>
    );
  }

  const selectedMonth = months.find((m) => m.ym === selectedYm) || months[0];
  const selectedIdx = months.findIndex((m) => m.ym === selectedMonth.ym);
  const prevMonth = selectedIdx < months.length - 1 ? months[selectedIdx + 1] : null;
  const goPrev = () => prevMonth && setSelectedYm(prevMonth.ym);
  const goNext = () => selectedIdx > 0 && setSelectedYm(months[selectedIdx - 1].ym);

  const monthLabel = (ym) => {
    const [y, m] = ym.split("-");
    const d = new Date(parseInt(y), parseInt(m) - 1, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  const margin = selectedMonth.income > 0 ? (selectedMonth.profit / selectedMonth.income) * 100 : 0;

  const dailyData = [...selectedMonth.entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      date: e.date.slice(8),
      fullDate: e.date,
      profit: e.profit,
      income: e.income,
      expensesOnly: e.expenses,
      marketing: e.marketing,
    }));

  const compare = prevMonth ? {
    profitDelta: selectedMonth.profit - prevMonth.profit,
    profitPct: prevMonth.profit !== 0 ? ((selectedMonth.profit - prevMonth.profit) / Math.abs(prevMonth.profit)) * 100 : null,
    incomeDelta: selectedMonth.income - prevMonth.income,
    incomePct: prevMonth.income !== 0 ? ((selectedMonth.income - prevMonth.income) / prevMonth.income) * 100 : null,
  } : null;

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <button onClick={goPrev} disabled={!prevMonth} className="w-10 h-10 rounded-lg bg-black/40 border border-zinc-800 flex items-center justify-center text-zinc-400 disabled:opacity-30 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center">
            <div className="text-xs text-zinc-500 uppercase tracking-[0.25em] mb-1">Viewing</div>
            <select value={selectedMonth.ym} onChange={(e) => setSelectedYm(e.target.value)} className="bg-transparent text-white text-xl md:text-2xl font-bold text-center outline-none cursor-pointer" style={{ fontFamily: "'Playfair Display', serif" }}>
              {months.map((m) => <option key={m.ym} value={m.ym} className="bg-zinc-900">{monthLabel(m.ym)}</option>)}
            </select>
          </div>
          <button onClick={goNext} disabled={selectedIdx === 0} className="w-10 h-10 rounded-lg bg-black/40 border border-zinc-800 flex items-center justify-center text-zinc-400 disabled:opacity-30 hover:text-white">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Net P/L" value={fmt(selectedMonth.profit)} sub={`${margin.toFixed(1)}% margin`} accent={selectedMonth.profit >= 0 ? "#10b981" : "#f43f5e"} icon={<DollarSign className="w-4 h-4" />} />
        <KpiCard label="Revenue" value={fmt(selectedMonth.income)} sub={`${selectedMonth.entries.length} days`} accent="#d4af37" icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Expenses" value={fmt(selectedMonth.expenses)} sub={selectedMonth.recurringExpenses > 0 ? `Recurring: ${fmt(selectedMonth.recurringExpenses)}` : `Fixed: ${fmt(selectedMonth.fixedExpenses)}`} accent="#f43f5e" icon={<TrendingDown className="w-4 h-4" />} />
        <KpiCard label="Marketing" value={fmt(selectedMonth.marketing)} sub="Spend" accent="#0ea5e9" icon={<Megaphone className="w-4 h-4" />} />
      </div>

      {compare && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-3">vs. {monthLabel(prevMonth.ym)}</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-zinc-500 mb-1">Profit change</div>
              <div className={`text-lg font-semibold tabular-nums ${compare.profitDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {compare.profitDelta >= 0 ? "+" : ""}{fmt(compare.profitDelta)}
                {compare.profitPct !== null && <span className="text-xs ml-2 text-zinc-500">({compare.profitPct >= 0 ? "+" : ""}{compare.profitPct.toFixed(1)}%)</span>}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1">Revenue change</div>
              <div className={`text-lg font-semibold tabular-nums ${compare.incomeDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {compare.incomeDelta >= 0 ? "+" : ""}{fmt(compare.incomeDelta)}
                {compare.incomePct !== null && <span className="text-xs ml-2 text-zinc-500">({compare.incomePct >= 0 ? "+" : ""}{compare.incomePct.toFixed(1)}%)</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
        <div className="mb-4">
          <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Daily P/L — {monthLabel(selectedMonth.ym)}</h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtAxis} />
              <Tooltip content={<DailyPLTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {dailyData.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? "#10b981" : "#f43f5e"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>All Months</h3>
        </div>
        <div className="divide-y divide-zinc-800">
          {months.map((m) => {
            const mg = m.income > 0 ? (m.profit / m.income) * 100 : 0;
            const isSel = m.ym === selectedMonth.ym;
            return (
              <button key={m.ym} onClick={() => setSelectedYm(m.ym)} className={`w-full text-left p-4 ${isSel ? "bg-amber-400/5" : ""}`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-white font-semibold">{monthLabel(m.ym)}</div>
                    <div className="text-xs text-zinc-500">{m.entries.length} days · {mg.toFixed(1)}% margin</div>
                  </div>
                  <div className={`text-lg font-semibold tabular-nums ${m.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {fmt(m.profit)}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs mt-3">
                  <div><span className="text-zinc-500">Rev</span><div className="text-emerald-400 font-medium tabular-nums">{fmt(m.income)}</div></div>
                  <div><span className="text-zinc-500">Exp</span><div className="text-rose-400 font-medium tabular-nums">{fmt(m.expenses)}</div></div>
                  <div><span className="text-zinc-500">Mkt</span><div className="text-sky-400 font-medium tabular-nums">{fmt(m.marketing)}</div></div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- PARTNERS ----------
// Calculate per-partner time-weighted profit share.
// Rule: for each profit-generating day, divide that day's profit equally
// among partners whose joinedDate <= that day. Partners who joined later
// get 0 share for days before their join date.
function calcPartnerStats(entries, transactions, partners) {
  // Sort partners by joinedDate ascending
  const allPartners = [...partners].sort((a, b) => (a.joinedDate || "").localeCompare(b.joinedDate || ""));
  const activePartners = allPartners.filter((p) => p.active !== false);

  // Initialize stats per partner
  const stats = {};
  activePartners.forEach((p) => {
    stats[p.id] = {
      partner: p,
      capitalIn: 0,
      distributionsOut: 0,
      profitShare: 0,        // operational profit, time-weighted by join date
      sharedExpenseShare: 0, // share of expenses flagged as "shared by all partners"
    };
  });

  // Capital and Distribution from transactions
  transactions.forEach((t) => {
    if (!t.partnerId || !stats[t.partnerId]) return;
    if (t.kind === "capital") stats[t.partnerId].capitalIn += t.amount;
    else if (t.kind === "distribution") stats[t.partnerId].distributionsOut += t.amount;
  });

  // Time-weighted profit share — per day, OPERATIONAL profit only.
  // Shared expenses (e.g. startup costs flagged as shared) are excluded
  // from this and split equally among ALL currently-active partners below.
  entries.forEach((day) => {
    const eligiblePartners = activePartners.filter(
      (p) => !p.joinedDate || p.joinedDate <= day.date
    );
    if (eligiblePartners.length === 0) return;
    // Operational profit excludes shared expenses
    const sharedToday = day.sharedExpenses || 0;
    const operationalProfit = day.profit + sharedToday; // add back shared exp that was already subtracted
    if (operationalProfit === 0) return;
    const sharePerPartner = operationalProfit / eligiblePartners.length;
    eligiblePartners.forEach((p) => {
      stats[p.id].profitShare += sharePerPartner;
    });
  });

  // Shared expenses split equally among ALL currently-active partners
  // regardless of join date. This is for one-off startup costs that
  // benefit the business as an asset rather than burn away as opex.
  const totalSharedExpenses = entries.reduce((sum, d) => sum + (d.sharedExpenses || 0), 0);
  if (activePartners.length > 0 && totalSharedExpenses > 0) {
    const sharePerPartner = totalSharedExpenses / activePartners.length;
    activePartners.forEach((p) => {
      stats[p.id].sharedExpenseShare = sharePerPartner;
    });
  }

  // Compute net position for each partner
  Object.values(stats).forEach((s) => {
    s.netPosition = s.capitalIn + s.profitShare - s.sharedExpenseShare - s.distributionsOut;
  });

  // Total business cash on hand
  const totalCapital = Object.values(stats).reduce((sum, s) => sum + s.capitalIn, 0);
  const totalDistributions = Object.values(stats).reduce((sum, s) => sum + s.distributionsOut, 0);
  const totalProfit = entries.reduce((sum, d) => sum + d.profit, 0);
  const cashOnHand = totalCapital + totalProfit - totalDistributions;

  return {
    perPartner: Object.values(stats),
    totalCapital,
    totalDistributions,
    totalProfit,
    totalSharedExpenses,
    cashOnHand,
  };
}

function Partners({ entries, transactions, partners, readOnly = false }) {
  if (partners.length === 0) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 text-center">
        <Users className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>No partners set up yet</h3>
        <p className="text-zinc-500 text-sm mb-4">
          {readOnly
            ? "Ask the editor to set up partners in Settings."
            : "Go to Settings → Partners to add partners and start tracking capital and distributions."}
        </p>
      </div>
    );
  }

  const { perPartner, totalCapital, totalDistributions, totalProfit, totalSharedExpenses, cashOnHand } = calcPartnerStats(entries, transactions, partners);
  const hasShared = totalSharedExpenses > 0;

  return (
    <div className="space-y-6">
      {/* Top KPI strip — business-level totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Cash on Hand" value={fmt(cashOnHand)} sub="Capital + profit − distributions" accent="#d4af37" icon={<DollarSign className="w-4 h-4" />} />
        <KpiCard label="Total Capital" value={fmt(totalCapital)} sub="Injected by partners" accent="#a78bfa" icon={<PiggyBank className="w-4 h-4" />} />
        <KpiCard label="Total Distributions" value={fmt(totalDistributions)} sub="Taken by partners" accent="#f59e0b" icon={<HandCoins className="w-4 h-4" />} />
        <KpiCard label="Total Profit" value={fmt(totalProfit)} sub="Business earnings" accent={totalProfit >= 0 ? "#10b981" : "#f43f5e"} icon={<TrendingUp className="w-4 h-4" />} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Partner Accounts</h3>
        </div>
        <div className="space-y-3">
          {perPartner.map((s) => (
            <div key={s.partner.id} className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-white font-semibold text-lg">{s.partner.name}</div>
                  <div className="text-xs text-zinc-500">
                    {s.partner.joinedDate ? `Joined ${s.partner.joinedDate}` : "Joined date not set"}
                  </div>
                </div>
                <div className={`text-xl font-semibold tabular-nums ${s.netPosition >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {fmt(s.netPosition)}
                </div>
              </div>
              <div className={`grid ${hasShared ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3"} gap-2 text-xs pt-3 border-t border-zinc-800`}>
                <div>
                  <div className="text-zinc-500 mb-1">Capital In</div>
                  <div className="text-violet-400 font-medium tabular-nums">{fmt(s.capitalIn)}</div>
                </div>
                <div>
                  <div className="text-zinc-500 mb-1">Profit Share</div>
                  <div className={`font-medium tabular-nums ${s.profitShare >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(s.profitShare)}</div>
                </div>
                {hasShared && (
                  <div>
                    <div className="text-zinc-500 mb-1">Shared Costs</div>
                    <div className="text-rose-400 font-medium tabular-nums">−{fmt(s.sharedExpenseShare)}</div>
                  </div>
                )}
                <div>
                  <div className="text-zinc-500 mb-1">Distributions</div>
                  <div className="text-amber-400 font-medium tabular-nums">{fmt(s.distributionsOut)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-600 mt-4 leading-relaxed">
          Profit Share is calculated by splitting each day's <em>operational</em> profit equally among partners
          who had joined by that day. {hasShared && "Shared Costs are startup expenses split equally among all current partners regardless of join date. "}
          Net Position = Capital In + Profit Share {hasShared && "− Shared Costs "}− Distributions.
        </p>
      </div>
    </div>
  );
}


// ---------- RECURRING EXPENSES ----------
function RecurringExpenses({ recurring, onSave, onDelete }) {
  const [editing, setEditing] = useState(null); // recurring being edited, or "new"
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cycle, setCycle] = useState("monthly");
  const [category, setCategory] = useState("fixed");
  const [nextDue, setNextDue] = useState(today());
  const [notes, setNotes] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");

  const startNew = () => {
    setEditing("new");
    setName("");
    setAmount("");
    setCycle("monthly");
    setCategory("fixed");
    setNextDue(today());
    setNotes("");
    setErr("");
  };
  const startEdit = (r) => {
    setEditing(r.id);
    setName(r.name);
    setAmount(String(r.amount));
    setCycle(r.cycle || "monthly");
    setCategory(r.category || "fixed");
    setNextDue(r.nextDue || today());
    setNotes(r.notes || "");
    setErr("");
  };
  const cancel = () => {
    setEditing(null);
    setErr("");
  };

  const save = async () => {
    setErr("");
    const trimmed = name.trim();
    const amt = parseFloat(amount);
    if (!trimmed) { setErr("Name is required"); return; }
    if (!amt || amt <= 0) { setErr("Amount must be greater than zero"); return; }
    if (!nextDue) { setErr("Next due date is required"); return; }
    setWorking(true);
    try {
      if (editing === "new") {
        const id = "rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
        await onSave({
          id,
          name: trimmed,
          amount: amt,
          cycle,
          category,
          nextDue,
          notes: notes.trim(),
          status: "active",
          createdAt: new Date().toISOString(),
        });
      } else {
        const existing = recurring.find((r) => r.id === editing);
        await onSave({
          ...existing,
          name: trimmed,
          amount: amt,
          cycle,
          category,
          nextDue,
          notes: notes.trim(),
        });
      }
      cancel();
    } catch (e) {
      setErr("Save failed: " + e.message);
    }
    setWorking(false);
  };

  const togglePause = async (r) => {
    setWorking(true);
    try {
      await onSave({ ...r, status: r.status === "paused" ? "active" : "paused" });
    } catch (e) {
      console.error(e);
    }
    setWorking(false);
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete "${r.name}"? This will not remove transactions already auto-logged from this template.`)) return;
    setWorking(true);
    try {
      await onDelete(r.id);
    } catch (e) {
      console.error(e);
    }
    setWorking(false);
  };

  const active = recurring.filter((r) => r.status !== "paused").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const paused = recurring.filter((r) => r.status === "paused");

  // Total monthly burn — normalize all cycles to monthly
  const monthlyBurn = active.reduce((sum, r) => {
    const factor = r.cycle === "weekly" ? 4.33 : r.cycle === "yearly" ? 1 / 12 : 1;
    return sum + (r.amount || 0) * factor;
  }, 0);
  const fixedBurn = active.filter((r) => r.category === "fixed").reduce((sum, r) => {
    const factor = r.cycle === "weekly" ? 4.33 : r.cycle === "yearly" ? 1 / 12 : 1;
    return sum + (r.amount || 0) * factor;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <KpiCard label="Monthly Burn" value={fmt(monthlyBurn)} sub={`${active.length} active recurring expense${active.length === 1 ? "" : "s"}`} accent="#f43f5e" icon={<RefreshCw className="w-4 h-4" />} />
        <KpiCard label="Fixed Monthly Costs" value={fmt(fixedBurn)} sub="Predictable, committed spending" accent="#a78bfa" icon={<TrendingDown className="w-4 h-4" />} />
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Recurring Expenses</h3>
          <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20">
            {active.length} active
          </span>
        </div>
        <p className="text-xs text-zinc-500 mb-6">
          Recurring expenses get auto-logged as transactions when their due date arrives. Pause anytime to stop auto-logging without deleting history.
        </p>

        {active.length === 0 && editing === null && (
          <div className="text-center py-6">
            <RefreshCw className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
            <p className="text-sm text-zinc-500 mb-4">No recurring expenses yet. Add your first one below.</p>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {active.map((r) => (
            <div key={r.id} className="bg-black/30 border border-zinc-800 rounded-lg px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium truncate">{r.name}</span>
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${r.category === "fixed" ? "bg-violet-400/10 text-violet-400 border border-violet-400/20" : "bg-zinc-700/40 text-zinc-400 border border-zinc-700"}`}>
                      {r.category || "fixed"}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {fmt(r.amount)} · {r.cycle || "monthly"} · next: {r.nextDue}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0 ml-2">
                  <button onClick={() => startEdit(r)} className="text-xs text-zinc-400 hover:text-white px-2 py-1">Edit</button>
                  <button onClick={() => togglePause(r)} className="text-xs text-amber-400 hover:text-amber-300 px-2 py-1">Pause</button>
                  <button onClick={() => remove(r)} className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {editing && (
          <div className="bg-black/30 border border-amber-400/30 rounded-lg p-4 mb-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wide">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Server hosting"
                className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-400/60"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wide">Amount ({CURRENCY_CODE})</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-400/60"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wide">Cycle</label>
                <select
                  value={cycle}
                  onChange={(e) => setCycle(e.target.value)}
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-400/60"
                >
                  <option value="weekly" className="bg-zinc-900">Weekly</option>
                  <option value="monthly" className="bg-zinc-900">Monthly</option>
                  <option value="yearly" className="bg-zinc-900">Yearly</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wide">Category</label>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setCategory("variable")}
                    className={`py-2 rounded-lg border-2 text-xs font-medium ${
                      category === "variable" ? "border-rose-400/50 bg-rose-400/10 text-rose-300" : "border-zinc-800 text-zinc-500"
                    }`}
                  >
                    Variable
                  </button>
                  <button
                    onClick={() => setCategory("fixed")}
                    className={`py-2 rounded-lg border-2 text-xs font-medium ${
                      category === "fixed" ? "border-rose-400/50 bg-rose-400/10 text-rose-300" : "border-zinc-800 text-zinc-500"
                    }`}
                  >
                    Fixed
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wide">Next Due</label>
                <input
                  type="date" lang="en-US"
                  value={nextDue}
                  onChange={(e) => setNextDue(e.target.value)}
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-400/60"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wide">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Vendor, account, etc."
                className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-400/60"
              />
            </div>
            {err && <p className="text-rose-400 text-sm">{err}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={working} className="px-4 py-2 rounded-lg font-medium text-black text-sm disabled:opacity-50" style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}>
                {working ? "Saving…" : "Save"}
              </button>
              <button onClick={cancel} className="px-4 py-2 rounded-lg text-zinc-400 text-sm hover:text-white">Cancel</button>
            </div>
          </div>
        )}

        {!editing && (
          <button onClick={startNew} className="w-full py-3 rounded-lg border-2 border-dashed border-zinc-700 hover:border-amber-400/60 text-zinc-400 hover:text-amber-300 text-sm font-medium transition flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Add Recurring Expense
          </button>
        )}

        {paused.length > 0 && (
          <div className="mt-6 pt-6 border-t border-zinc-800">
            <h4 className="text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-3">Paused ({paused.length})</h4>
            <div className="space-y-2">
              {paused.map((r) => (
                <div key={r.id} className="flex items-center justify-between bg-black/20 border border-zinc-800 rounded-lg px-4 py-2">
                  <div>
                    <div className="text-zinc-400 text-sm">{r.name}</div>
                    <div className="text-xs text-zinc-600">{fmt(r.amount)} · {r.cycle}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => togglePause(r)} className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1">Resume</button>
                    <button onClick={() => remove(r)} className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- PARTNER MANAGER (Settings sub-component) ----------
function PartnerManager({ partners, onSavePartner, onDeletePartner }) {
  const [editing, setEditing] = useState(null); // partner being edited, or "new" for new
  const [name, setName] = useState("");
  const [joinedDate, setJoinedDate] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");

  const startNew = () => {
    setEditing("new");
    setName("");
    setJoinedDate(today());
    setErr("");
  };
  const startEdit = (p) => {
    setEditing(p.id);
    setName(p.name);
    setJoinedDate(p.joinedDate || "");
    setErr("");
  };
  const cancel = () => {
    setEditing(null);
    setName("");
    setJoinedDate("");
    setErr("");
  };

  const save = async () => {
    setErr("");
    const trimmed = name.trim();
    if (!trimmed) { setErr("Name is required"); return; }
    if (partners.some((p) => p.name.toLowerCase() === trimmed.toLowerCase() && p.id !== editing)) {
      setErr("A partner with that name already exists");
      return;
    }
    setWorking(true);
    try {
      if (editing === "new") {
        const id = "partner_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
        await onSavePartner({
          id,
          name: trimmed,
          joinedDate: joinedDate || today(),
          active: true,
          order: partners.length,
        });
      } else {
        const existing = partners.find((p) => p.id === editing);
        await onSavePartner({
          ...existing,
          name: trimmed,
          joinedDate: joinedDate || existing.joinedDate || today(),
        });
      }
      cancel();
    } catch (e) {
      setErr("Save failed: " + e.message);
    }
    setWorking(false);
  };

  const remove = async (p) => {
    if (!window.confirm(`Remove ${p.name}? Their historical capital and distribution records will stay, but they won't appear in active lists.`)) return;
    setWorking(true);
    try {
      // Soft remove — keep the record, mark inactive. Preserves history.
      await onSavePartner({ ...p, active: false });
    } catch (e) {
      setErr("Remove failed: " + e.message);
    }
    setWorking(false);
  };

  const restore = async (p) => {
    setWorking(true);
    try {
      await onSavePartner({ ...p, active: true });
    } catch (e) {
      setErr("Restore failed: " + e.message);
    }
    setWorking(false);
  };

  const activePartners = partners.filter((p) => p.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  const inactivePartners = partners.filter((p) => p.active === false);

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8 max-w-xl">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Partners</h3>
        <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20">
          {activePartners.length} active
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-6">
        Capital and distribution transactions are attributed to specific partners. Profit share is split equally among partners who had joined by each profit-generating day.
      </p>

      {activePartners.length === 0 && editing === null && (
        <div className="text-center py-6">
          <Users className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-500 mb-4">No partners yet. Add your first partner to start tracking.</p>
        </div>
      )}

      <div className="space-y-2 mb-4">
        {activePartners.map((p) => (
          <div key={p.id} className="flex items-center justify-between bg-black/30 border border-zinc-800 rounded-lg px-4 py-3">
            <div>
              <div className="text-white font-medium">{p.name}</div>
              <div className="text-xs text-zinc-500">{p.joinedDate ? `Joined ${p.joinedDate}` : "—"}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startEdit(p)} className="text-xs text-zinc-400 hover:text-white px-2 py-1">Edit</button>
              <button onClick={() => remove(p)} className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1">Remove</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="bg-black/30 border border-amber-400/30 rounded-lg p-4 mb-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wide">Partner Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Paul"
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-400/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wide">Joined Date</label>
            <input
              type="date" lang="en-US"
              value={joinedDate}
              onChange={(e) => setJoinedDate(e.target.value)}
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-400/60"
            />
            <p className="text-xs text-zinc-500 mt-1">Approximate is fine — used to calculate profit share starting from this date.</p>
          </div>
          {err && <p className="text-rose-400 text-sm">{err}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={working} className="px-4 py-2 rounded-lg font-medium text-black text-sm disabled:opacity-50" style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}>
              {working ? "Saving…" : "Save"}
            </button>
            <button onClick={cancel} className="px-4 py-2 rounded-lg text-zinc-400 text-sm hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {!editing && (
        <button onClick={startNew} className="w-full py-3 rounded-lg border-2 border-dashed border-zinc-700 hover:border-amber-400/60 text-zinc-400 hover:text-amber-300 text-sm font-medium transition flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> Add Partner
        </button>
      )}

      {inactivePartners.length > 0 && (
        <div className="mt-6 pt-6 border-t border-zinc-800">
          <h4 className="text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-3">Inactive ({inactivePartners.length})</h4>
          <div className="space-y-2">
            {inactivePartners.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-black/20 border border-zinc-800 rounded-lg px-4 py-2">
                <div className="text-zinc-500 text-sm">{p.name}</div>
                <button onClick={() => restore(p)} className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1">Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Settings({ entries, partners, onSavePartner, onDeletePartner }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [working, setWorking] = useState(false);

  // Viewer passcode state
  const [viewerCurrent, setViewerCurrent] = useState("");
  const [viewerNew, setViewerNew] = useState("");
  const [viewerConfirm, setViewerConfirm] = useState("");
  const [viewerMsg, setViewerMsg] = useState("");
  const [viewerErr, setViewerErr] = useState("");
  const [viewerWorking, setViewerWorking] = useState(false);
  const [viewerExists, setViewerExists] = useState(false);

  // Check whether a viewer passcode is already set (so we know whether to require current)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(CONFIG_DOC);
        setViewerExists(snap.exists() && !!snap.data().viewerPasscode);
      } catch { /* ignore */ }
    })();
  }, [viewerMsg]);

  const handleChange = async () => {
    setMsg(""); setErr(""); setWorking(true);
    try {
      const snap = await getDoc(CONFIG_DOC);
      const data = snap.exists() ? snap.data() : {};
      const correct = data.passcode || DEFAULT_PASSCODE;
      if (current !== correct) { setErr("Current passcode is wrong"); setWorking(false); return; }
      if (next.length < 4) { setErr("New passcode must be at least 4 characters"); setWorking(false); return; }
      if (next !== confirm) { setErr("New passcodes don't match"); setWorking(false); return; }
      if (data.viewerPasscode && next === data.viewerPasscode) {
        setErr("Editor passcode can't be the same as viewer passcode");
        setWorking(false);
        return;
      }
      // Preserve other fields (like viewerPasscode) by spreading
      await setDoc(CONFIG_DOC, { ...data, passcode: next });
      setMsg("Editor passcode updated");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      setErr("Update failed: " + e.message);
    }
    setWorking(false);
  };

  const handleViewerChange = async () => {
    setViewerMsg(""); setViewerErr(""); setViewerWorking(true);
    try {
      const snap = await getDoc(CONFIG_DOC);
      const data = snap.exists() ? snap.data() : {};
      // Editor passcode is required to set/change the viewer passcode
      const editorCorrect = data.passcode || DEFAULT_PASSCODE;
      if (viewerCurrent !== editorCorrect) {
        setViewerErr("Enter your editor passcode to change viewer passcode");
        setViewerWorking(false);
        return;
      }
      if (viewerNew.length < 4) {
        setViewerErr("Viewer passcode must be at least 4 characters");
        setViewerWorking(false);
        return;
      }
      if (viewerNew !== viewerConfirm) {
        setViewerErr("New viewer passcodes don't match");
        setViewerWorking(false);
        return;
      }
      if (viewerNew === editorCorrect) {
        setViewerErr("Viewer passcode can't be the same as editor passcode");
        setViewerWorking(false);
        return;
      }
      await setDoc(CONFIG_DOC, { ...data, viewerPasscode: viewerNew });
      setViewerMsg("Viewer passcode set. Share it with read-only partners.");
      setViewerCurrent(""); setViewerNew(""); setViewerConfirm("");
    } catch (e) {
      setViewerErr("Update failed: " + e.message);
    }
    setViewerWorking(false);
  };

  const handleViewerRemove = async () => {
    if (!window.confirm("Remove the viewer passcode? Existing viewers will be locked out next time they log in.")) return;
    setViewerMsg(""); setViewerErr(""); setViewerWorking(true);
    try {
      const snap = await getDoc(CONFIG_DOC);
      const data = snap.exists() ? snap.data() : {};
      const editorCorrect = data.passcode || DEFAULT_PASSCODE;
      if (viewerCurrent !== editorCorrect) {
        setViewerErr("Enter your editor passcode to remove viewer passcode");
        setViewerWorking(false);
        return;
      }
      const { viewerPasscode, ...rest } = data;
      // Re-write doc without viewerPasscode field
      await setDoc(CONFIG_DOC, rest);
      setViewerMsg("Viewer passcode removed");
      setViewerCurrent(""); setViewerNew(""); setViewerConfirm("");
    } catch (e) {
      setViewerErr("Remove failed: " + e.message);
    }
    setViewerWorking(false);
  };

  const exportCSV = () => {
    const headers = ["Date", "Income (MMK)", "Expenses (MMK)", "Marketing (MMK)", "Profit (MMK)"];
    const rows = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map(e => [
      e.date, e.income, e.expenses, e.marketing, e.profit
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${today()}.csv`;
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
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Viewer Passcode</h3>
          {viewerExists && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20">Active</span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mb-6">
          {viewerExists
            ? "A viewer passcode is set. Partners using it can see Dashboard, Monthly, and History but cannot add, edit, or delete anything."
            : "Set a separate passcode for partners who should only view data, not edit it. They'll see Dashboard, Monthly, and History only."}
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Your Editor Passcode</label>
            <input type="password" value={viewerCurrent} onChange={(e) => setViewerCurrent(e.target.value)} placeholder="Required to make changes" className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">{viewerExists ? "New Viewer Passcode" : "Viewer Passcode"}</label>
            <input type="password" value={viewerNew} onChange={(e) => setViewerNew(e.target.value)} className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Confirm Viewer Passcode</label>
            <input type="password" value={viewerConfirm} onChange={(e) => setViewerConfirm(e.target.value)} className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-amber-400/60" />
          </div>
          {viewerErr && <p className="text-rose-400 text-sm">{viewerErr}</p>}
          {viewerMsg && <p className="text-emerald-400 text-sm">{viewerMsg}</p>}
          <button onClick={handleViewerChange} disabled={viewerWorking} className="w-full py-3 rounded-lg font-semibold text-black hover:opacity-90 active:scale-[0.98] transition disabled:opacity-50" style={{ background: "linear-gradient(135deg, #d4af37 0%, #f4d65f 100%)" }}>
            {viewerWorking ? "Updating…" : viewerExists ? "Update Viewer Passcode" : "Set Viewer Passcode"}
          </button>
          {viewerExists && (
            <button onClick={handleViewerRemove} disabled={viewerWorking} className="w-full py-3 rounded-lg font-medium text-rose-400 border border-rose-400/30 hover:bg-rose-400/10 transition disabled:opacity-50">
              Remove Viewer Passcode
            </button>
          )}
        </div>
      </div>

      <PartnerManager partners={partners} onSavePartner={onSavePartner} onDeletePartner={onDeletePartner} />

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8 max-w-xl">
        <h3 className="text-xl font-bold text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Export Data</h3>
        <p className="text-xs text-zinc-500 mb-6">Download a CSV of the full ledger (daily totals).</p>
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
  const [role, setRole] = useState(() => sessionStorage.getItem("99xbet:role") || "editor");
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [legacyEntries, setLegacyEntries] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [partners, setPartners] = useState([]);
  const [recurring, setRecurring] = useState([]);
  // Viewers default to dashboard; editors keep "entry" as default
  const [tab, setTab] = useState(() =>
    sessionStorage.getItem("99xbet:role") === "viewer" ? "dashboard" : "entry"
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);

  const isViewer = role === "viewer";

  // Track Firebase Auth state. Without an authenticated user, our locked-down
  // Firestore rules will reject reads/writes — so we wait until we have one
  // before rendering anything that reads data.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
      // If sessionStorage says unlocked but Firebase has no user (e.g., session
      // restored from old build before auth was added), force re-login.
      if (sessionStorage.getItem("99xbet:unlocked") === "1" && !user) {
        sessionStorage.removeItem("99xbet:unlocked");
        sessionStorage.removeItem("99xbet:role");
        setUnlocked(false);
      }
    });
    return () => unsub();
  }, []);

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
    // Need both: passcode-unlocked AND Firebase-authenticated
    if (!unlocked || !authUser) return;
    setLoading(true);
    let entriesLoaded = false, txLoaded = false, partnersLoaded = false, recurringLoaded = false;
    const checkDone = () => { if (entriesLoaded && txLoaded && partnersLoaded && recurringLoaded) setLoading(false); };

    const unsub1 = onSnapshot(
      ENTRIES_COL,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        setLegacyEntries(list);
        entriesLoaded = true;
        checkDone();
      },
      (err) => {
        console.error("Firestore entries error:", err);
        entriesLoaded = true;
        checkDone();
      }
    );
    const unsub2 = onSnapshot(
      TX_COL,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        setTransactions(list);
        txLoaded = true;
        checkDone();
      },
      (err) => {
        console.error("Firestore transactions error:", err);
        txLoaded = true;
        checkDone();
      }
    );
    const unsub3 = onSnapshot(
      PARTNERS_COL,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        setPartners(list);
        partnersLoaded = true;
        checkDone();
      },
      (err) => {
        console.error("Firestore partners error:", err);
        partnersLoaded = true;
        checkDone();
      }
    );
    const unsub4 = onSnapshot(
      RECURRING_COL,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        setRecurring(list);
        recurringLoaded = true;
        checkDone();
      },
      (err) => {
        console.error("Firestore recurring error:", err);
        recurringLoaded = true;
        checkDone();
      }
    );
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [unlocked, authUser]);

  // Save a single transaction (the new way)
  const saveTransaction = async (tx) => {
    await setDoc(doc(db, "transactions", tx.id), tx);
  };

  const deleteTransaction = async (id) => {
    await deleteDoc(doc(db, "transactions", id));
  };

  // Delete an entire legacy daily entry
  const deleteLegacyEntry = async (id) => {
    await deleteDoc(doc(db, "entries", id));
  };

  // Partner CRUD
  const savePartner = async (partner) => {
    await setDoc(doc(db, "partners", partner.id), partner);
  };
  const deletePartner = async (id) => {
    await deleteDoc(doc(db, "partners", id));
  };

  // Recurring expense CRUD
  const saveRecurring = async (r) => {
    await setDoc(doc(db, "recurringExpenses", r.id), r);
  };
  const deleteRecurring = async (id) => {
    await deleteDoc(doc(db, "recurringExpenses", id));
  };

  // Auto-create expense transactions for recurring expenses that are due.
  // Runs whenever the recurring list updates. Uses deterministic IDs to prevent
  // duplicates if this runs multiple times. Editors only — viewers shouldn't
  // be writing data.
  useEffect(() => {
    if (!unlocked || !authUser || isViewer || recurring.length === 0) return;
    const todayStr = today();
    let cancelled = false;

    const processOne = async (rec) => {
      if (rec.status !== "active") return;
      let due = rec.nextDue;
      let updates = 0;
      // Catch up: log every missed cycle until nextDue is in the future
      while (due && due <= todayStr && updates < 60) {
        if (cancelled) return;
        const txId = `recurring_${rec.id}_${due}`;
        const tx = {
          id: txId,
          date: due,
          time: "00:00",
          amount: rec.amount,
          kind: "expense",
          category: rec.category || "fixed",
          name: rec.name,
          notes: rec.notes ? `[Recurring] ${rec.notes}` : "[Recurring]",
          partner: "—",
          source: "recurring",
          recurringId: rec.id,
          timestamp: new Date().toISOString(),
        };
        try {
          await setDoc(doc(db, "transactions", txId), tx);
          due = advanceDate(due, rec.cycle || "monthly");
          updates++;
        } catch (e) {
          console.error("Failed to auto-create recurring tx", txId, e);
          break;
        }
      }
      if (updates > 0 && !cancelled) {
        try {
          await setDoc(doc(db, "recurringExpenses", rec.id), { ...rec, nextDue: due });
        } catch (e) {
          console.error("Failed to advance recurring nextDue", rec.id, e);
        }
      }
    };

    (async () => {
      for (const rec of recurring) {
        if (cancelled) break;
        await processOne(rec);
      }
    })();

    return () => { cancelled = true; };
  }, [recurring, unlocked, authUser, isViewer]);

  const handleLock = async () => {
    sessionStorage.removeItem("99xbet:unlocked");
    sessionStorage.removeItem("99xbet:role");
    setUnlocked(false);
    setRole("editor");
    setTab("entry");
    // Sign out of Firebase Auth too — without this, a curious partner could
    // re-enter the URL and re-skip the passcode (since auth state would persist)
    try { await signOut(auth); } catch (e) { console.error(e); }
  };

  // Wait for Firebase to tell us if we're already authenticated (e.g., page refresh
  // with valid auth session). Otherwise we'd flash the wrong screen.
  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "radial-gradient(ellipse at top, #1a1f2e 0%, #0a0d14 60%)" }}>
        <div className="text-zinc-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (!unlocked) return <PasscodeScreen onUnlock={(r) => {
    setRole(r);
    setUnlocked(true);
    setTab(r === "viewer" ? "dashboard" : "entry");
  }} />;

  // Build the unified day-level data the rest of the app consumes
  const dayMap = buildDayMap(legacyEntries, transactions);
  const entries = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
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
              <div className="text-lg font-bold leading-none" style={{ fontFamily: "'Playfair Display', serif" }}>Ledger</div>
              <div className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase">{isViewer ? "View Only" : "Partner Access"}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isViewer && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400/80 px-2 py-1 rounded border border-amber-400/20 bg-amber-400/5">
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">View Only</span>
              </div>
            )}
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
            { id: "entry", label: "New Entry", icon: <Plus className="w-4 h-4" />, editorOnly: true },
            { id: "upload", label: "Upload Slips", icon: <Upload className="w-4 h-4" />, editorOnly: true },
            { id: "dashboard", label: "Dashboard", icon: <BarChart3 className="w-4 h-4" /> },
            { id: "monthly", label: "Monthly", icon: <CalendarDays className="w-4 h-4" /> },
            { id: "partners", label: "Partners", icon: <Users className="w-4 h-4" /> },
            { id: "recurring", label: "Recurring", icon: <RefreshCw className="w-4 h-4" />, editorOnly: true },
            { id: "history", label: "History", icon: <FileText className="w-4 h-4" /> },
            { id: "settings", label: "Settings", icon: <Lock className="w-4 h-4" />, editorOnly: true },
          ]
            .filter((t) => !t.editorOnly || !isViewer)
            .map((t) => (
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
            {tab === "entry" && !isViewer && <EntryForm onSave={saveTransaction} dayMap={dayMap} partners={partners} />}
            {tab === "upload" && !isViewer && <SlipUpload onSave={saveTransaction} dayMap={dayMap} />}
            {tab === "dashboard" && <Dashboard entries={entries} transactions={transactions} recurring={recurring} />}
            {tab === "monthly" && <Monthly entries={entries} transactions={transactions} />}
            {tab === "partners" && <Partners entries={entries} transactions={transactions} partners={partners} readOnly={isViewer} />}
            {tab === "recurring" && !isViewer && <RecurringExpenses recurring={recurring} onSave={saveRecurring} onDelete={deleteRecurring} />}
            {tab === "history" && <History entries={entries} onDeleteTransaction={deleteTransaction} onDeleteLegacy={deleteLegacyEntry} readOnly={isViewer} />}
            {tab === "settings" && !isViewer && <Settings entries={entries} partners={partners} onSavePartner={savePartner} onDeletePartner={deletePartner} />}
          </>
        )}

        <footer className="mt-12 text-center text-xs text-zinc-600">
          Partner Ledger · Real-time sync · MMK
        </footer>
      </main>
    </div>
  );
}
