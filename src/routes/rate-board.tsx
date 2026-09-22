import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import {
  Maximize2,
  Minimize2,
  RefreshCw,
  Clock,
  Building2,
  Tv,
  PhoneCall,
  ArrowLeft,
  LogIn,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCurrencyInfo } from "@/lib/currency-flags";
import { useAppSettings } from "@/hooks/use-app-settings";
import { useCurrentUser } from "@/hooks/use-current-user";

export const Route = createFileRoute("/rate-board")({
  component: RateBoardPage,
  head: () => ({
    meta: [
      { title: "Papan Kurs (TV Display) - Valuta Guardian" },
      {
        name: "description",
        content: "Tampilan layar penuh 16:9 papan kurs valuta asing real-time.",
      },
    ],
  }),
});

interface CurrencyItem {
  id: string;
  code: string;
  name: string;
  country: string | null;
  symbol: string | null;
  decimals: number;
}

interface RateItem {
  id: string;
  currency_id: string;
  branch_id: string | null;
  buy_rate: number;
  sell_rate: number;
  effective_date: string;
  is_active: boolean;
  currencies?: { code: string; name: string } | null;
  branches?: { code: string; name: string } | null;
}

interface BranchItem {
  id: string;
  code: string;
  name: string;
}

const ALL_HQ = "__all_hq__";

// Ordered priority for rate board display:
// 1. USD, 2. AUD, 3. EURO (EUR), 4. YEN (JPY), 5. GBP, 6. SGD, 7. NZD, 8. CAD, 9. CHF, 10. HKD
const CURRENCY_ORDER: Record<string, number> = {
  USD: 1,
  AUD: 2,
  EUR: 3,
  EURO: 3,
  JPY: 4,
  YEN: 4,
  GBP: 5,
  SGD: 6,
  NZD: 7,
  CAD: 8,
  CHF: 9,
  HKD: 10,
};

function getCompanyInitials(name?: string): string {
  if (!name || !name.trim()) return "MC";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const filtered =
    words.length > 2 &&
    (words[0].toUpperCase() === "PT" || words[0].toUpperCase() === "CV")
      ? words.slice(1)
      : words;
  return (
    filtered[0][0] + (filtered[1] ? filtered[1][0] : "")
  ).toUpperCase();
}

