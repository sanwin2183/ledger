import React, { useState, useEffect, useMemo } from "react";
import {
  TrendingUp, TrendingDown, Wallet, Lock, LogOut, Plus, Calendar, BarChart3, FileText, Trash2, Eye, EyeOff, Sparkles, Download, Wifi, WifiOff, CalendarDays, ChevronLeft, ChevronRight, Upload, Image as ImageIcon, Loader2, X, ArrowDownCircle, ArrowUpCircle,
  UtensilsCrossed, Car, Lightbulb, ShoppingBag, Film, MoreHorizontal, Home, Repeat, AlertCircle, Pencil, CheckCircle2,
  Heart, Baby, PawPrint, Plane, Gift, Briefcase, GraduationCap, Dumbbell, Scissors, Wrench, Fuel, Coffee, Cigarette, Beer, Pill, Smartphone, Receipt, ChevronDown, ChevronUp, Tag,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Cell, PieChart, Pie } from "recharts";
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "./firebase";

// ---------- CONFIG ----------
const DEFAULT_PASSCODE = "household2026";
const CURRENCY_SYMBOL = "฿";
const CURRENCY_CODE = "THB";
const CONFIG_DOC = doc(db, "config", "main");
const TX_COL = collection(db, "transactions");
const SUBS_COL = collection(db, "subscriptions");
const CAT_COL = collection(db, "categories");

// ---------- ICON LIBRARY (curated) ----------
// We expose a curated subset of lucide-react icons for the category picker.
// Adding more is easy — just import + add to ICON_OPTIONS.
const ICON_OPTIONS = {
  utensils: { Cmp: null, label: "Food" },
  car: { Cmp: null, label: "Car" },
  lightbulb: { Cmp: null, label: "Utilities" },
  shoppingbag: { Cmp: null, label: "Shopping" },
  film: { Cmp: null, label: "Movies" },
  more: { Cmp: null, label: "Other" },
  home: { Cmp: null, label: "Home" },
  heart: { Cmp: null, label: "Health" },
  baby: { Cmp: null, label: "Kids" },
  pawprint: { Cmp: null, label: "Pets" },
  plane: { Cmp: null, label: "Travel" },
  gift: { Cmp: null, label: "Gifts" },
  briefcase: { Cmp: null, label: "Work" },
  graduationcap: { Cmp: null, label: "Education" },
  dumbbell: { Cmp: null, label: "Fitness" },
  scissors: { Cmp: null, label: "Personal Care" },
  wrench: { Cmp: null, label: "Repair" },
  fuel: { Cmp: null, label: "Fuel" },
  coffee: { Cmp: null, label: "Coffee" },
  cigarette: { Cmp: null, label: "Vices" },
  beer: { Cmp: null, label: "Drinks" },
  pill: { Cmp: null, label: "Medical" },
  smartphone: { Cmp: null, label: "Tech" },
  receipt: { Cmp: null, label: "Bills" },
};

const COLOR_OPTIONS = [
  "#f97316", "#06b6d4", "#eab308", "#ec4899", "#8b5cf6", "#71717a",
  "#10b981", "#f43f5e", "#0ea5e9", "#a855f7", "#84cc16", "#f59e0b",
];

// ---------- DEFAULT CATEGORIES (seeded on first run) ----------
const DEFAULT_CATEGORIES = [
  { id: "food", label: "Food & Drink", icon: "utensils", color: "#f97316", order: 0, isDefault: true },
  { id: "transport", label: "Transport", icon: "car", color: "#06b6d4", order: 1, isDefault: true },
  { id: "utilities", label: "Utilities", icon: "lightbulb", color: "#eab308", order: 2, isDefault: true },
  { id: "shopping", label: "Shopping", icon: "shoppingbag", color: "#ec4899", order: 3, isDefault: true },
  { id: "entertainment", label: "Entertainment", icon: "film", color: "#8b5cf6", order: 4, isDefault: true },
  { id: "other", label: "Other", icon: "more", color: "#71717a", order: 5, isDefault: true },
];

// Wire up icon components into ICON_OPTIONS
ICON_OPTIONS.utensils.Cmp = UtensilsCrossed;
ICON_OPTIONS.car.Cmp = Car;
ICON_OPTIONS.lightbulb.Cmp = Lightbulb;
ICON_OPTIONS.shoppingbag.Cmp = ShoppingBag;
ICON_OPTIONS.film.Cmp = Film;
ICON_OPTIONS.more.Cmp = MoreHorizontal;
ICON_OPTIONS.home.Cmp = Home;
ICON_OPTIONS.heart.Cmp = Heart;
ICON_OPTIONS.baby.Cmp = Baby;
ICON_OPTIONS.pawprint.Cmp = PawPrint;
ICON_OPTIONS.plane.Cmp = Plane;
ICON_OPTIONS.gift.Cmp = Gift;
ICON_OPTIONS.briefcase.Cmp = Briefcase;
ICON_OPTIONS.graduationcap.Cmp = GraduationCap;
ICON_OPTIONS.dumbbell.Cmp = Dumbbell;
ICON_OPTIONS.scissors.Cmp = Scissors;
ICON_OPTIONS.wrench.Cmp = Wrench;
ICON_OPTIONS.fuel.Cmp = Fuel;
ICON_OPTIONS.coffee.Cmp = Coffee;
ICON_OPTIONS.cigarette.Cmp = Cigarette;
ICON_OPTIONS.beer.Cmp = Beer;
ICON_OPTIONS.pill.Cmp = Pill;
ICON_OPTIONS.smartphone.Cmp = Smartphone;
ICON_OPTIONS.receipt.Cmp = Receipt;

// Look up a category by id from the live list, with sensible fallbacks for legacy data
function getCategoryConfig(categories, id) {
  const found = categories.find((c) => c.id === id);
  if (found) return found;
  // Fallback to "other" or a synthetic placeholder for orphaned IDs
  const other = categories.find((c) => c.id === "other");
  if (other) return other;
  return { id: "unknown", label: "Other", icon: "more", color: "#71717a" };
}

function getCategoryIcon(iconKey) {
  return ICON_OPTIONS[iconKey]?.Cmp || MoreHorizontal;
}

// ---------- HELPERS ----------
const fmt = (n) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + CURRENCY_SYMBOL + abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const fmtCompact = (n) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return sign + CURRENCY_SYMBOL + (abs / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return sign + CURRENCY_SYMBOL + (abs / 1_000).toFixed(1) + "K";
  return sign + CURRENCY_SYMBOL + abs.toFixed(0);
};

const today = () => new Date().toISOString().slice(0, 10);

// Advance an ISO date string by one billing cycle. Handles month overflow correctly.
// Format an ISO date string in Gregorian English. iOS Safari sometimes renders
// date pickers in Buddhist year (BE) when device locale is Thai. We display
// this below the picker so users always see the real Gregorian date.
function formatDateLabel(isoDate) {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      calendar: "gregory",
    });
  } catch {
    return isoDate;
  }
}

function advanceDate(isoDate, cycle) {
  const d = new Date(isoDate + "T00:00:00");
  if (cycle === "yearly") {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    // monthly: handle end-of-month. If you're on the 31st and next month has 30 days,
    // JavaScript Date will roll into the next-next month. So we clamp.
    const targetMonth = d.getMonth() + 1;
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(targetMonth);
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, daysInMonth));
  }
  return d.toISOString().slice(0, 10);
}

