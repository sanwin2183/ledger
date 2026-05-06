import React, { useState, useEffect, useMemo } from "react";
import { TrendingUp, TrendingDown, DollarSign, Megaphone, Lock, LogOut, Plus, Calendar, BarChart3, FileText, Trash2, Eye, EyeOff, Sparkles, Download, Wifi, WifiOff, CalendarDays, ChevronLeft, ChevronRight, Upload, Image as ImageIcon, Loader2, X, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
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
const TX_COL = collection(db, "transactions");

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
        marketing: 0,
        profit: 0,
        partner: t.partner || "—",
        notes: "",
        transactions: [],
        hasLegacy: false,
      };
    }
    if (t.kind === "income") map[t.date].income += t.amount;
    else if (t.kind === "expense") map[t.date].expenses += t.amount;
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
                    <span className={`text-2xl font-bold ${isIncome ? "text-emerald-400" : "text-rose-400"}`} style={{ fontFamily: "'Playfair Display', serif" }}>
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
function EntryForm({ onSave, dayMap }) {
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState("income");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [partner, setPartner] = useState(localStorage.getItem("99xbet:partner") || "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const day = dayMap[date];
  const amt = parseFloat(amount) || 0;

  const handleSave = async () => {
    if (!amount || amt <= 0 || saving) return;
    setSaving(true);
    if (partner.trim()) localStorage.setItem("99xbet:partner", partner.trim());

    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    const id = `${date}_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;

    const tx = {
      id,
      date,
      time,
      amount: amt,
      kind,
      name: name.trim(),
      notes: notes.trim(),
      partner: partner.trim() || "—",
      source: "manual",
      timestamp: now.toISOString(),
    };

    try {
      await onSave(tx);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setAmount(""); setName(""); setNotes("");
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
  };
  const kindActive = {
    emerald: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
    rose: "border-rose-400/50 bg-rose-400/10 text-rose-300",
    sky: "border-sky-400/50 bg-sky-400/10 text-sky-300",
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
          <div className="grid grid-cols-3 gap-2">
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
        </div>

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
              <div><span className="text-zinc-500">In:</span> <span className="text-emerald-400 font-medium ml-1">{fmtCompact(day.income)}</span></div>
              <div><span className="text-zinc-500">Exp:</span> <span className="text-rose-400 font-medium ml-1">{fmtCompact(day.expenses)}</span></div>
              <div><span className="text-zinc-500">Mkt:</span> <span className="text-sky-400 font-medium ml-1">{fmtCompact(day.marketing)}</span></div>
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
function History({ entries, onDeleteTransaction, onDeleteLegacy }) {
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
    "text-sky-400";

  const kindIcon = (k) =>
    k === "income" ? <ArrowDownCircle className="w-4 h-4" /> :
    k === "expense" ? <ArrowUpCircle className="w-4 h-4" /> :
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
                    <div className={`text-lg md:text-xl font-bold ${day.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`} style={{ fontFamily: "'Playfair Display', serif" }}>
                      {fmtCompact(day.profit)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      <span className="text-emerald-400">{fmtCompact(day.income)}</span>
                      <span className="mx-1">·</span>
                      <span className="text-rose-400">{fmtCompact(day.expenses)}</span>
                      {day.marketing > 0 && (
                        <>
                          <span className="mx-1">·</span>
                          <span className="text-sky-400">{fmtCompact(day.marketing)}</span>
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
                      {confirmDayId === day.date ? (
                        <div className="flex gap-2">
                          <button onClick={() => { onDeleteLegacy(day.date); setConfirmDayId(null); }} className="text-rose-400 text-xs font-semibold">Confirm delete day</button>
                          <button onClick={() => setConfirmDayId(null)} className="text-zinc-500 text-xs">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDayId(day.date)} className="text-zinc-500 hover:text-rose-400 text-xs flex items-center gap-1">
                          <Trash2 className="w-3 h-3" /> Delete entire day
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {day.hasLegacy && (day.income > 0 || day.expenses > 0 || day.marketing > 0) && (
                        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs flex items-center justify-between">
                          <div>
                            <div className="text-zinc-400 mb-1">Imported summary (also for this day)</div>
                            <div className="text-zinc-500">
                              In: {fmtCompact(day.income - day.transactions.filter(t => t.kind === "income").reduce((s, t) => s + t.amount, 0))} ·
                              Exp: {fmtCompact(day.expenses - day.transactions.filter(t => t.kind === "expense").reduce((s, t) => s + t.amount, 0))} ·
                              Mkt: {fmtCompact(day.marketing - day.transactions.filter(t => t.kind === "marketing").reduce((s, t) => s + t.amount, 0))}
                            </div>
                          </div>
                          {confirmDayId === day.date ? (
                            <div className="flex gap-2">
                              <button onClick={() => { onDeleteLegacy(day.date); setConfirmDayId(null); }} className="text-rose-400 text-xs font-semibold">Delete</button>
                              <button onClick={() => setConfirmDayId(null)} className="text-zinc-500 text-xs">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDayId(day.date)} className="text-zinc-500 hover:text-rose-400">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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
                                  {tx.source === "slip" && <span className="text-[10px] uppercase tracking-wider text-amber-400/80">Slip</span>}
                                </div>
                                <div className="text-xs text-zinc-500 mt-0.5 truncate">
                                  {tx.time && <span>{tx.time}</span>}
                                  {tx.name && <span> · {tx.name}</span>}
                                  {tx.partner && tx.partner !== "—" && <span> · {tx.partner}</span>}
                                </div>
                                {tx.notes && <div className="text-xs text-zinc-400 italic mt-1">{tx.notes}</div>}
                              </div>
                            </div>
                            {confirmTxId === tx.id ? (
                              <div className="flex gap-2 flex-shrink-0">
                                <button onClick={() => { onDeleteTransaction(tx.id); setConfirmTxId(null); }} className="text-rose-400 text-xs font-semibold">Confirm</button>
                                <button onClick={() => setConfirmTxId(null)} className="text-zinc-500 text-xs">Cancel</button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmTxId(tx.id)} className="text-zinc-500 hover:text-rose-400 flex-shrink-0">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
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
function Monthly({ entries }) {
  const months = useMemo(() => {
    const map = {};
    entries.forEach((e) => {
      const ym = e.date.slice(0, 7);
      if (!map[ym]) map[ym] = { ym, entries: [], income: 0, expenses: 0, marketing: 0, profit: 0 };
      map[ym].entries.push(e);
      map[ym].income += e.income;
      map[ym].expenses += e.expenses;
      map[ym].marketing += e.marketing;
      map[ym].profit += e.profit;
    });
    return Object.values(map).sort((a, b) => b.ym.localeCompare(a.ym));
  }, [entries]);

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
    .map((e) => ({ date: e.date.slice(8), profit: e.profit }));

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
        <KpiCard label="Net P/L" value={fmtCompact(selectedMonth.profit)} sub={`${margin.toFixed(1)}% margin`} accent={selectedMonth.profit >= 0 ? "#10b981" : "#f43f5e"} icon={<DollarSign className="w-4 h-4" />} />
        <KpiCard label="Revenue" value={fmtCompact(selectedMonth.income)} sub={`${selectedMonth.entries.length} days`} accent="#d4af37" icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Expenses" value={fmtCompact(selectedMonth.expenses)} sub="Operating" accent="#f43f5e" icon={<TrendingDown className="w-4 h-4" />} />
        <KpiCard label="Marketing" value={fmtCompact(selectedMonth.marketing)} sub="Spend" accent="#0ea5e9" icon={<Megaphone className="w-4 h-4" />} />
      </div>

      {compare && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-3">vs. {monthLabel(prevMonth.ym)}</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-zinc-500 mb-1">Profit change</div>
              <div className={`text-lg font-bold ${compare.profitDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {compare.profitDelta >= 0 ? "+" : ""}{fmtCompact(compare.profitDelta)}
                {compare.profitPct !== null && <span className="text-xs ml-2 text-zinc-500">({compare.profitPct >= 0 ? "+" : ""}{compare.profitPct.toFixed(1)}%)</span>}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1">Revenue change</div>
              <div className={`text-lg font-bold ${compare.incomeDelta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {compare.incomeDelta >= 0 ? "+" : ""}{fmtCompact(compare.incomeDelta)}
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
              <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtCompact} />
              <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8 }} labelStyle={{ color: "#a1a1aa" }} formatter={(v) => fmt(v)} />
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
                  <div className={`text-lg font-bold ${m.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`} style={{ fontFamily: "'Playfair Display', serif" }}>
                    {fmtCompact(m.profit)}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs mt-3">
                  <div><span className="text-zinc-500">Rev</span><div className="text-emerald-400 font-medium">{fmtCompact(m.income)}</div></div>
                  <div><span className="text-zinc-500">Exp</span><div className="text-rose-400 font-medium">{fmtCompact(m.expenses)}</div></div>
                  <div><span className="text-zinc-500">Mkt</span><div className="text-sky-400 font-medium">{fmtCompact(m.marketing)}</div></div>
                </div>
              </button>
            );
          })}
        </div>
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
  const [legacyEntries, setLegacyEntries] = useState([]);
  const [transactions, setTransactions] = useState([]);
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
    let entriesLoaded = false, txLoaded = false;
    const checkDone = () => { if (entriesLoaded && txLoaded) setLoading(false); };

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
    return () => { unsub1(); unsub2(); };
  }, [unlocked]);

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

  const handleLock = () => {
    sessionStorage.removeItem("99xbet:unlocked");
    setUnlocked(false);
  };

  if (!unlocked) return <PasscodeScreen onUnlock={() => setUnlocked(true)} />;

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
              <div className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase">Partner Access</div>
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
            { id: "upload", label: "Upload Slips", icon: <Upload className="w-4 h-4" /> },
            { id: "dashboard", label: "Dashboard", icon: <BarChart3 className="w-4 h-4" /> },
            { id: "monthly", label: "Monthly", icon: <CalendarDays className="w-4 h-4" /> },
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
            {tab === "entry" && <EntryForm onSave={saveTransaction} dayMap={dayMap} />}
            {tab === "upload" && <SlipUpload onSave={saveTransaction} dayMap={dayMap} />}
            {tab === "dashboard" && <Dashboard entries={entries} />}
            {tab === "monthly" && <Monthly entries={entries} />}
            {tab === "history" && <History entries={entries} onDeleteTransaction={deleteTransaction} onDeleteLegacy={deleteLegacyEntry} />}
            {tab === "settings" && <Settings entries={entries} />}
          </>
        )}

        <footer className="mt-12 text-center text-xs text-zinc-600">
          Partner Ledger · Real-time sync · MMK
        </footer>
      </main>
    </div>
  );
}