export function RateBoardPage() {
  const { settings } = useAppSettings();
  const { user, profile, roles } = useCurrentUser();
  const isBranchLocked = !roles.includes("super_admin") && !roles.includes("owner") && Boolean(profile?.branch_id);

  const [currencies, setCurrencies] = useState<CurrencyItem[]>([]);
  const [rates, setRates] = useState<RateItem[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>(() => {
    return localStorage.getItem("rate_board_branch") || ALL_HQ;
  });

  // Sync to user branch when logged in as branch teller/manager
  useEffect(() => {
    if (profile?.branch_id && isBranchLocked) {
      setSelectedBranch(profile.branch_id);
    }
  }, [profile?.branch_id, isBranchLocked]);

  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [searchFilter, setSearchFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen for fullscreen change events
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Load currencies, branches, and active rates
  async function loadData() {
    try {
      const [{ data: curData }, { data: branchData }, { data: rateData }] =
        await Promise.all([
          supabase
            .from("currencies")
            .select("id, code, name, country, symbol, decimals")
            .eq("is_active", true)
            .order("code"),
          supabase
            .from("branches")
            .select("id, code, name")
            .eq("is_active", true)
            .order("code", { ascending: true }),
          supabase
            .from("exchange_rates")
            .select("*, currencies(code, name), branches(code, name)")
            .eq("is_active", true)
            .order("effective_date", { ascending: false }),
        ]);

      if (curData) setCurrencies(curData as CurrencyItem[]);
      if (branchData) {
        const sorted = (branchData as BranchItem[]).sort((a, b) =>
          a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
        );
        setBranches(sorted);
        // Auto default to first branch (HQ-01) if not set or if was ALL_HQ
        setSelectedBranch((prev) => {
          if (profile?.branch_id) return profile.branch_id;
          const exists = sorted.find((b) => b.id === prev);
          if (!exists && sorted.length > 0) {
            localStorage.setItem("rate_board_branch", sorted[0].id);
            return sorted[0].id;
          }
          return prev;
        });
      }
      if (rateData) setRates(rateData as RateItem[]);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Gagal memuat data papan kurs:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();

    // Supabase Real-time updates subscription
    const channel = supabase
      .channel(`rate-board-realtime-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exchange_rates" },
        () => loadData(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "currencies" },
        () => loadData(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Save selected branch in localStorage
  const handleBranchChange = (val: string) => {
    setSelectedBranch(val);
    localStorage.setItem("rate_board_branch", val);
  };

  // Toggle fullscreen mode
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current) {
          await containerRef.current.requestFullscreen();
        } else {
          await document.documentElement.requestFullscreen();
        }
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen toggle error:", err);
    }
  };

  // Build resolved rate list for each currency
  const displayRates = useMemo(() => {
    if (currencies.length === 0) return [];

    // Filter out IDR base currency if present
    const foreignCurrencies = currencies.filter(
      (c) => c.code.toUpperCase() !== "IDR",
    );

    // Sort according to user's desired sequence:
    // 1. USD, 2. AUD, 3. EURO, 4. YEN, 5. GBP, 6. SGD, 7. NZD, 8. CAD, 9. CHF, 10. HKD
    foreignCurrencies.sort((a, b) => {
      const codeA = a.code.toUpperCase();
      const codeB = b.code.toUpperCase();
      const orderA = CURRENCY_ORDER[codeA] ?? 999;
      const orderB = CURRENCY_ORDER[codeB] ?? 999;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return codeA.localeCompare(codeB);
    });

    const list = foreignCurrencies.map((cur) => {
      // Find branch specific rate or fallback to HQ/general rate
      let curRate: RateItem | undefined;

      if (selectedBranch !== ALL_HQ) {
        curRate = rates.find(
          (r) => r.currency_id === cur.id && r.branch_id === selectedBranch,
        );
      }

      // If not found or selected is HQ, find rate with null branch_id (HQ / Default)
      if (!curRate) {
        curRate = rates.find(
          (r) => r.currency_id === cur.id && r.branch_id === null,
        );
      }

      const buyRate = curRate ? Number(curRate.buy_rate) : 0;
      const sellRate = curRate ? Number(curRate.sell_rate) : 0;
      const meta = getCurrencyInfo(cur.code, cur.name);

      return {
        id: cur.id,
        code: cur.code,
        name: cur.name,
        countryName: cur.country || meta.countryName,
        currencyName: meta.currencyName,
        flagUrl: meta.flagUrl,
        emoji: meta.emoji,
        buyRate,
        sellRate,
        decimals: cur.decimals ?? 2,
        hasRate: Boolean(curRate),
      };
    });

    // Optional search filter
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      return list.filter(
        (r) =>
          r.code.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.countryName.toLowerCase().includes(q),
      );
    }

    return list;
  }, [currencies, rates, selectedBranch, searchFilter]);

  // Split items into 2 columns for 16:9 TV layout
  const midIndex = Math.ceil(displayRates.length / 2);
  const leftColumnRates = displayRates.slice(0, midIndex);
  const rightColumnRates = displayRates.slice(midIndex);

  const selectedBranchName = useMemo(() => {
    const b = branches.find((br) => br.id === selectedBranch);
    if (b) {
      return `${b.code} — ${b.name.toUpperCase()}`;
    }
    return branches[0]
      ? `${branches[0].code} — ${branches[0].name.toUpperCase()}`
      : "HQ-01 — KANTOR PUSAT";
  }, [selectedBranch, branches]);

  const formatRate = (rate: number, decimals: number) => {
    if (!rate || rate === 0) return "-";
    // For IDR exchange rates (typically >= 100), format with id-ID locale
    return new Intl.NumberFormat("id-ID", {
      minimumFractionDigits: rate % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 4,
    }).format(rate);
  };

  return (
    <div className="space-y-4 p-4 sm:p-6 max-w-[1600px] mx-auto min-h-screen">
      {/* Control Bar when not in fullscreen */}
      {!isFullscreen && (
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0" title={user ? "Ke Dashboard" : "Kembali ke Beranda"}>
              <Link to={user ? "/dashboard" : "/"}>
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Tv className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground">
                Papan Kurs Digital (TV Display)
              </h1>
              <p className="text-xs text-muted-foreground">
                Tampilan rasio 16:9 real-time untuk layar lobby / display TV kantor.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48 sm:w-56">
              <Select 
                value={isBranchLocked ? (profile?.branch_id ?? selectedBranch) : selectedBranch} 
                onValueChange={handleBranchChange}
                disabled={isBranchLocked}
              >
                <SelectTrigger className="h-9 text-xs">
                  <Building2 className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Pilih Cabang" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              className="h-9 gap-1.5 text-xs"
              title="Muat ulang kurs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Perbarui
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={toggleFullscreen}
              className="h-9 gap-1.5 bg-blue-600 text-xs font-semibold text-white shadow hover:bg-blue-700"
            >
              <Maximize2 className="h-4 w-4" />
              Layar Penuh (16:9)
            </Button>

            {!user && (
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                <Link to="/auth">
                  <LogIn className="h-3.5 w-3.5" />
                  Masuk
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 16:9 TV Rate Board Container */}
      <div
        ref={containerRef}
        className={`relative w-full overflow-hidden bg-black select-none ${
          isFullscreen
            ? "fixed inset-0 z-50 h-screen w-screen"
            : "aspect-video rounded-2xl border-4 border-slate-800 shadow-2xl min-h-[560px]"
        }`}
      >
        {/* Ambient Glow Background Effect */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#051126] via-[#091b3a] to-[#040c1d] pointer-events-none" />

        {/* Board Header */}
        <header className="relative z-10 flex h-20 items-center justify-between border-b border-blue-900/60 bg-[#020b18]/90 px-6 backdrop-blur-md">
          {/* Logo & Main Title */}
          <div className="flex items-center gap-4">
            {/* Logo Container from Database */}
            <div className="flex h-13 w-13 md:h-14 md:w-14 items-center justify-center rounded-2xl border-2 border-cyan-400/70 bg-gradient-to-tr from-[#0b2758] via-[#081e46] to-[#040f25] shadow-[0_0_15px_rgba(34,211,238,0.35)] overflow-hidden shrink-0">
              {settings.logo_url ? (
                <img
                  src={settings.logo_url}
                  alt={settings.company_name || "Logo"}
                  className="h-full w-full object-contain p-1"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <span className="text-base md:text-lg font-black tracking-wider text-cyan-300 font-mono">
                  {getCompanyInitials(settings.company_name)}
                </span>
              )}
            </div>

            {/* Money Changer Name & Badges from Database */}
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-black tracking-wider text-white drop-shadow-[0_2px_10px_rgba(255,255,255,0.3)] uppercase">
                  {settings.company_name || "EXCHANGE RATES"}
                </h1>
                <Badge className="border-cyan-400/50 bg-cyan-950/90 text-[11px] md:text-xs font-black tracking-wider text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.25)]">
                  EXCHANGE RATES
                </Badge>
                <Badge className="border-blue-400/50 bg-blue-950/90 text-[11px] md:text-xs font-bold text-blue-300">
                  KUPVA BB
                </Badge>
              </div>
              <p className="text-[11px] md:text-xs font-semibold tracking-wider text-cyan-300/90 uppercase mt-0.5">
                {selectedBranchName}
                {settings.license_pva ? ` • IZIN PVA: ${settings.license_pva}` : ""}
                {settings.company_phone ? ` • TELP: ${settings.company_phone}` : ""}
              </p>
            </div>
          </div>

          {/* Right Header: Clock & Quick Controls */}
          <div className="flex items-center gap-4">
            {/* Live Clock Display in WITA */}
            <div className="text-right">
              <div className="flex items-center justify-end gap-2 text-xl md:text-2xl font-black tracking-widest text-cyan-400 font-mono drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]">
                <Clock className="h-5 w-5 text-cyan-400 animate-pulse" />
                {new Intl.DateTimeFormat("id-ID", {
                  timeZone: "Asia/Makassar",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })
                  .format(currentTime)
                  .replace(/\./g, ":")}{" "}
                <span className="text-xs text-cyan-200">WITA</span>
              </div>
              <div className="text-[11px] font-medium text-slate-300">
                {new Intl.DateTimeFormat("id-ID", {
                  timeZone: "Asia/Makassar",
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }).format(currentTime)}
              </div>
            </div>

            {/* Quick Fullscreen Button in TV mode */}
            <button
              onClick={toggleFullscreen}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-800/80 bg-blue-950/60 text-slate-300 transition-colors hover:bg-blue-900 hover:text-white"
              title={isFullscreen ? "Keluar Layar Penuh" : "Layar Penuh (16:9)"}
            >
              {isFullscreen ? (
                <Minimize2 className="h-5 w-5" />
              ) : (
                <Maximize2 className="h-5 w-5" />
              )}
            </button>
          </div>
        </header>

        {/* Board Main Content (2-Column Split matching reference image) */}
        <main className="relative z-10 flex h-[calc(100%-8.5rem)] w-full gap-3 p-3">
          {/* Left Column Table */}
          <div className="flex-1 flex flex-col rounded-xl overflow-hidden border border-blue-900/50 bg-[#061633]/80 shadow-lg backdrop-blur-sm">
            {/* Column Header */}
            <div className="grid grid-cols-12 items-center bg-[#081f44] px-4 py-2.5 text-[11px] md:text-xs font-bold uppercase tracking-wider text-slate-300 border-b border-blue-800/60">
              <div className="col-span-1 text-center">Country</div>
              <div className="col-span-2 text-center">Code</div>
              <div className="col-span-3 pl-2">Currency</div>
              <div className="col-span-3 text-right pr-4 text-cyan-300">We buy</div>
              <div className="col-span-3 text-right pr-4 text-emerald-300">We sell</div>
            </div>

            {/* Rows List */}
            <div className="flex-1 flex flex-col justify-evenly divide-y divide-blue-950/80 overflow-hidden">
              {leftColumnRates.map((r, idx) => (
                <div
                  key={r.id}
                  className={`grid grid-cols-12 items-center px-4 py-2 transition-colors ${
                    idx % 2 === 0
                      ? "bg-[#0b2758]/90 hover:bg-[#11387d]"
                      : "bg-[#081e46]/90 hover:bg-[#103373]"
                  }`}
                >
                  {/* Flag */}
                  <div className="col-span-1 flex items-center justify-center">
                    <img
                      src={r.flagUrl}
                      alt={r.code}
                      className="h-5 w-7.5 rounded object-cover shadow-sm ring-1 ring-white/20"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                  </div>

                  {/* Code */}
                  <div className="col-span-2 text-center font-black text-base md:text-lg tracking-wider text-white">
                    {r.code}
                  </div>

                  {/* Currency Name */}
                  <div className="col-span-3 pl-2 truncate text-xs md:text-sm font-medium text-cyan-100/90">
                    {r.currencyName}
                  </div>

                  {/* We Buy */}
                  <div className="col-span-3 text-right pr-4 font-mono font-bold text-sm md:text-base tracking-tight text-cyan-300">
                    {formatRate(r.buyRate, r.decimals)}
                  </div>

                  {/* We Sell */}
                  <div className="col-span-3 text-right pr-4 font-mono font-bold text-sm md:text-base tracking-tight text-emerald-400">
                    -
                  </div>
                </div>
              ))}
              {leftColumnRates.length === 0 && (
                <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                  {loading ? (
                    <span className="text-cyan-400 animate-pulse">Memuat data kurs…</span>
                  ) : (
                    "Tidak ada data kurs"
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column Table */}
          <div className="flex-1 flex flex-col rounded-xl overflow-hidden border border-blue-900/50 bg-[#061633]/80 shadow-lg backdrop-blur-sm">
            {/* Column Header */}
            <div className="grid grid-cols-12 items-center bg-[#081f44] px-4 py-2.5 text-[11px] md:text-xs font-bold uppercase tracking-wider text-slate-300 border-b border-blue-800/60">
              <div className="col-span-1 text-center">Country</div>
              <div className="col-span-2 text-center">Code</div>
              <div className="col-span-3 pl-2">Currency</div>
              <div className="col-span-3 text-right pr-4 text-cyan-300">We buy</div>
              <div className="col-span-3 text-right pr-4 text-emerald-300">We sell</div>
            </div>

            {/* Rows List */}
            <div className="flex-1 flex flex-col justify-evenly divide-y divide-blue-950/80 overflow-hidden">
              {rightColumnRates.map((r, idx) => (
                <div
                  key={r.id}
                  className={`grid grid-cols-12 items-center px-4 py-2 transition-colors ${
                    idx % 2 === 0
                      ? "bg-[#0b2758]/90 hover:bg-[#11387d]"
                      : "bg-[#081e46]/90 hover:bg-[#103373]"
                  }`}
                >
                  {/* Flag */}
                  <div className="col-span-1 flex items-center justify-center">
                    <img
                      src={r.flagUrl}
                      alt={r.code}
                      className="h-5 w-7.5 rounded object-cover shadow-sm ring-1 ring-white/20"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                  </div>

                  {/* Code */}
                  <div className="col-span-2 text-center font-black text-base md:text-lg tracking-wider text-white">
                    {r.code}
                  </div>

                  {/* Currency Name */}
                  <div className="col-span-3 pl-2 truncate text-xs md:text-sm font-medium text-cyan-100/90">
                    {r.currencyName}
                  </div>

                  {/* We Buy */}
                  <div className="col-span-3 text-right pr-4 font-mono font-bold text-sm md:text-base tracking-tight text-cyan-300">
                    {formatRate(r.buyRate, r.decimals)}
                  </div>

                  {/* We Sell */}
                  <div className="col-span-3 text-right pr-4 font-mono font-bold text-sm md:text-base tracking-tight text-emerald-400">
                    -
                  </div>
                </div>
              ))}
              {rightColumnRates.length === 0 && (
                <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                  {loading ? (
                    <span className="text-cyan-400 animate-pulse">Memuat data kurs…</span>
                  ) : (
                    "Tidak ada data kurs"
                  )}
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Board Footer with Running Marquee & Hotline */}
        <footer className="relative z-10 flex h-14 items-center justify-between border-t border-blue-900/60 bg-[#020b18]/95 px-6">
          {/* Customer Support Phone from Database */}
          <div className="flex items-center gap-2 text-xs md:text-sm font-bold text-cyan-400 shrink-0">
            <PhoneCall className="h-4 w-4 text-cyan-400" />
            <span>
              {settings.company_phone
                ? `☎ ${settings.company_phone} / WhatsApp CS`
                : "☎ CS / WhatsApp Tersedia"}
            </span>
          </div>

          {/* Marquee Ticker */}
          <div className="mx-6 flex-1 overflow-hidden flex items-center h-full relative">
            <style>
              {`
                @keyframes force-marquee {
                  0% { transform: translateX(100vw); }
                  100% { transform: translateX(-100%); }
                }
                .marquee-text-force {
                  display: inline-block;
                  white-space: nowrap;
                  animation: force-marquee 45s linear infinite;
                }
              `}
            </style>
            <div className="marquee-text-force text-xs md:text-sm font-semibold tracking-wide text-slate-300">
              ★ {settings.company_name ? `${settings.company_name.toUpperCase()} • ` : ""}KURS DAPAT BERUBAH SEWAKTU-WAKTU MENGIKUTI PERGERAKAN PASAR VALAS INTERNASIONAL • TRANSAKSI AMAN, RESMI BERIZIN BANK INDONESIA • TERIMA PENUKARAN MATA UANG UTAMA DUNIA ★
            </div>
          </div>

          {/* Live Sync Status */}
          <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-400 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span>LIVE SYNC</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