// ---------- DATA MODEL ----------
function buildDayMap(transactions) {
  const map = {};
  transactions.forEach((t) => {
    if (!map[t.date]) {
      map[t.date] = { date: t.date, income: 0, expenses: 0, profit: 0, transactions: [] };
    }
    if (t.kind === "income") map[t.date].income += t.amount;
    else map[t.date].expenses += t.amount;
    map[t.date].transactions.push(t);
  });
  Object.values(map).forEach((d) => {
    d.profit = d.income - d.expenses;
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
      if (!snap.exists()) await setDoc(CONFIG_DOC, { passcode: DEFAULT_PASSCODE });
      if (code === correct) {
        sessionStorage.setItem("household:unlocked", "1");
        onUnlock();
      } else {
        setError("Incorrect passcode");
        setCode("");
      }
    } catch (e) {
      setError("Could not connect. Check Firebase config.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "radial-gradient(ellipse at top, #2a1f3e 0%, #0a0d14 60%)" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}>
              <Home className="w-6 h-6 text-black" strokeWidth={2.5} />
            </div>
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-white mb-2" style={{ fontFamily: "'Playfair Display', serif", letterSpacing: "-0.02em" }}>
            Household
          </h1>
          <p className="text-sm text-zinc-500 tracking-[0.3em] uppercase">Personal Ledger</p>
        </div>

        <div className="bg-zinc-900/60 backdrop-blur-xl border border-zinc-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-zinc-300 tracking-wide">Family Access</span>
          </div>
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleSubmit()}
              placeholder="Enter passcode"
              className="w-full bg-black/40 border border-zinc-800 focus:border-violet-400/60 rounded-xl px-4 py-4 text-white text-lg tracking-widest outline-none transition-colors"
              autoFocus
            />
            <button onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full mt-6 py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}
          >
            {loading ? "Connecting…" : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- ENTRY FORM ----------
function EntryForm({ onSave, dayMap, categories }) {
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState("expense"); // expense by default for personal use
  const [category, setCategory] = useState("food");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [partner, setPartner] = useState(localStorage.getItem("household:partner") || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // If "food" doesn't exist in user's categories (rare edge case), default to first
  useEffect(() => {
    if (categories.length > 0 && !categories.find(c => c.id === category)) {
      setCategory(categories[0].id);
    }
  }, [categories, category]);

  const day = dayMap[date];
  const amt = parseFloat(amount) || 0;

  const handleSave = async () => {
    if (!amount || amt <= 0 || saving) return;
    setSaving(true);
    if (partner.trim()) localStorage.setItem("household:partner", partner.trim());

    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    const id = `${date}_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;

    const tx = {
      id, date, time,
      amount: amt,
      kind,
      category: kind === "income" ? "income" : category,
      description: description.trim(),
      partner: partner.trim() || "—",
      source: "manual",
      timestamp: now.toISOString(),
    };

    try {
      await onSave(tx);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setAmount(""); setDescription("");
    } catch (e) {
      alert("Save failed: " + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-violet-400/10 border border-violet-400/20 flex items-center justify-center">
          <Plus className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>New Transaction</h2>
          <p className="text-xs text-zinc-500">Manual entry — for cash, card, or anything without a slip</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Date</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <input
              type="date" lang="en-US"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-black/40 border border-zinc-800 rounded-lg pl-10 pr-4 py-3 text-white outline-none focus:border-violet-400/60"
            />
          </div>
          <p className="text-xs text-zinc-500 mt-1.5">{formatDateLabel(date)}</p>
        </div>

        {/* Income vs Expense toggle */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setKind("income")}
              className={`flex items-center justify-center gap-2 py-3 rounded-lg border-2 text-sm font-medium transition ${
                kind === "income" ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300" : "border-zinc-800 text-zinc-500"
              }`}
            >
              <ArrowDownCircle className="w-4 h-4" /> Income
            </button>
            <button
              onClick={() => setKind("expense")}
              className={`flex items-center justify-center gap-2 py-3 rounded-lg border-2 text-sm font-medium transition ${
                kind === "expense" ? "border-rose-400/50 bg-rose-400/10 text-rose-300" : "border-zinc-800 text-zinc-500"
              }`}
            >
              <ArrowUpCircle className="w-4 h-4" /> Expense
            </button>
          </div>
        </div>

        {/* Category — only for expenses */}
        {kind === "expense" && (
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {categories.map((cat) => {
                const Icon = getCategoryIcon(cat.icon);
                const selected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg border-2 text-xs font-medium transition ${selected ? "" : "border-zinc-800 text-zinc-500"}`}
                    style={selected ? { borderColor: cat.color, background: cat.color + "1a", color: cat.color } : {}}
                  >
                    <Icon className="w-4 h-4" />
                    {cat.label}
                  </button>
                );
              })}
            </div>
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
            className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white text-lg outline-none focus:border-violet-400/60"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={kind === "income" ? "Source / details" : "What was it for?"}
            className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-violet-400/60"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Logged by</label>
          <input
            type="text"
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
            placeholder="Your name"
            className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-violet-400/60"
          />
        </div>

        {day && (day.income > 0 || day.expenses > 0) && (
          <div className="p-3 rounded-lg bg-black/40 border border-zinc-800 text-xs">
            <div className="text-zinc-500 uppercase tracking-wider mb-2">{date} so far</div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-zinc-500">In:</span> <span className="text-emerald-400 font-medium ml-1">{fmtCompact(day.income)}</span></div>
              <div><span className="text-zinc-500">Out:</span> <span className="text-rose-400 font-medium ml-1">{fmtCompact(day.expenses)}</span></div>
            </div>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving || !amount || amt <= 0}
          className="w-full py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
          style={{ background: saving ? "#8b5cf6" : "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </span>
          ) : saved ? "✓ Saved" : `Save ${kind === "income" ? "income" : "expense"}`}
        </button>
      </div>
    </div>
  );
}

// ---------- SLIP UPLOAD ----------
function SlipUpload({ onSave, categories }) {
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState(null); // "income" or "expense"
  const [category, setCategory] = useState("food");
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Default to first category if "food" doesn't exist
  useEffect(() => {
    if (categories.length > 0 && !categories.find(c => c.id === category)) {
      setCategory(categories[0].id);
    }
  }, [categories, category]);

  const parseAmount = (text) => {
    const rawLines = text.split("\n").map((l) => l.trim());
    const lines = rawLines.filter(Boolean);

    // Helper: extract amount-shaped numbers (with optional decimals).
    // Prefers numbers WITH decimals (likely currency) over numbers without.
    const extractFromLine = (line) => {
      // Skip lines that are clearly reference numbers / IDs / transaction codes
      if (/ref|reference|trans(action)? id|biller|merchant|order|account|no\./i.test(line)) {
        return null;
      }
      // Match numbers like 230.00 or 1,500.50 or 230 or 1,500
      const matches = line.match(/[\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g);
      if (!matches) return null;
      const nums = matches
        .map(s => ({ raw: s, val: parseFloat(s.replace(/,/g, "")) }))
        .filter(n => !isNaN(n.val) && n.val >= 1 && n.val < 10_000_000);
      if (nums.length === 0) return null;
      // Prefer ones with decimal points (real currency formatting)
      const withDecimal = nums.filter(n => n.raw.includes("."));
      if (withDecimal.length) return Math.max(...withDecimal.map(n => n.val));
      return Math.max(...nums.map(n => n.val));
    };

    // Pass 1: "Amount" appears on a line — check that line AND the next 1-2 lines
    // (Bangkok Bank format puts label and value on different lines)
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:amount|total\s*amount|total)\s*:?\s*$/i.test(lines[i]) ||
          /amount/i.test(lines[i])) {
        // Check this line and next 2 for the value
        for (let j = i; j < Math.min(i + 3, lines.length); j++) {
          // Skip lines that mention reference/id/biller etc.
          if (j > i && /ref|reference|trans(action)? id|biller|merchant|order|fee/i.test(lines[j])) continue;
          const v = extractFromLine(lines[j]);
          if (v !== null) return v;
        }
      }
    }

    // Pass 2: number followed by Baht/THB/฿ — allowing optional space and case
    for (const line of lines) {
      const m = line.match(/([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:baht|thb|฿)\b/i);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ""));
        if (num >= 1 && num < 10_000_000) return num;
      }
    }

    // Pass 3: any number with currency symbol prefix (฿230 / THB 230)
    for (const line of lines) {
      const m = line.match(/(?:baht|thb|฿)\s*([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ""));
        if (num >= 1 && num < 10_000_000) return num;
      }
    }

    // Pass 4: fallback — largest reasonable number, but EXCLUDE lines that look
    // like reference/id/transaction lines, AND prefer numbers with decimal points
    const candidates = [];
    for (const line of lines) {
      if (/ref|reference|trans(action)? id|biller|merchant|order|account|no\.|id\s*[:#]/i.test(line)) continue;
      const matches = line.match(/[\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g);
      if (!matches) continue;
      for (const m of matches) {
        const val = parseFloat(m.replace(/,/g, ""));
        // Cap at 1M for personal finance — anything larger is almost certainly a reference number
        if (!isNaN(val) && val >= 1 && val < 1_000_000) {
          candidates.push({ raw: m, val, hasDecimal: m.includes(".") });
        }
      }
    }
    if (candidates.length) {
      const withDecimal = candidates.filter(c => c.hasDecimal);
      if (withDecimal.length) return Math.max(...withDecimal.map(c => c.val));
      return Math.max(...candidates.map(c => c.val));
    }

    return null;
  };

  const handlePickFiles = (k) => (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;
    setKind(k);
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
      const uid = `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 9)}`;
      try {
        const { data } = await Tesseract.recognize(files[i], "eng");
        const amount = parseAmount(data.text);
        out.push({ uid, fileName: files[i].name, fileUrl: URL.createObjectURL(files[i]), amount, error: false });
      } catch (err) {
        out.push({ uid, fileName: files[i].name, fileUrl: URL.createObjectURL(files[i]), amount: null, error: true });
      }
      setResults([...out]);
    }
    setProcessing(false);
  };

  const updateAmount = (idx, val) => {
    setResults((prev) => prev.map((r, i) => (i === idx ? { ...r, amount: val } : r)));
  };
  const removeResult = (idx) => setResults((prev) => prev.filter((_, i) => i !== idx));

  const reset = () => {
    setFiles([]); setResults([]); setKind(null); setSaveMsg("");
  };

  const totals = useMemo(() => {
    let sum = 0, ready = 0;
    results.forEach(r => {
      if (r.amount && r.amount > 0) { sum += r.amount; ready++; }
    });
    return { sum, ready };
  }, [results]);

  const handleSave = async () => {
    if (totals.ready === 0 || !kind || saving) return;
    setSaving(true);
    setSaveMsg("");

    const partner = localStorage.getItem("household:partner") || "—";
    const now = new Date();
    const toSave = results.filter(r => r.amount && r.amount > 0);
    const savedSum = toSave.reduce((s, r) => s + r.amount, 0);
    const savedCount = toSave.length;
    const savedKind = kind;
    const savedDate = date;

    try {
      for (const r of toSave) {
        const id = `${date}_slip_${r.uid}`;
        const tx = {
          id, date,
          time: now.toTimeString().slice(0, 5),
          amount: r.amount,
          kind,
          category: kind === "income" ? "income" : category,
          description: "",
          partner,
          source: "slip",
          timestamp: new Date().toISOString(),
        };
        await onSave(tx);
      }
      setFiles([]); setResults([]); setKind(null);
      setSaveMsg(`✓ Added ${savedCount} ${savedKind} transaction${savedCount > 1 ? "s" : ""} (${fmt(savedSum)}) to ${savedDate}`);
      setTimeout(() => setSaveMsg(""), 4000);
    } catch (err) {
      setSaveMsg("Save failed: " + err.message);
    }
    setSaving(false);
  };

  const isIncome = kind === "income";
  const isExpense = kind === "expense";

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-violet-400/10 border border-violet-400/20 flex items-center justify-center">
          <Upload className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Upload Slips</h2>
          <p className="text-xs text-zinc-500">SCB, KBank, Bangkok Bank, etc.</p>
        </div>
      </div>

      <div className="mb-5">
        <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Apply to date</label>
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            type="date" lang="en-US"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-black/40 border border-zinc-800 rounded-lg pl-10 pr-4 py-3 text-white outline-none focus:border-violet-400/60"
          />
        </div>
        <p className="text-xs text-zinc-500 mt-1.5">{formatDateLabel(date)}</p>
      </div>

      {!kind && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-emerald-400/30 bg-emerald-400/5 hover:bg-emerald-400/10 cursor-pointer transition">
            <ArrowDownCircle className="w-8 h-8 text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-300">Income</span>
            <span className="text-xs text-zinc-500 text-center">Money received</span>
            <input type="file" accept="image/*" multiple onChange={handlePickFiles("income")} className="hidden" />
          </label>
          <label className="flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-rose-400/30 bg-rose-400/5 hover:bg-rose-400/10 cursor-pointer transition">
            <ArrowUpCircle className="w-8 h-8 text-rose-400" />
            <span className="text-sm font-semibold text-rose-300">Expense</span>
            <span className="text-xs text-zinc-500 text-center">Money paid out</span>
            <input type="file" accept="image/*" multiple onChange={handlePickFiles("expense")} className="hidden" />
          </label>
        </div>
      )}

      {kind && (
        <>
          <div className={`flex items-center justify-between p-3 rounded-lg mb-4 ${isIncome ? "bg-emerald-400/10 border border-emerald-400/20" : "bg-rose-400/10 border border-rose-400/20"}`}>
            <div className="flex items-center gap-2">
              {isIncome ? <ArrowDownCircle className="w-5 h-5 text-emerald-400" /> : <ArrowUpCircle className="w-5 h-5 text-rose-400" />}
              <span className={`text-sm font-semibold ${isIncome ? "text-emerald-300" : "text-rose-300"}`}>
                {isIncome ? "Income slips" : "Expense slips"} · {files.length} selected
              </span>
            </div>
            <button onClick={reset} className="text-xs text-zinc-400 hover:text-white">Change</button>
          </div>

          {/* Category picker for expense slips */}
          {isExpense && results.length === 0 && (
            <div className="mb-4">
              <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Category for these slips</label>
              <div className="grid grid-cols-3 gap-2">
                {categories.map((cat) => {
                  const Icon = getCategoryIcon(cat.icon);
                  const selected = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setCategory(cat.id)}
                      className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg border-2 text-xs font-medium transition ${selected ? "" : "border-zinc-800 text-zinc-500"}`}
                      style={selected ? { borderColor: cat.color, background: cat.color + "1a", color: cat.color } : {}}
                    >
                      <Icon className="w-4 h-4" />
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {files.length > 0 && results.length === 0 && (
            <button
              onClick={processFiles}
              disabled={processing}
              className="w-full py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}
            >
              {processing ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reading slip {progress.current} of {progress.total}…
                </span>
              ) : `Read ${files.length} slip${files.length > 1 ? "s" : ""}`}
            </button>
          )}

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
                        {r.error && <p className="text-xs text-rose-400">Could not read — enter manually</p>}
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
                          <span className="text-xs text-zinc-500">{CURRENCY_SYMBOL}</span>
                        </div>
                      </div>
                      <button onClick={() => removeResult(idx)} className="text-zinc-500 hover:text-rose-400">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {!processing && totals.ready > 0 && (
                <div className={`mt-6 p-4 rounded-xl ${isIncome ? "bg-emerald-400/5 border border-emerald-400/20" : "bg-rose-400/5 border border-rose-400/20"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Total {isIncome ? "income" : "expenses"} to add</span>
                    <span className={`text-2xl font-bold ${isIncome ? "text-emerald-400" : "text-rose-400"}`} style={{ fontFamily: "'Playfair Display', serif" }}>
                      {fmt(totals.sum)}
                    </span>
                  </div>
                  {isExpense && (
                    <div className="text-xs text-zinc-500 mt-1">All as: {getCategoryConfig(categories, category).label}</div>
                  )}
                </div>
              )}

              {!processing && (
                <button
                  onClick={handleSave}
                  disabled={saving || totals.ready === 0}
                  className="w-full mt-4 py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 disabled:opacity-60"
                  style={{ background: saving ? "#8b5cf6" : "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving {totals.ready} transaction{totals.ready > 1 ? "s" : ""}…
                    </span>
                  ) : `Save to ${date}`}
                </button>
              )}

              {saveMsg && <p className="text-sm text-emerald-400 mt-3 text-center">{saveMsg}</p>}
            </>
          )}
        </>
      )}

      <p className="text-xs text-zinc-600 mt-6 leading-relaxed flex items-center gap-1.5">
        <Lock className="w-3 h-3" /> Slips processed on your device — never uploaded
      </p>
    </div>
  );
}

