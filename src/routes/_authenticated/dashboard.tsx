import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowUpRight,
  Wallet,
  TrendingUp,
  AlertTriangle,
  ClipboardList,
  RefreshCw,
  Users,
  Activity,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  format,
  subDays,
  startOfDay,
  endOfDay,
  startOfMonth,
  subMonths,
  eachDayOfInterval,
  eachMonthOfInterval,
  isSameDay,
  isSameMonth,
} from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Dashboard Analytics - KUPVA BB" },
      {
        name: "description",
        content:
          "Analitik operasional money changer: volume, profit, kurs, kas, dan indikator kepatuhan.",
      },
    ],
  }),
});

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const nfmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { 
    minimumFractionDigits: 0,
    maximumFractionDigits: 0 
  }).format(n);

const compactIdr = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}jt`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return `${n}`;
};

const pieColors = [
  "#2563eb", // Blue
  "#dc2626", // Red
  "#16a34a", // Green
  "#d97706", // Orange
  "#7c3aed", // Purple
  "#0891b2", // Cyan
  "#db2777", // Pink
  "#ea580c", // Dark Orange
  "#65a30d", // Lime
  "#4f46e5", // Indigo
  "#0d9488", // Teal
  "#9333ea", // Purple
  "#e11d48", // Rose
];

interface Branch {
  id: string;
  code: string;
  name: string;
}

interface TransactionRow {
  id: string;
  transaction_number: string;
  transaction_date: string;
  transaction_type: string;
  currency_code: string;
  foreign_amount: number;
  idr_amount: number;
  status: string | null;
  branch_id: string | null;
  customer_id: string | null;
}

interface RateRow {
  currency_code: string;
  buying_rate: number;
  selling_rate: number;
  effective_date: string;
}

interface CashRow {
  currency_code: string;
  balance: number;
  branch_id: string;
}

function statusVariant(
  s: string | null,
): "default" | "secondary" | "outline" | "destructive" {
  if (!s) return "outline";
  const l = s.toLowerCase();
  if (l.includes("void") || l.includes("batal") || l.includes("reject"))
    return "destructive";
  if (l.includes("complete") || l.includes("selesai") || l.includes("done"))
    return "secondary";
  return "outline";
}

function DashboardPage() {
  const { roles, profile } = useCurrentUser();
  const isTellerOnly =
    roles.length > 0 && roles.every((r) => r === "teller");
  const lockedBranchId = isTellerOnly ? profile?.branch_id ?? null : null;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [period, setPeriod] = useState<"7d" | "30d">("7d");
  const [txs, setTxs] = useState<TransactionRow[]>([]);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [cash, setCash] = useState<CashRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [highRiskCount, setHighRiskCount] = useState(0);
  const [suspiciousCount, setSuspiciousCount] = useState(0);
  const [monthlyTxs, setMonthlyTxs] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const days = period === "7d" ? 7 : 30;

  useEffect(() => {
    let q = supabase.from("branches").select("id, code, name").order("name");
    if (lockedBranchId) q = q.eq("id", lockedBranchId);
    q.then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, [lockedBranchId]);

  useEffect(() => {
    if (lockedBranchId) setBranchFilter(lockedBranchId);
  }, [lockedBranchId]);

  const load = async () => {
    setLoading(true);
    const now = new Date();
    const rangeStart = startOfDay(subDays(now, days - 1)).toISOString();
    const rangeEnd = endOfDay(now).toISOString();
    const monthlyStart = startOfMonth(subMonths(now, 11)).toISOString();

    const txSel =
      "id, transaction_no, transaction_date, transaction_type, currency_id, foreign_amount, idr_amount, status, branch_id, customer_id";

    const txQ = supabase
      .from("transactions")
      .select(txSel)
      .gte("transaction_date", rangeStart)
      .lte("transaction_date", rangeEnd)
      .order("transaction_date", { ascending: false })
      .limit(2000);
    const monthlyQ = supabase
      .from("transactions")
      .select("transaction_date, idr_amount, transaction_type, branch_id")
      .gte("transaction_date", monthlyStart)
      .limit(20000);
    const rateQ = supabase
      .from("exchange_rates")
      .select("currency_id, buy_rate, sell_rate, effective_date")
      .order("effective_date", { ascending: false })
      .limit(200);
    const cashQ = supabase
      .from("cash_balances")
      .select("currency_id, balance, branch_id");
    const currencyQ = supabase.from("currencies").select("id, code");
    const approvalQ = supabase
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    const highRiskQ = supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("risk_rating", "high");
    const susQ = supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("is_suspicious", true);

    const [txR, mR, rR, cR, curR, aR, hR, sR] = await Promise.all([
      txQ,
      monthlyQ,
      rateQ,
      cashQ,
      currencyQ,
      approvalQ,
      highRiskQ,
      susQ,
    ]);

    const curMap = new Map<string, string>();
    for (const c of (curR.data as { id: string; code: string }[]) ?? []) {
      curMap.set(c.id, c.code);
    }
    const codeOf = (id: string | null) => (id ? curMap.get(id) ?? "?" : "?");

    setTxs(
      ((txR.data as any[]) ?? []).map((t) => ({
        id: t.id,
        transaction_number: t.transaction_no,
        transaction_date: t.transaction_date,
        transaction_type: t.transaction_type,
        currency_code: codeOf(t.currency_id),
        foreign_amount: Number(t.foreign_amount),
        idr_amount: Number(t.idr_amount),
        status: t.status,
        branch_id: t.branch_id,
        customer_id: t.customer_id,
      })),
    );
    setMonthlyTxs(((mR.data as any[]) ?? []) as TransactionRow[]);
    setRates(
      ((rR.data as any[]) ?? []).map((r) => ({
        currency_code: codeOf(r.currency_id),
        buying_rate: Number(r.buy_rate),
        selling_rate: Number(r.sell_rate),
        effective_date: r.effective_date,
      })),
    );
    setCash(
      ((cR.data as any[]) ?? []).map((c) => ({
        currency_code: codeOf(c.currency_id),
        balance: Number(c.balance),
        branch_id: c.branch_id,
      })),
    );
    setPendingApprovals(aR.count ?? 0);
    setHighRiskCount(hR.count ?? 0);
    setSuspiciousCount(sR.count ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const filteredTxs = useMemo(
    () =>
      branchFilter === "all"
        ? txs
        : txs.filter((t) => t.branch_id === branchFilter),
    [txs, branchFilter],
  );
  const filteredMonthly = useMemo(
    () =>
      branchFilter === "all"
        ? monthlyTxs
        : monthlyTxs.filter((t) => t.branch_id === branchFilter),
    [monthlyTxs, branchFilter],
  );
  const filteredCash = useMemo(
    () =>
      branchFilter === "all"
        ? cash
        : cash.filter((c) => c.branch_id === branchFilter),
    [cash, branchFilter],
  );

  const kpi = useMemo(() => {
    const now = new Date();
    const curStart = startOfDay(subDays(now, days - 1));
    const prevStart = startOfDay(subDays(now, days * 2 - 1));
    const prevEnd = startOfDay(subDays(now, days));
    const inRange = (d: string, a: Date, b: Date) => {
      const x = new Date(d).getTime();
      return x >= a.getTime() && x <= b.getTime();
    };
    const todays = filteredTxs.filter((t) =>
      inRange(t.transaction_date, curStart, endOfDay(now)),
    );
    const yestQ = filteredTxs.filter((t) =>
      inRange(t.transaction_date, prevStart, prevEnd),
    );

    const sum = (rows: TransactionRow[], t: string) =>
      rows
        .filter((r) => r.transaction_type?.toLowerCase() === t)
        .reduce((a, r) => a + Number(r.idr_amount || 0), 0);

    const buyToday = sum(todays, "buy") + sum(todays, "beli");
    const sellToday = sum(todays, "sell") + sum(todays, "jual");
    const buyYest = sum(yestQ, "buy") + sum(yestQ, "beli");
    const sellYest = sum(yestQ, "sell") + sum(yestQ, "jual");

    // Estimasi profit: selisih jual - beli (net position IDR)
    const profitToday = sellToday - buyToday;
    const profitYest = sellYest - buyYest;

    const pct = (a: number, b: number) => {
      if (!b) return a > 0 ? 100 : 0;
      return ((a - b) / Math.abs(b)) * 100;
    };

    return {
      count: todays.length,
      countDelta: pct(todays.length, yestQ.length),
      buy: buyToday,
      buyDelta: pct(buyToday, buyYest),
      sell: sellToday,
      sellDelta: pct(sellToday, sellYest),
      profit: profitToday,
      profitDelta: pct(profitToday, profitYest),
    };
  }, [filteredTxs, days]);

  const trendData = useMemo(() => {
    const now = new Date();
    const start = subDays(now, days - 1);
    const list = eachDayOfInterval({ start, end: now });
    return list.map((d) => {
      const rows = filteredTxs.filter((t) =>
        isSameDay(new Date(t.transaction_date), d),
      );
      const buy = rows
        .filter((r) => /buy|beli/i.test(r.transaction_type))
        .reduce((a, r) => a + Number(r.idr_amount || 0), 0);
      const sell = rows
        .filter((r) => /sell|jual/i.test(r.transaction_type))
        .reduce((a, r) => a + Number(r.idr_amount || 0), 0);
      return {
        d: format(d, days > 7 ? "d/M" : "EEE", { locale: idLocale }),
        buy: Math.round(buy / 1_000_000),
        sell: Math.round(sell / 1_000_000),
        profit: Math.round((sell - buy) / 1_000_000),
      };
    });
  }, [filteredTxs, days]);

  const currencyMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filteredTxs) {
      map.set(
        t.currency_code,
        (map.get(t.currency_code) ?? 0) + Number(t.idr_amount || 0),
      );
    }
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0);
    const entries = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, v]) => ({
        name,
        value: total ? Math.round((v / total) * 100) : 0,
        raw: v,
      }));
    // We filter out those with 0 value if there are any tiny ones, 
    // but the user wants to see all. Since `value` is rounded to nearest int, 
    // it could be 0%. We should show at least 1% or just rely on `raw` value for rendering.
    // If we want it to always be visible in the donut, maybe don't filter it out, just return `entries`.
    return entries;
  }, [filteredTxs]);

  const latestRates = useMemo(() => {
    const byCode = new Map<string, RateRow>();
    for (const r of rates) {
      if (!byCode.has(r.currency_code)) byCode.set(r.currency_code, r);
    }
    return Array.from(byCode.values()).slice(0, 8);
  }, [rates]);

  const cashSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of filteredCash) {
      map.set(c.currency_code, (map.get(c.currency_code) ?? 0) + Number(c.balance));
    }
    const idrBal = map.get("IDR") ?? 0;
    const foreign = Array.from(map.entries())
      .filter(([k]) => k !== "IDR")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    return { idr: idrBal, foreign };
  }, [filteredCash]);

  const monthlyData = useMemo(() => {
    const now = new Date();
    const start = startOfMonth(subMonths(now, 11));
    const months = eachMonthOfInterval({ start, end: now });
    return months.map((m) => {
      const rows = filteredMonthly.filter((t) =>
        isSameMonth(new Date(t.transaction_date), m),
      );
      const total = rows.reduce((a, r) => a + Number(r.idr_amount || 0), 0);
      return {
        m: format(m, "MMM", { locale: idLocale }),
        v: Math.round(total / 1_000_000),
      };
    });
  }, [filteredMonthly]);

  const recent = useMemo(() => filteredTxs.slice(0, 8), [filteredTxs]);

  const kpiCards = [
    {
      label: `Transaksi ${days} Hari`,
      value: nfmt(kpi.count),
      delta: kpi.countDelta,
      icon: ClipboardList,
      hint: "vs periode sebelumnya",
    },
    {
      label: "Total Beli",
      value: idr(kpi.buy),
      delta: kpi.buyDelta,
      icon: ArrowDownRight,
      hint: "Valas masuk",
    },
    {
      label: "Total Jual",
      value: idr(kpi.sell),
      delta: kpi.sellDelta,
      icon: ArrowUpRight,
      hint: "Valas keluar",
    },
    {
      label: "Net Position",
      value: idr(kpi.profit),
      delta: kpi.profitDelta,
      icon: TrendingUp,
      hint: "Jual − Beli (IDR)",
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
            Dashboard Analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ringkasan operasional & indikator kepatuhan {branchFilter === "all" ? "seluruh cabang" : "cabang terpilih"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={branchFilter}
            onValueChange={setBranchFilter}
            disabled={!!lockedBranchId}
          >
            <SelectTrigger className="w-40 sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!lockedBranchId && (
                <SelectItem value="all">Semua Cabang</SelectItem>
              )}
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => setPeriod(v as "7d" | "30d")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">7 Hari</SelectItem>
              <SelectItem value="30d">30 Hari</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((s) => {
          const up = s.delta >= 0;
          return (
            <Card key={s.label} className="relative overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <s.icon className="h-5 w-5" />
                  </div>
                  <Badge
                    variant={up ? "secondary" : "destructive"}
                    className="gap-1"
                  >
                    {up ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    {Number.isFinite(s.delta) ? `${s.delta.toFixed(1)}%` : "0%"}
                  </Badge>
                </div>
                {loading ? (
                  <Skeleton className="mt-4 h-8 w-32" />
                ) : (
                  <div className="mt-4 truncate text-2xl font-extrabold tracking-tight">
                    {s.value}
                  </div>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.label} · {s.hint}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Tren Volume {days} Hari
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              Dalam juta IDR
            </span>
          </CardHeader>
          <CardContent className="h-[300px] pl-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="gBuy" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gSell" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="d" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickFormatter={(v) => `${v}jt`} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `Rp ${v} juta`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="buy" name="Beli" stroke="var(--chart-1)" fill="url(#gBuy)" strokeWidth={2} />
                <Area type="monotone" dataKey="sell" name="Jual" stroke="var(--chart-2)" fill="url(#gSell)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribusi Mata Uang</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {currencyMix.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                Belum ada data.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={currencyMix} dataKey="raw" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2} minAngle={10}>
                    {currencyMix.map((_, i) => (
                      <Cell key={i} fill={pieColors[i % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number, name: string, props: any) => [`${idr(v)} (${props.payload.value}%)`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Net Position Harian
          </CardTitle>
          <span className="text-xs text-muted-foreground">Jual − Beli (juta IDR)</span>
        </CardHeader>
        <CardContent className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="d" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} tickFormatter={(v) => `${v}jt`} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `Rp ${v} juta`} />
              <Line type="monotone" dataKey="profit" name="Net" stroke="var(--chart-3)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Kurs Terkini</CardTitle>
            <span className="text-xs text-muted-foreground">
              {latestRates[0]
                ? `Efektif ${format(new Date(latestRates[0].effective_date), "dd MMM yyyy", { locale: idLocale })}`
                : "Belum ada kurs"}
            </span>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mata Uang</TableHead>
                    <TableHead className="text-right">Beli (Rp)</TableHead>
                    <TableHead className="text-right">Jual (Rp)</TableHead>
                    <TableHead className="text-right">Spread</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestRates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                        Belum ada data kurs.
                      </TableCell>
                    </TableRow>
                  ) : (
                    latestRates.map((r) => (
                      <TableRow key={r.currency_code}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {r.currency_code.slice(0, 2)}
                            </div>
                            <span className="font-semibold">{r.currency_code}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{nfmt(r.buying_rate)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{nfmt(r.selling_rate)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(r.selling_rate - r.buying_rate)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Posisi Kas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">Saldo Kas IDR</div>
                <div className="mt-1 text-xl font-extrabold">{idr(cashSummary.idr)}</div>
              </div>
              {cashSummary.foreign.length > 0 && (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  {cashSummary.foreign.map(([code, bal]) => (
                    <div key={code} className="rounded-lg bg-primary/5 p-2">
                      <Wallet className="mx-auto mb-1 h-4 w-4 text-primary" />
                      {code}
                      <div className="font-semibold text-foreground">
                        {compactIdr(bal)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Perlu Perhatian
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">Persetujuan menunggu</div>
                  <div className="text-xs text-muted-foreground">Perlu review manager</div>
                </div>
                <Badge variant={pendingApprovals > 0 ? "destructive" : "outline"}>
                  {pendingApprovals}
                </Badge>
              </div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">Nasabah risiko tinggi</div>
                  <div className="text-xs text-muted-foreground">Perlu CDD berkala</div>
                </div>
                <Badge variant={highRiskCount > 0 ? "destructive" : "outline"} className="gap-1">
                  <Users className="h-3 w-3" />
                  {highRiskCount}
                </Badge>
              </div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">Transaksi mencurigakan</div>
                  <div className="text-xs text-muted-foreground">Kandidat LTKM</div>
                </div>
                <Badge
                  className={
                    suspiciousCount > 0
                      ? "bg-warning text-warning-foreground hover:bg-warning"
                      : ""
                  }
                  variant={suspiciousCount > 0 ? "default" : "outline"}
                >
                  {suspiciousCount}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Transaksi Terbaru</CardTitle>
          <span className="text-xs text-muted-foreground">
            {recent.length} dari {filteredTxs.length} dalam {days} hari
          </span>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No.</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Mata Uang</TableHead>
                  <TableHead className="text-right">Nominal</TableHead>
                  <TableHead className="text-right">Total (Rp)</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Belum ada transaksi.
                    </TableCell>
                  </TableRow>
                ) : (
                  recent.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.transaction_number}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(r.transaction_date), "dd MMM HH:mm", { locale: idLocale })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={/buy|beli/i.test(r.transaction_type) ? "secondary" : "outline"}>
                          {r.transaction_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold">{r.currency_code}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {nfmt(r.foreign_amount)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {idr(r.idr_amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)}>{r.status ?? "—"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Volume Bulanan 12 Bulan Terakhir</CardTitle>
        </CardHeader>
        <CardContent className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="m" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} tickFormatter={(v) => `${v}jt`} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `Rp ${v} juta`} />
              <Bar dataKey="v" name="Volume" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}