// ---------- KPI CARD ----------
function KpiCard({ label, value, sub, accent, icon }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden">
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-10" style={{ background: accent }} />
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">{label}</span>
        <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: accent + "20", color: accent }}>{icon}</div>
      </div>
      <div className="text-xl md:text-2xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

// ---------- DASHBOARD ----------
// ---------- CATEGORY PIE WITH DRILL ----------
// Reusable pie chart that lets the user tap a slice to see all transactions
// in that category. Used by Dashboard (all-time) and Monthly (single month).
//
// Props:
//   title, subtitle: heading text
//   pieData: array of { key, name, value, color } sorted or unsorted
//   transactions: array of transactions ALREADY filtered to the scope
//                 (e.g. all transactions for Dashboard, just this month for Monthly)
//   totalForPct: denominator for percentage calculation (e.g. totalExpenses)
function CategoryPieWithDrill({ title, subtitle, pieData, transactions, totalForPct }) {
  const [selectedKey, setSelectedKey] = useState(null);
  if (pieData.length === 0) return null;

  // Sort by value descending — same order for chart and legend so colors line up.
  const sortedPie = [...pieData].sort((a, b) => b.value - a.value);
  const selected = selectedKey ? sortedPie.find((d) => d.key === selectedKey) : null;

  const handleSelect = (key) => {
    setSelectedKey((prev) => (prev === key ? null : key));
  };

  // Transactions for the selected category, most recent first
  const drillTx = selected
    ? transactions
        .filter((t) => t.kind === "expense" && t.category === selected.key)
        .sort((a, b) => {
          if (b.date !== a.date) return b.date.localeCompare(a.date);
          return (b.time || "").localeCompare(a.time || "");
        })
    : [];

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>{title}</h3>
          {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
        </div>
        {selected && (
          <button
            onClick={() => setSelectedKey(null)}
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded border border-zinc-800 hover:border-zinc-700"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={sortedPie}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={85}
                dataKey="value"
                isAnimationActive={false}
                onClick={(slice) => slice && slice.key && handleSelect(slice.key)}
                cursor="pointer"
              >
                {sortedPie.map((d) => (
                  <Cell
                    key={d.key}
                    fill={d.color}
                    stroke={selectedKey === d.key ? "#fff" : "transparent"}
                    strokeWidth={selectedKey === d.key ? 2 : 0}
                    fillOpacity={selectedKey && selectedKey !== d.key ? 0.35 : 1}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8 }}
                formatter={(v) => fmt(v)}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {sortedPie.map((d) => {
            const pct = totalForPct > 0 ? (d.value / totalForPct) * 100 : 0;
            const isSelected = selectedKey === d.key;
            return (
              <button
                key={d.key}
                onClick={() => handleSelect(d.key)}
                className={`w-full flex items-center justify-between text-sm rounded-lg px-2 py-1.5 transition ${
                  isSelected ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.color }} />
                  <span className={`${isSelected ? "text-white font-medium" : "text-zinc-300"} truncate`}>{d.name}</span>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-white font-medium">{fmtCompact(d.value)}</div>
                  <div className="text-xs text-zinc-500">{pct.toFixed(1)}%</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Transaction drill-down */}
      {selected && (
        <div className="mt-5 pt-5 border-t border-zinc-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: selected.color }} />
                <h4 className="text-base font-bold text-white">{selected.name}</h4>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                {drillTx.length} transaction{drillTx.length === 1 ? "" : "s"} · {fmt(selected.value)} total
              </p>
            </div>
          </div>
          {drillTx.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">No transactions in this scope.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {drillTx.map((t) => (
                <div key={t.id} className="flex items-center justify-between bg-black/30 border border-zinc-800 rounded-lg px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white font-medium truncate">{t.description || t.name || "—"}</div>
                    <div className="text-xs text-zinc-500">
                      {formatDateLabel(t.date)}{t.time ? ` · ${t.time}` : ""}
                      {t.source === "subscription" && <span className="ml-1 text-violet-400">· Subscription</span>}
                      {t.source === "slip" && <span className="ml-1 text-amber-400">· Slip</span>}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-rose-400 tabular-nums flex-shrink-0 ml-3">
                    {fmt(t.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Dashboard({ entries, transactions, subscriptions = [], categories }) {
  const stats = useMemo(() => {
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const totalIncome = entries.reduce((s, e) => s + e.income, 0);
    const totalExpenses = entries.reduce((s, e) => s + e.expenses, 0);
    const totalProfit = totalIncome - totalExpenses;
    const last7 = sorted.slice(-7);
    const sum7 = last7.reduce((s, e) => s + e.profit, 0);

    // Subscription monthly burn
    const subMonthly = subscriptions
      .filter(s => s.status === "active")
      .reduce((sum, s) => sum + (s.cycle === "yearly" ? s.amount / 12 : s.amount), 0);
    const activeSubsCount = subscriptions.filter(s => s.status === "active").length;

    let running = 0;
    const chartData = sorted.map(e => {
      running += e.profit;
      return { date: e.date.slice(5), cumulative: running };
    });

    // Category breakdown
    const catTotals = {};
    transactions.forEach(t => {
      if (t.kind === "expense") {
        catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
      }
    });
    const pieData = categories
      .map(c => ({ name: c.label, value: catTotals[c.id] || 0, color: c.color, key: c.id }))
      .filter(d => d.value > 0);

    return { totalIncome, totalExpenses, totalProfit, sum7, chartData, last30Data: chartData.slice(-30), pieData, subMonthly, activeSubsCount };
  }, [entries, transactions, categories, subscriptions]);

  if (entries.length === 0) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center">
        <BarChart3 className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>No data yet</h3>
        <p className="text-zinc-500 text-sm">Add your first transaction to see the dashboard.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Net" value={fmtCompact(stats.totalProfit)} sub="Income − Expenses" accent={stats.totalProfit >= 0 ? "#10b981" : "#f43f5e"} icon={<Wallet className="w-4 h-4" />} />
        <KpiCard label="Income" value={fmtCompact(stats.totalIncome)} sub="All time" accent="#8b5cf6" icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Expenses" value={fmtCompact(stats.totalExpenses)} sub="All time" accent="#f43f5e" icon={<TrendingDown className="w-4 h-4" />} />
        <KpiCard label="Last 7 Days" value={fmtCompact(stats.sum7)} sub="Net" accent="#0ea5e9" icon={<Calendar className="w-4 h-4" />} />
      </div>

      {stats.activeSubsCount > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-400/10 border border-violet-400/20 flex items-center justify-center">
                <Repeat className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Subscription Burn</div>
                <div className="text-xs text-zinc-500">{stats.activeSubsCount} active</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold text-violet-400" style={{ fontFamily: "'Playfair Display', serif" }}>{fmt(stats.subMonthly)}</div>
              <div className="text-xs text-zinc-500">/month</div>
            </div>
          </div>
        </div>
      )}

      {/* Spending by category pie */}
      <CategoryPieWithDrill
        title="Spending by Category"
        subtitle="All-time breakdown"
        pieData={stats.pieData}
        transactions={transactions}
        totalForPct={stats.totalExpenses}
      />

      {/* Cumulative net chart */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
        <div className="mb-4">
          <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Cumulative Net</h3>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.chartData}>
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtCompact} />
              <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8 }} formatter={(v) => fmt(v)} />
              <Area type="monotone" dataKey="cumulative" stroke="#8b5cf6" strokeWidth={2} fill="url(#cumGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ---------- HISTORY ----------
function History({ entries, onDeleteTransaction, categories }) {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const [expanded, setExpanded] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  if (entries.length === 0) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center">
        <FileText className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
        <p className="text-zinc-500">No transactions yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800">
        <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Ledger</h3>
        <p className="text-xs text-zinc-500">{entries.length} {entries.length === 1 ? "day" : "days"} · tap to expand</p>
      </div>
      <div className="divide-y divide-zinc-800">
        {sorted.map((day) => {
          const isOpen = expanded === day.date;
          return (
            <div key={day.date}>
              <button onClick={() => { setExpanded(isOpen ? null : day.date); setConfirmId(null); }} className="w-full text-left p-4 md:px-6 hover:bg-black/20 transition">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`} />
                    <div className="min-w-0">
                      <div className="text-white font-semibold">{day.date}</div>
                      <div className="text-xs text-zinc-500">{day.transactions.length} transaction{day.transactions.length !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-lg font-bold ${day.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`} style={{ fontFamily: "'Playfair Display', serif" }}>
                      {fmtCompact(day.profit)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      <span className="text-emerald-400">{fmtCompact(day.income)}</span>
                      <span className="mx-1">·</span>
                      <span className="text-rose-400">{fmtCompact(day.expenses)}</span>
                    </div>
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="bg-black/30 px-4 md:px-6 py-3 border-t border-zinc-800 space-y-2">
                  {day.transactions.map((tx) => {
                    const cfg = tx.kind === "expense" ? getCategoryConfig(categories, tx.category) : null;
                    const Icon = cfg ? getCategoryIcon(cfg.icon) : ArrowDownCircle;
                    const color = cfg ? cfg.color : "#10b981";
                    return (
                      <div key={tx.id} className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="flex-shrink-0" style={{ color }}><Icon className="w-4 h-4" /></div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold" style={{ color: tx.kind === "income" ? "#10b981" : "#f43f5e" }}>
                                  {tx.kind === "income" ? "+" : "-"}{fmt(tx.amount)}
                                </span>
                                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                                  {tx.kind === "income" ? "Income" : (cfg ? cfg.label : "Expense")}
                                </span>
                                {tx.source === "slip" && <span className="text-[10px] uppercase tracking-wider text-violet-400/80">Slip</span>}
                                {tx.source === "subscription" && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-400/10 text-violet-300 border border-violet-400/20">Sub</span>}
                              </div>
                              <div className="text-xs text-zinc-500 mt-0.5 truncate">
                                {tx.time && <span>{tx.time}</span>}
                                {tx.description && <span> · {tx.description}</span>}
                                {tx.partner && tx.partner !== "—" && <span> · {tx.partner}</span>}
                              </div>
                            </div>
                          </div>
                          {confirmId === tx.id ? (
                            <div className="flex gap-2 flex-shrink-0">
                              <button onClick={() => { onDeleteTransaction(tx.id); setConfirmId(null); }} className="text-rose-400 text-xs font-semibold">Confirm</button>
                              <button onClick={() => setConfirmId(null)} className="text-zinc-500 text-xs">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmId(tx.id)} className="text-zinc-500 hover:text-rose-400 flex-shrink-0">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
function Monthly({ entries, transactions, categories }) {
  const months = useMemo(() => {
    const map = {};
    entries.forEach(e => {
      const ym = e.date.slice(0, 7);
      if (!map[ym]) map[ym] = { ym, days: [], income: 0, expenses: 0, profit: 0 };
      map[ym].days.push(e);
      map[ym].income += e.income;
      map[ym].expenses += e.expenses;
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
        <p className="text-zinc-500">No data yet.</p>
      </div>
    );
  }

  const selectedMonth = months.find(m => m.ym === selectedYm) || months[0];
  const selectedIdx = months.findIndex(m => m.ym === selectedMonth.ym);
  const prevMonth = selectedIdx < months.length - 1 ? months[selectedIdx + 1] : null;
  const monthLabel = (ym) => {
    const [y, m] = ym.split("-");
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  // Category breakdown for selected month
  const monthTxs = transactions.filter(t => t.date.startsWith(selectedMonth.ym));
  const catTotals = {};
  monthTxs.forEach(t => {
    if (t.kind === "expense") catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
  });
  const monthPie = categories
    .map(c => ({ name: c.label, value: catTotals[c.id] || 0, color: c.color, key: c.id }))
    .filter(d => d.value > 0);

  const dailyData = [...selectedMonth.days].sort((a, b) => a.date.localeCompare(b.date)).map(e => ({ date: e.date.slice(8), profit: e.profit }));

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => prevMonth && setSelectedYm(prevMonth.ym)} disabled={!prevMonth} className="w-10 h-10 rounded-lg bg-black/40 border border-zinc-800 flex items-center justify-center text-zinc-400 disabled:opacity-30">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center">
            <div className="text-xs text-zinc-500 uppercase tracking-[0.25em] mb-1">Viewing</div>
            <select value={selectedMonth.ym} onChange={(e) => setSelectedYm(e.target.value)} className="bg-transparent text-white text-xl md:text-2xl font-bold text-center outline-none cursor-pointer" style={{ fontFamily: "'Playfair Display', serif" }}>
              {months.map(m => <option key={m.ym} value={m.ym} className="bg-zinc-900">{monthLabel(m.ym)}</option>)}
            </select>
          </div>
          <button onClick={() => selectedIdx > 0 && setSelectedYm(months[selectedIdx - 1].ym)} disabled={selectedIdx === 0} className="w-10 h-10 rounded-lg bg-black/40 border border-zinc-800 flex items-center justify-center text-zinc-400 disabled:opacity-30">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Net" value={fmtCompact(selectedMonth.profit)} sub={`${selectedMonth.days.length} days`} accent={selectedMonth.profit >= 0 ? "#10b981" : "#f43f5e"} icon={<Wallet className="w-4 h-4" />} />
        <KpiCard label="Income" value={fmtCompact(selectedMonth.income)} sub="" accent="#8b5cf6" icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard label="Expenses" value={fmtCompact(selectedMonth.expenses)} sub="" accent="#f43f5e" icon={<TrendingDown className="w-4 h-4" />} />
      </div>

      <CategoryPieWithDrill
        title={`Categories — ${monthLabel(selectedMonth.ym)}`}
        subtitle={null}
        pieData={monthPie}
        transactions={monthTxs}
        totalForPct={selectedMonth.expenses}
      />

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "'Playfair Display', serif" }}>Daily Net</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmtCompact} />
              <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #27272a", borderRadius: 8 }} formatter={(v) => fmt(v)} />
              <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                {dailyData.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? "#10b981" : "#f43f5e"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ---------- SUBSCRIPTIONS ----------
function Subscriptions({ subscriptions, onSave, onDelete, onMarkUnsubscribed, onReactivate, categories }) {
  const [editing, setEditing] = useState(null); // sub object being edited, or "new"
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState("");

  // Compute monthly burn (normalize yearly to monthly)
  const monthlyBurn = useMemo(() => {
    return subscriptions
      .filter(s => s.status === "active")
      .reduce((sum, s) => {
        if (s.cycle === "yearly") return sum + (s.amount / 12);
        return sum + s.amount;
      }, 0);
  }, [subscriptions]);

  const yearlyBurn = monthlyBurn * 12;

  // Sort active subs by next renewal, cancelled at bottom
  const sorted = useMemo(() => {
    const active = subscriptions.filter(s => s.status === "active").sort((a, b) => a.nextRenewal.localeCompare(b.nextRenewal));
    const cancelled = subscriptions.filter(s => s.status !== "active").sort((a, b) => b.nextRenewal.localeCompare(a.nextRenewal));
    return [...active, ...cancelled];
  }, [subscriptions]);

  // Upcoming this week
  const inSevenDays = new Date();
  inSevenDays.setDate(inSevenDays.getDate() + 7);
  const cutoff = inSevenDays.toISOString().slice(0, 10);
  const upcoming = sorted.filter(s => s.status === "active" && s.nextRenewal <= cutoff);

  // ---------- OCR PARSING FOR SCREENSHOTS ----------
  const parseSubscriptionScreenshot = (text) => {
    const cleanText = text.replace(/\s+/g, " ");
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    // Try to find amount
    let amount = null;
    // Pass 1: look for number near "month", "/month", "Monthly", "monthly", "yearly", "/yr"
    const amountPatterns = [
      /(?:THB|฿)\s*([\d,]+\.?\d*)/i,
      /([\d,]+\.?\d*)\s*\/?\s*(?:month|mo)\b/i,
      /([\d,]+\.?\d*)\s*Baht/i,
    ];
    for (const pat of amountPatterns) {
      const m = cleanText.match(pat);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ""));
        if (!isNaN(n) && n > 0 && n < 100000) { amount = n; break; }
      }
    }

    // Detect cycle
    let cycle = "monthly";
    if (/yearly|annual|\/yr|per year/i.test(cleanText)) cycle = "yearly";

    // Try to find next renewal date
    let nextRenewal = null;

    // Format 1: "DD/MM/YYYY" or "MM/DD/YYYY"  (e.g., 17/05/2026)
    const slashMatch = cleanText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      // Heuristic: if first part > 12, it must be DD/MM. Otherwise assume DD/MM (more common globally).
      const a = parseInt(slashMatch[1]);
      const b = parseInt(slashMatch[2]);
      const y = parseInt(slashMatch[3]);
      let d, m;
      if (a > 12) { d = a; m = b; }
      else if (b > 12) { m = a; d = b; }
      else { d = a; m = b; } // default DD/MM
      nextRenewal = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }

    // Format 2: "May 14, 2026" or "May 14 2026" or "14 May 2026"
    if (!nextRenewal) {
      const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const m1 = cleanText.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+(\d{1,2})(?:,|\s)\s*(\d{4})/i);
      if (m1) {
        const mo = months[m1[1].toLowerCase().slice(0, 3)];
        nextRenewal = `${m1[3]}-${String(mo).padStart(2, "0")}-${String(parseInt(m1[2])).padStart(2, "0")}`;
      }
      if (!nextRenewal) {
        const m2 = cleanText.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+(\d{4})/i);
        if (m2) {
          const mo = months[m2[2].toLowerCase().slice(0, 3)];
          nextRenewal = `${m2[3]}-${String(mo).padStart(2, "0")}-${String(parseInt(m2[1])).padStart(2, "0")}`;
        }
      }
    }

    // Try to guess service name from common keywords
    let name = "";
    const nameKeywords = ["Spotify", "Netflix", "Claude", "YouTube", "Disney", "Apple", "iCloud", "Microsoft", "Adobe", "Dropbox", "CapCut", "Canva", "ChatGPT", "Gemini"];
    for (const kw of nameKeywords) {
      if (new RegExp(kw, "i").test(cleanText)) { name = kw; break; }
    }

    return { amount, nextRenewal, cycle, name };
  };

  const handleScreenshot = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setScanError("");
    setScanResult(null);
    try {
      const Tesseract = (await import("tesseract.js")).default;
      const { data } = await Tesseract.recognize(file, "eng");
      const parsed = parseSubscriptionScreenshot(data.text);
      setScanResult({
        ...parsed,
        amount: parsed.amount || "",
        nextRenewal: parsed.nextRenewal || today(),
        category: categories.find(c => c.id === "entertainment")?.id || categories[0]?.id || "other",
        rawText: data.text,
      });
      setEditing("scanned");
    } catch (err) {
      setScanError("Could not read screenshot: " + err.message);
    }
    setScanning(false);
  };

  if (editing === "new" || editing === "scanned") {
    return (
      <SubForm
        initial={editing === "scanned" ? scanResult : null}
        categories={categories}
        onSave={async (sub) => { await onSave(sub); setEditing(null); setScanResult(null); }}
        onCancel={() => { setEditing(null); setScanResult(null); }}
      />
    );
  }

  if (editing && typeof editing === "object") {
    return (
      <SubForm
        initial={editing}
        existingId={editing.id}
        categories={categories}
        onSave={async (sub) => { await onSave({ ...sub, id: editing.id }); setEditing(null); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Burn summary */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Subscription Burn</h3>
            <p className="text-xs text-zinc-500">{subscriptions.filter(s => s.status === "active").length} active subscription{subscriptions.filter(s => s.status === "active").length !== 1 ? "s" : ""}</p>
          </div>
          <Repeat className="w-5 h-5 text-violet-400" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider">Monthly</div>
            <div className="text-2xl font-bold text-violet-400" style={{ fontFamily: "'Playfair Display', serif" }}>{fmt(monthlyBurn)}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider">Yearly</div>
            <div className="text-2xl font-bold text-zinc-300" style={{ fontFamily: "'Playfair Display', serif" }}>{fmt(yearlyBurn)}</div>
          </div>
        </div>
      </div>

      {/* Add buttons */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-xl border-2 border-violet-400/30 bg-violet-400/5 hover:bg-violet-400/10 cursor-pointer transition">
          <ImageIcon className="w-6 h-6 text-violet-400" />
          <span className="text-sm font-semibold text-violet-300">{scanning ? "Reading…" : "From Screenshot"}</span>
          <span className="text-xs text-zinc-500 text-center">Upload subscription screen</span>
          <input type="file" accept="image/*" onChange={handleScreenshot} disabled={scanning} className="hidden" />
        </label>
        <button
          onClick={() => setEditing("new")}
          className="flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-xl border-2 border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800 transition"
        >
          <Plus className="w-6 h-6 text-zinc-300" />
          <span className="text-sm font-semibold text-zinc-200">Add Manually</span>
          <span className="text-xs text-zinc-500 text-center">Type details</span>
        </button>
      </div>

      {scanError && <div className="p-3 rounded-lg bg-rose-400/10 border border-rose-400/20 text-rose-300 text-sm">{scanError}</div>}

      {/* Upcoming this week */}
      {upcoming.length > 0 && (
        <div className="bg-amber-400/5 border border-amber-400/20 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-300">Renewing within 7 days</span>
          </div>
          <div className="space-y-2">
            {upcoming.map(s => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-white">{s.name}</span>
                <span className="text-amber-300">{fmt(s.amount)} on {s.nextRenewal}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* List */}
      {subscriptions.length === 0 ? (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center">
          <Repeat className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
          <p className="text-zinc-500">No subscriptions yet. Add one above.</p>
        </div>
      ) : (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-300">All subscriptions</h3>
          </div>
          <div className="divide-y divide-zinc-800">
            {sorted.map(s => {
              const cfg = getCategoryConfig(categories, s.category);
              const Icon = getCategoryIcon(cfg.icon);
              const isActive = s.status === "active";
              const monthlyEquiv = s.cycle === "yearly" ? s.amount / 12 : s.amount;
              return (
                <div key={s.id} className={`p-4 ${!isActive ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: cfg.color + "20", color: cfg.color }}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-semibold">{s.name}</span>
                          {!isActive && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Cancelled</span>}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {fmt(s.amount)} / {s.cycle === "yearly" ? "year" : "month"}
                          {s.cycle === "yearly" && <span className="ml-1">({fmt(monthlyEquiv)}/mo)</span>}
                        </div>
                        <div className="text-xs mt-1">
                          {isActive ? (
                            <span className="text-zinc-400">Next: <span className="text-violet-300">{s.nextRenewal}</span></span>
                          ) : (
                            <span className="text-zinc-500">Last renewed: {s.nextRenewal}</span>
                          )}
                        </div>
                        {s.notes && <div className="text-xs text-zinc-500 mt-1 italic">{s.notes}</div>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button onClick={() => setEditing(s)} className="text-zinc-500 hover:text-violet-400 p-1">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {isActive ? (
                        <button onClick={() => onMarkUnsubscribed(s.id)} className="text-zinc-500 hover:text-amber-400 p-1" title="Mark unsubscribed">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => onReactivate(s.id)} className="text-zinc-500 hover:text-emerald-400 p-1" title="Reactivate">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => onDelete(s.id)} className="text-zinc-500 hover:text-rose-400 p-1" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-600 leading-relaxed">
        Active subscriptions auto-create an expense in the ledger on each renewal date.
        Don't upload bank slips for these — they'd be double-counted.
      </p>
    </div>
  );
}

// ---------- SUBSCRIPTION FORM ----------
function SubForm({ initial, onSave, onCancel, existingId, categories }) {
  const [name, setName] = useState(initial?.name || "");
  const [amount, setAmount] = useState(initial?.amount || "");
  const [cycle, setCycle] = useState(initial?.cycle || "monthly");
  const [category, setCategory] = useState(
    initial?.category ||
    categories.find(c => c.id === "entertainment")?.id ||
    categories[0]?.id ||
    "other"
  );
  const [nextRenewal, setNextRenewal] = useState(initial?.nextRenewal || today());
  const [notes, setNotes] = useState(initial?.notes || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !amount || parseFloat(amount) <= 0 || saving) return;
    setSaving(true);
    const sub = {
      id: existingId || `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      amount: parseFloat(amount),
      cycle,
      category,
      nextRenewal,
      notes: notes.trim(),
      status: initial?.status || "active",
      createdAt: initial?.createdAt || new Date().toISOString(),
    };
    try {
      await onSave(sub);
    } catch (e) {
      alert("Save failed: " + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-400/10 border border-violet-400/20 flex items-center justify-center">
            <Repeat className="w-5 h-5 text-violet-400" />
          </div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
            {existingId ? "Edit Subscription" : "New Subscription"}
          </h2>
        </div>
        <button onClick={onCancel} className="text-zinc-500 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Service Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Netflix, Spotify, Claude…"
            className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-violet-400/60"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Amount ({CURRENCY_CODE})</label>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white text-lg outline-none focus:border-violet-400/60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Cycle</label>
            <div className="grid grid-cols-2 gap-1 bg-black/40 border border-zinc-800 rounded-lg p-1">
              <button onClick={() => setCycle("monthly")} className={`py-2 rounded text-sm font-medium ${cycle === "monthly" ? "bg-violet-400/20 text-violet-300" : "text-zinc-500"}`}>Monthly</button>
              <button onClick={() => setCycle("yearly")} className={`py-2 rounded text-sm font-medium ${cycle === "yearly" ? "bg-violet-400/20 text-violet-300" : "text-zinc-500"}`}>Yearly</button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Category</label>
          <div className="grid grid-cols-3 gap-2">
            {categories.map(cat => {
              const Icon = getCategoryIcon(cat.icon);
              const sel = category === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg border-2 text-xs font-medium transition ${sel ? "" : "border-zinc-800 text-zinc-500"}`}
                  style={sel ? { borderColor: cat.color, background: cat.color + "1a", color: cat.color } : {}}
                >
                  <Icon className="w-4 h-4" />
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Next Renewal Date</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <input
              type="date" lang="en-US"
              value={nextRenewal}
              onChange={(e) => setNextRenewal(e.target.value)}
              className="w-full bg-black/40 border border-zinc-800 rounded-lg pl-10 pr-4 py-3 text-white outline-none focus:border-violet-400/60"
            />
          </div>
          <p className="text-xs text-zinc-500 mt-1.5">{formatDateLabel(nextRenewal)}</p>
          <p className="text-xs text-zinc-500 mt-1">An expense will auto-create on this date, then advance to next cycle.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Plan tier, family share, etc."
            className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-violet-400/60"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !amount || parseFloat(amount) <= 0}
          className="w-full py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 disabled:opacity-40"
          style={{ background: saving ? "#8b5cf6" : "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </span>
          ) : existingId ? "Save Changes" : "Add Subscription"}
        </button>
      </div>
    </div>
  );
}

// ---------- CATEGORY MANAGER ----------
function CategoryManager({ categories, onSave, onDelete, onReorder, transactions, subscriptions }) {
  const [editing, setEditing] = useState(null); // category being edited, "new", or null
  const [confirmDelete, setConfirmDelete] = useState(null);

  const handleSave = async (cat) => {
    await onSave(cat);
    setEditing(null);
  };

  const handleDelete = async (cat) => {
    // Count usage
    const txCount = transactions.filter(t => t.category === cat.id).length;
    const subCount = subscriptions.filter(s => s.category === cat.id).length;
    const total = txCount + subCount;
    if (total > 0) {
      const ok = confirm(
        `"${cat.label}" is used by ${txCount} transaction${txCount !== 1 ? "s" : ""}` +
        (subCount > 0 ? ` and ${subCount} subscription${subCount !== 1 ? "s" : ""}` : "") +
        `.\n\nDeleting will reassign them to "Other". Continue?`
      );
      if (!ok) return;
    } else {
      if (!confirm(`Delete "${cat.label}"?`)) return;
    }
    await onDelete(cat.id);
    setConfirmDelete(null);
  };

  if (editing) {
    return (
      <CategoryEditForm
        initial={editing === "new" ? null : editing}
        existing={categories}
        onSave={handleSave}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const move = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= categories.length) return;
    onReorder(idx, target);
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Categories</h3>
          <p className="text-xs text-zinc-500">Add, edit, reorder, or remove expense categories.</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-black"
          style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      <div className="space-y-2">
        {categories.map((cat, idx) => {
          const Icon = getCategoryIcon(cat.icon);
          const txCount = transactions.filter(t => t.category === cat.id).length;
          return (
            <div key={cat.id} className="flex items-center gap-2 p-3 rounded-lg bg-black/40 border border-zinc-800">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: cat.color + "20", color: cat.color }}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-medium text-sm">{cat.label}</div>
                <div className="text-xs text-zinc-500">{txCount} transaction{txCount !== 1 ? "s" : ""}</div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="p-1.5 text-zinc-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button onClick={() => move(idx, 1)} disabled={idx === categories.length - 1} className="p-1.5 text-zinc-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button onClick={() => setEditing(cat)} className="p-1.5 text-zinc-500 hover:text-violet-400">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {cat.id !== "other" && (
                  <button onClick={() => handleDelete(cat)} className="p-1.5 text-zinc-500 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-600 mt-4 leading-relaxed">
        Note: "Other" can't be deleted — it's the fallback when categories are removed.
      </p>
    </div>
  );
}

function CategoryEditForm({ initial, existing, onSave, onCancel }) {
  const [label, setLabel] = useState(initial?.label || "");
  const [icon, setIcon] = useState(initial?.icon || "more");
  const [color, setColor] = useState(initial?.color || COLOR_OPTIONS[0]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const handleSubmit = async () => {
    setErr("");
    const trimmed = label.trim();
    if (!trimmed) { setErr("Name is required"); return; }
    if (trimmed.length > 30) { setErr("Name too long (max 30 characters)"); return; }
    // Check duplicate label (case-insensitive), excluding self
    const dup = existing.find(c => c.label.toLowerCase() === trimmed.toLowerCase() && c.id !== initial?.id);
    if (dup) { setErr("A category with that name already exists"); return; }

    setSaving(true);
    const cat = {
      id: initial?.id || `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: trimmed,
      icon,
      color,
      order: initial?.order ?? existing.length,
      isDefault: initial?.isDefault || false,
      createdAt: initial?.createdAt || new Date().toISOString(),
    };
    try {
      await onSave(cat);
    } catch (e) {
      setErr("Save failed: " + e.message);
    }
    setSaving(false);
  };

  const PreviewIcon = getCategoryIcon(icon);

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: color + "20", color }}>
            <PreviewIcon className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
            {initial ? "Edit Category" : "New Category"}
          </h2>
        </div>
        <button onClick={onCancel} className="text-zinc-500 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Name</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Rent, Healthcare, etc."
            maxLength={30}
            className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-violet-400/60"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Icon</label>
          <div className="grid grid-cols-6 gap-2 max-h-64 overflow-y-auto p-1">
            {Object.entries(ICON_OPTIONS).map(([key, opt]) => {
              const Cmp = opt.Cmp;
              const sel = icon === key;
              return (
                <button
                  key={key}
                  onClick={() => setIcon(key)}
                  title={opt.label}
                  className={`aspect-square flex items-center justify-center rounded-lg border-2 transition ${sel ? "" : "border-zinc-800 text-zinc-500 hover:text-white"}`}
                  style={sel ? { borderColor: color, background: color + "1a", color } : {}}
                >
                  <Cmp className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2 tracking-wide uppercase">Color</label>
          <div className="grid grid-cols-6 gap-2">
            {COLOR_OPTIONS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`aspect-square rounded-lg border-2 transition ${color === c ? "border-white" : "border-transparent"}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        {err && <p className="text-rose-400 text-sm">{err}</p>}

        <button
          onClick={handleSubmit}
          disabled={saving || !label.trim()}
          className="w-full py-4 rounded-xl font-semibold text-black transition-all hover:opacity-90 disabled:opacity-40"
          style={{ background: saving ? "#8b5cf6" : "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </span>
          ) : initial ? "Save Changes" : "Add Category"}
        </button>
      </div>
    </div>
  );
}

// ---------- SETTINGS ----------
function Settings({ entries, categories, transactions, subscriptions, onSaveCategory, onDeleteCategory, onReorderCategories }) {
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
      if (next.length < 4) { setErr("Must be at least 4 characters"); setWorking(false); return; }
      if (next !== confirm) { setErr("New passcodes don't match"); setWorking(false); return; }
      await setDoc(CONFIG_DOC, { passcode: next });
      setMsg("Updated for both of you");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      setErr("Update failed: " + e.message);
    }
    setWorking(false);
  };

  const exportCSV = () => {
    const headers = ["Date", "Income (THB)", "Expenses (THB)", "Net (THB)"];
    const rows = [...entries].sort((a, b) => a.date.localeCompare(b.date)).map(e => [e.date, e.income, e.expenses, e.profit]);
    const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `household-${today()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8 max-w-xl">
        <h3 className="text-xl font-bold text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Change Passcode</h3>
        <p className="text-xs text-zinc-500 mb-6">Shared between you and your wife.</p>
        <div className="space-y-4">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current passcode" className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-violet-400/60" />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New passcode" className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-violet-400/60" />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new passcode" className="w-full bg-black/40 border border-zinc-800 rounded-lg px-4 py-3 text-white outline-none focus:border-violet-400/60" />
          {err && <p className="text-rose-400 text-sm">{err}</p>}
          {msg && <p className="text-emerald-400 text-sm">{msg}</p>}
          <button onClick={handleChange} disabled={working} className="w-full py-3 rounded-lg font-semibold text-black hover:opacity-90 disabled:opacity-50" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}>
            {working ? "Updating…" : "Update Passcode"}
          </button>
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 md:p-8 max-w-xl">
        <h3 className="text-xl font-bold text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Export</h3>
        <p className="text-xs text-zinc-500 mb-6">Download daily totals as CSV.</p>
        <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      <div className="max-w-xl">
        <CategoryManager
          categories={categories}
          transactions={transactions}
          subscriptions={subscriptions}
          onSave={onSaveCategory}
          onDelete={onDeleteCategory}
          onReorder={onReorderCategories}
        />
      </div>
    </div>
  );
}

// ---------- MAIN APP ----------
export default function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("household:unlocked") === "1");
  const [transactions, setTransactions] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoriesSeeded, setCategoriesSeeded] = useState(false);
  const [tab, setTab] = useState("entry");
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [autoCreateRan, setAutoCreateRan] = useState(false);

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
    let txReady = false, subsReady = false, catsReady = false;
    const checkDone = () => { if (txReady && subsReady && catsReady) setLoading(false); };

    const unsub1 = onSnapshot(TX_COL,
      (snap) => {
        const list = [];
        snap.forEach(d => list.push(d.data()));
        setTransactions(list);
        txReady = true; checkDone();
      },
      (err) => { console.error(err); txReady = true; checkDone(); }
    );
    const unsub2 = onSnapshot(SUBS_COL,
      (snap) => {
        const list = [];
        snap.forEach(d => list.push(d.data()));
        setSubscriptions(list);
        subsReady = true; checkDone();
      },
      (err) => { console.error(err); subsReady = true; checkDone(); }
    );
    const unsub3 = onSnapshot(CAT_COL,
      (snap) => {
        const list = [];
        snap.forEach(d => list.push(d.data()));
        // Sort by order
        list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        setCategories(list);
        catsReady = true; checkDone();
      },
      (err) => { console.error(err); catsReady = true; checkDone(); }
    );
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [unlocked]);

  // Seed default categories on first run if none exist yet
  useEffect(() => {
    if (!unlocked || loading || categoriesSeeded) return;
    if (categories.length > 0) { setCategoriesSeeded(true); return; }
    const seed = async () => {
      try {
        for (const cat of DEFAULT_CATEGORIES) {
          await setDoc(doc(db, "categories", cat.id), cat);
        }
        setCategoriesSeeded(true);
      } catch (e) {
        console.error("Seed failed:", e);
      }
    };
    seed();
  }, [unlocked, loading, categories, categoriesSeeded]);

  const saveTransaction = async (tx) => {
    await setDoc(doc(db, "transactions", tx.id), tx);
  };
  const deleteTransaction = async (id) => {
    await deleteDoc(doc(db, "transactions", id));
  };
  const saveSubscription = async (sub) => {
    await setDoc(doc(db, "subscriptions", sub.id), sub);
  };
  const deleteSubscription = async (id) => {
    if (!confirm("Delete this subscription? Past auto-created expenses will stay in History.")) return;
    await deleteDoc(doc(db, "subscriptions", id));
  };
  const markUnsubscribed = async (id) => {
    const sub = subscriptions.find(s => s.id === id);
    if (!sub) return;
    await setDoc(doc(db, "subscriptions", id), { ...sub, status: "cancelled" });
  };
  const reactivateSubscription = async (id) => {
    const sub = subscriptions.find(s => s.id === id);
    if (!sub) return;
    // If the next renewal is in the past, advance it forward to the next future date
    let nextRenewal = sub.nextRenewal;
    while (nextRenewal < today()) {
      nextRenewal = advanceDate(nextRenewal, sub.cycle);
    }
    await setDoc(doc(db, "subscriptions", id), { ...sub, status: "active", nextRenewal });
  };

  // ---------- CATEGORY HANDLERS ----------
  const saveCategory = async (cat) => {
    await setDoc(doc(db, "categories", cat.id), cat);
  };

  const deleteCategory = async (id) => {
    if (id === "other") return; // safety: never delete "other"
    // Reassign any transactions/subs using this category to "other"
    const affectedTxs = transactions.filter(t => t.category === id);
    const affectedSubs = subscriptions.filter(s => s.category === id);
    for (const t of affectedTxs) {
      await setDoc(doc(db, "transactions", t.id), { ...t, category: "other" });
    }
    for (const s of affectedSubs) {
      await setDoc(doc(db, "subscriptions", s.id), { ...s, category: "other" });
    }
    await deleteDoc(doc(db, "categories", id));
  };

  const reorderCategories = async (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    const list = [...categories];
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    // Reassign order values to all
    for (let i = 0; i < list.length; i++) {
      const cat = list[i];
      if (cat.order !== i) {
        await setDoc(doc(db, "categories", cat.id), { ...cat, order: i });
      }
    }
  };

  // ---------- AUTO-CREATE EXPENSES FROM DUE SUBSCRIPTIONS ----------
  useEffect(() => {
    if (!unlocked || loading || autoCreateRan) return;
    if (subscriptions.length === 0) { setAutoCreateRan(true); return; }

    const run = async () => {
      const todayStr = today();
      for (const sub of subscriptions) {
        if (sub.status !== "active") continue;
        let cursor = sub.nextRenewal;
        let updatedSub = { ...sub };
        let createdAny = false;

        // Catch up on any missed renewals (handles app being closed for days)
        while (cursor <= todayStr) {
          const txId = `sub_${sub.id}_${cursor}`;
          const tx = {
            id: txId,
            date: cursor,
            time: "00:00",
            amount: sub.amount,
            kind: "expense",
            category: sub.category,
            description: `${sub.name} ${sub.cycle === "yearly" ? "yearly" : "monthly"}`,
            partner: "auto",
            source: "subscription",
            subscriptionId: sub.id,
            timestamp: new Date().toISOString(),
          };
          // Deterministic ID — setDoc will overwrite if it already exists, which is fine
          try {
            await setDoc(doc(db, "transactions", txId), tx);
            createdAny = true;
          } catch (e) {
            console.error("Auto-create failed for", sub.name, cursor, e);
            break;
          }
          cursor = advanceDate(cursor, sub.cycle);
          updatedSub.nextRenewal = cursor;
        }

        if (createdAny) {
          try {
            await setDoc(doc(db, "subscriptions", sub.id), updatedSub);
          } catch (e) {
            console.error("Failed to advance renewal for", sub.name, e);
          }
        }
      }
      setAutoCreateRan(true);
    };

    run();
  }, [unlocked, loading, subscriptions, autoCreateRan]);

  const handleLock = () => {
    sessionStorage.removeItem("household:unlocked");
    setUnlocked(false);
  };

  if (!unlocked) return <PasscodeScreen onUnlock={() => setUnlocked(true)} />;

  const dayMap = buildDayMap(transactions);
  const entries = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="min-h-screen text-white" style={{ background: "radial-gradient(ellipse at top, #2a1f3e 0%, #0a0d14 60%)" }}>
      <header className="border-b border-zinc-800/60 backdrop-blur-xl sticky top-0 z-40 bg-black/40">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" }}>
              <Home className="w-5 h-5 text-black" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-lg font-bold leading-none" style={{ fontFamily: "'Playfair Display', serif" }}>Household</div>
              <div className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase">Personal Ledger</div>
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
            { id: "entry", label: "Entry", icon: <Plus className="w-4 h-4" /> },
            { id: "upload", label: "Slips", icon: <Upload className="w-4 h-4" /> },
            { id: "subs", label: "Subs", icon: <Repeat className="w-4 h-4" /> },
            { id: "dashboard", label: "Dashboard", icon: <BarChart3 className="w-4 h-4" /> },
            { id: "monthly", label: "Monthly", icon: <CalendarDays className="w-4 h-4" /> },
            { id: "history", label: "History", icon: <FileText className="w-4 h-4" /> },
            { id: "settings", label: "Settings", icon: <Lock className="w-4 h-4" /> },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                tab === t.id ? "border-violet-400 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
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
          <div className="text-center py-20 text-zinc-500">Connecting…</div>
        ) : (
          <>
            {tab === "entry" && <EntryForm onSave={saveTransaction} dayMap={dayMap} categories={categories} />}
            {tab === "upload" && <SlipUpload onSave={saveTransaction} categories={categories} />}
            {tab === "subs" && <Subscriptions
              subscriptions={subscriptions}
              categories={categories}
              onSave={saveSubscription}
              onDelete={deleteSubscription}
              onMarkUnsubscribed={markUnsubscribed}
              onReactivate={reactivateSubscription}
            />}
            {tab === "dashboard" && <Dashboard entries={entries} transactions={transactions} subscriptions={subscriptions} categories={categories} />}
            {tab === "monthly" && <Monthly entries={entries} transactions={transactions} categories={categories} />}
            {tab === "history" && <History entries={entries} onDeleteTransaction={deleteTransaction} categories={categories} />}
            {tab === "settings" && <Settings
              entries={entries}
              categories={categories}
              transactions={transactions}
              subscriptions={subscriptions}
              onSaveCategory={saveCategory}
              onDeleteCategory={deleteCategory}
              onReorderCategories={reorderCategories}
            />}
          </>
        )}
        <footer className="mt-12 text-center text-xs text-zinc-600">
          Household · Real-time sync · THB
        </footer>
      </main>
    </div>
  );
}
