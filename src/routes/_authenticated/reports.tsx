import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, AlertTriangle, Flag, Printer, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { MasterPageHeader } from "@/components/master-data/page-header";
import {
  generateReportPdf,
  generateLtkmReportPdf,
  generateLkubReportPdf,
} from "@/lib/pdf-reports";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

interface TrxRow {
  id: string;
  transaction_no: string;
  transaction_type: "buy" | "sell";
  transaction_date: string;
  rate: number;
  foreign_amount: number;
  idr_amount: number;
  payment_method: string;
  status: string;
  is_suspicious: boolean;
  suspicious_reason: string | null;
  ltkm_report_no: string | null;
  ltkm_reported_at: string | null;
  currencies?: { code: string } | null;
  customers?: { customer_code: string; full_name: string; id_number: string } | null;
  branches?: { code: string; name: string } | null;
}

interface Branch {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
}

const LTKT_THRESHOLD = 500_000_000;

interface MidRateRow {
  currency_id: string;
  mid_rate: number;
}

interface LkubRow {
  currency_id: string;
  currency_code: string;
  opening_foreign: number;
  opening_idr: number;
  buy_foreign: number;
  buy_idr: number;
  sell_foreign: number;
  sell_idr: number;
  mid_rate: number | null;
}

function currentMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(ym: string): { from: string; to: string; label: string } {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const label = first.toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
  });
  return { from: iso(first), to: iso(last), label };
}

function fmtNum(n: number, digits = 2) {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function fmtIDR(n: number) {
  return "Rp " + new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}
function fmtDate(s: string) {
  return new Date(s).toLocaleString("id-ID");
}
function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function exportExcel(filename: string, rows: TrxRow[]) {
  if (rows.length === 0) {
    toast.info("Tidak ada data untuk diunduh");
    return;
  }
  const data = rows.map((r) => ({
    "No. Transaksi": r.transaction_no,
    "Tanggal": new Date(r.transaction_date).toLocaleString("id-ID"),
    "Jenis": r.transaction_type === "buy" ? "Beli" : "Jual",
    "Cabang": r.branches?.name || r.branches?.code || "-",
    "Nasabah": r.customers?.full_name ?? "WALK-IN",
    "No. Identitas": r.customers?.id_number ?? "-",
    "Mata Uang": r.currencies?.code ?? "-",
    "Kurs": Number(r.rate),
    "Nominal Valas": Number(r.foreign_amount),
    "Nominal IDR": Number(r.idr_amount),
    "Metode": (r.payment_method ?? "cash").toUpperCase(),
    "Status": r.status,
    "Mencurigakan": r.is_suspicious ? "Ya" : "Tidak",
    "Alasan LTKM": r.suspicious_reason ?? "-",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Laporan Transaksi");
  XLSX.writeFile(wb, filename);
  toast.success("File Excel berhasil diunduh");
}

function ReportsPage() {
  const { roles, user } = useCurrentUser();
  const canFlag = hasAnyRole(roles, [
    "super_admin",
    "branch_manager",
    "auditor",
    "owner",
  ]);

  const [tab, setTab] = useState<"harian" | "bulanan" | "ltkt" | "ltkm">(
    "harian",
  );
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>(todayISO(-6));
  const [dateTo, setDateTo] = useState<string>(todayISO(0));
  const [monthPeriod, setMonthPeriod] = useState<string>(currentMonthISO());
  const [midRates, setMidRates] = useState<MidRateRow[]>([]);
  const [openingBalances, setOpeningBalances] = useState<any[]>([]);
  const [idToCode, setIdToCode] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (tab !== "bulanan") return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("currencies")
        .select("id, code");
      if (cancelled) return;
      const mapping = new Map<string, string>(
        (data ?? []).map((c: { id: string; code: string }) => [c.id, c.code]),
      );
      setIdToCode(mapping);
      
      midByCodeRef.current = new Map(
        midRates
          .map((m) => [mapping.get(m.currency_id), Number(m.mid_rate)] as const)
          .filter((x): x is readonly [string, number] => !!x[0]),
      );
      // Trigger re-render by touching rows dep (no-op set)
      setRows((r) => (r ? [...r] : r));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, midRates]);

  const [openingModalOpen, setOpeningModalOpen] = useState(false);
  const [openingSaving, setOpeningSaving] = useState(false);
  const [openingForm, setOpeningForm] = useState({
    currency_id: "",
    foreign: "",
    idr: ""
  });

  async function saveOpeningBalance() {
    if (!openingForm.currency_id || !openingForm.foreign || !openingForm.idr) {
      toast.error("Mohon isi semua field");
      return;
    }
    if (branchId === "all") {
      toast.error("Pilih cabang terlebih dahulu");
      return;
    }

    setOpeningSaving(true);
    const { error } = await supabase
      .from("monthly_balances")
      .upsert({
        branch_id: branchId,
        currency_id: openingForm.currency_id,
        period_month: monthPeriod + "-01",
        opening_balance_foreign: Number(openingForm.foreign),
        opening_balance_idr: Number(openingForm.idr)
      }, {
        onConflict: "branch_id, currency_id, period_month"
      });

    setOpeningSaving(false);
    if (error) {
      toast.error("Gagal menyimpan", { description: error.message });
      return;
    }
    toast.success("Saldo awal berhasil disimpan");
    setOpeningModalOpen(false);
    load();
  }

  const [rows, setRows] = useState<TrxRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const [flagOpen, setFlagOpen] = useState(false);
  const [flagTarget, setFlagTarget] = useState<TrxRow | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [flagSaving, setFlagSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("branches")
      .select("id, code, name, address, city, phone")
      .order("code")
      .then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);

  async function load() {
    setLoading(true);
    setRows(null);
    const range =
      tab === "bulanan"
        ? monthRange(monthPeriod)
        : { from: dateFrom, to: dateTo, label: "" };
    let q = supabase
      .from("transactions")
      .select(
        "id, transaction_no, transaction_type, transaction_date, rate, foreign_amount, idr_amount, payment_method, status, is_suspicious, suspicious_reason, ltkm_report_no, ltkm_reported_at, currencies(code), customers(customer_code, full_name, id_number), branches(code, name)",
      )
      .gte("transaction_date", range.from + "T00:00:00")
      .lte("transaction_date", range.to + "T23:59:59")
      .order("transaction_date", { ascending: false })
      .limit(1000);

    if (branchId !== "all") q = q.eq("branch_id", branchId);
    if (tab === "ltkt") {
      q = q
        .eq("payment_method", "cash")
        .eq("status", "completed")
        .gte("idr_amount", LTKT_THRESHOLD);
    } else if (tab === "ltkm") {
      q = q.eq("is_suspicious", true);
    }

    const { data, error } = await q;
    setLoading(false);
    if (error) {
      toast.error("Gagal memuat laporan", { description: error.message });
      return;
    }
    setRows((data as unknown as TrxRow[]) ?? []);

    if (tab === "bulanan") {
      const monthDate = monthPeriod + "-01";
      const midQuery = supabase
        .from("mid_rates")
        .select("currency_id, mid_rate")
        .eq("period_month", monthDate);
        
      let openQuery = supabase
        .from("monthly_balances")
        .select("currency_id, opening_balance_foreign, opening_balance_idr")
        .eq("period_month", monthDate);
      
      if (branchId !== "all") {
        openQuery = openQuery.eq("branch_id", branchId);
      }
        
      const [midRes, openRes] = await Promise.all([midQuery, openQuery]);
      
      setMidRates((midRes.data as MidRateRow[]) ?? []);
      setOpeningBalances((openRes.data as any[]) ?? []);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, branchId, dateFrom, dateTo, monthPeriod]);

  const totals = useMemo(() => {
    const r = rows ?? [];
    return {
      count: r.length,
      buy: r
        .filter((x) => x.transaction_type === "buy" && x.status === "completed")
        .reduce((s, x) => s + Number(x.idr_amount), 0),
      sell: r
        .filter((x) => x.transaction_type === "sell" && x.status === "completed")
        .reduce((s, x) => s + Number(x.idr_amount), 0),
      suspicious: r.filter((x) => x.is_suspicious).length,
    };
  }, [rows]);

  function openFlag(row: TrxRow) {
    setFlagTarget(row);
    setFlagReason(row.suspicious_reason ?? "");
    setFlagOpen(true);
  }

  async function saveFlag(mark: boolean) {
    if (!flagTarget) return;
    if (mark && flagReason.trim().length < 10) {
      toast.error("Alasan LTKM wajib diisi (minimal 10 karakter)");
      return;
    }
    setFlagSaving(true);
    const patch: Record<string, unknown> = mark
      ? {
          is_suspicious: true,
          suspicious_reason: flagReason.trim(),
          flagged_by: user?.id ?? null,
          flagged_at: new Date().toISOString(),
        }
      : {
          is_suspicious: false,
          suspicious_reason: null,
          flagged_by: null,
          flagged_at: null,
          ltkm_reported_at: null,
          ltkm_report_no: null,
        };
    const { error } = await supabase
      .from("transactions")
      .update(patch)
      .eq("id", flagTarget.id);
    setFlagSaving(false);
    if (error) {
      toast.error("Gagal menyimpan", { description: error.message });
      return;
    }
    toast.success(mark ? "Transaksi ditandai LTKM" : "Penandaan LTKM dibatalkan");
    setFlagOpen(false);
    load();
  }

  async function markReported() {
    if (!flagTarget) return;
    const no = window.prompt("Nomor Laporan PPATK (LTKM):");
    if (!no || no.trim().length === 0) return;
    const { error } = await supabase
      .from("transactions")
      .update({
        ltkm_report_no: no.trim(),
        ltkm_reported_at: new Date().toISOString(),
      })
      .eq("id", flagTarget.id);
    if (error) {
      toast.error("Gagal menyimpan", { description: error.message });
      return;
    }
    toast.success("Nomor laporan PPATK dicatat");
    setFlagOpen(false);
    load();
  }

  const title =
    tab === "harian"
      ? "Laporan Harian"
      : tab === "bulanan"
        ? `Laporan Kegiatan Usaha Bulanan (LKUB) — ${monthRange(monthPeriod).label}`
        : tab === "ltkt"
          ? "LTKT (Transaksi Keuangan Tunai ≥ Rp 500 jt)"
          : "LTKM (Transaksi Keuangan Mencurigakan)";

  // Resolve mid_rate currency_id → code via currencies table
  const midByCodeRef = useMemo(
    () => ({ current: new Map<string, number>() }),
    [],
  );

  const lkubRows: LkubRow[] = useMemo(() => {
    if (tab !== "bulanan" || !rows) return [];
    
    // 1. Map Opening Balances by Currency Code
    const openByCode = new Map<string, { foreign: number; idr: number }>();
    openingBalances.forEach(ob => {
      const code = idToCode.get(ob.currency_id);
      if (!code) return;
      const existing = openByCode.get(code) || { foreign: 0, idr: 0 };
      openByCode.set(code, {
        foreign: existing.foreign + Number(ob.opening_balance_foreign),
        idr: existing.idr + Number(ob.opening_balance_idr)
      });
    });

    const map = new Map<string, LkubRow>();
    
    // 2. Add all currencies that have opening balances but maybe no transactions yet
    openByCode.forEach((bal, code) => {
      map.set(code, {
        currency_id: "", // not strictly needed for UI
        currency_code: code,
        opening_foreign: bal.foreign,
        opening_idr: bal.idr,
        buy_foreign: 0,
        buy_idr: 0,
        sell_foreign: 0,
        sell_idr: 0,
        mid_rate: null,
      });
    });

    // 3. Process transactions
    for (const r of rows) {
      if (r.status !== "completed") continue;
      const code = r.currencies?.code ?? "-";
      const existing =
        map.get(code) ?? {
          currency_id: "",
          currency_code: code,
          opening_foreign: 0,
          opening_idr: 0,
          buy_foreign: 0,
          buy_idr: 0,
          sell_foreign: 0,
          sell_idr: 0,
          mid_rate: null,
        };
      if (r.transaction_type === "buy") {
        existing.buy_foreign += Number(r.foreign_amount);
        existing.buy_idr += Number(r.idr_amount);
      } else {
        existing.sell_foreign += Number(r.foreign_amount);
        existing.sell_idr += Number(r.idr_amount);
      }
      map.set(code, existing);
    }
    
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        mid_rate: midByCodeRef.current.get(row.currency_code) ?? null,
      }))
      .sort((a, b) => a.currency_code.localeCompare(b.currency_code));
  }, [tab, rows, midRates, openingBalances, idToCode]);


  function exportLkubExcel(monthPeriod: string, lkubRows: LkubRow[]) {
    if (lkubRows.length === 0) {
      toast.info("Tidak ada data untuk diunduh");
      return;
    }
    const data = lkubRows.map((r) => {
      const saldoAkhirValas = r.opening_foreign + r.buy_foreign - r.sell_foreign;
      const saldoAkhirIdr = r.mid_rate !== null ? saldoAkhirValas * r.mid_rate : 0;
      return {
        "Jenis Valuta": r.currency_code,
        "Jenis Produk": "1 - UKA",
        "Saldo Awal (Valas)": Number(r.opening_foreign),
        "Saldo Awal (Rupiah)": Number(r.opening_idr),
        "Volume Pembelian (Valas)": Number(r.buy_foreign),
        "Volume Pembelian (Rupiah)": Number(r.buy_idr),
        "Volume Penjualan (Valas)": Number(r.sell_foreign),
        "Volume Penjualan (Rupiah)": Number(r.sell_idr),
        "Saldo Akhir (Valas)": saldoAkhirValas,
        "Kurs Tengah": r.mid_rate !== null ? Number(r.mid_rate) : "-",
        "Saldo Akhir (Rupiah)": saldoAkhirIdr,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "LKUB");
    XLSX.writeFile(wb, `LKUB-${monthPeriod}.xlsx`);
    toast.success("File Excel LKUB berhasil diunduh");
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <MasterPageHeader
        title="Laporan"
        description="Laporan transaksi, LTKT, dan LTKM sesuai kewajiban pelaporan PPATK untuk KUPVA BB."
        canWrite={false}
      />

      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 flex-1">
              {tab === "bulanan" ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Periode (Bulan)</Label>
                  <Input
                    type="month"
                    value={monthPeriod}
                    onChange={(e) => setMonthPeriod(e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Dari Tanggal</Label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Sampai Tanggal</Label>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label>Cabang</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Cabang</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 xl:pt-0 shrink-0">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() =>
                  tab === "bulanan"
                    ? exportLkubExcel(monthPeriod, lkubRows)
                    : exportExcel(
                        `laporan-${tab}-${dateFrom}-sd-${dateTo}.xlsx`,
                        rows ?? [],
                      )
                }
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Unduh Excel
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const selectedBranch = branches.find((b) => b.id === branchId);
                  const label =
                    branchId === "all"
                      ? "Semua Cabang"
                      : selectedBranch?.name ?? "-";
                  const branchAddress = selectedBranch?.address || undefined;
                  const range =
                    tab === "bulanan"
                      ? monthRange(monthPeriod)
                      : { from: dateFrom, to: dateTo };
                  const meta = {
                    title,
                    variant: tab,
                    branchLabel: label,
                    branchAddress,
                    dateFrom: range.from,
                    dateTo: range.to,
                    totals,
                  };
                  if (tab === "bulanan") {
                    if (lkubRows.length === 0) {
                      toast.info("Tidak ada data untuk dicetak");
                      return;
                    }
                    generateLkubReportPdf(meta, lkubRows);
                    return;
                  }
                  if (!rows || rows.length === 0) {
                    toast.info("Tidak ada data untuk dicetak");
                    return;
                  }
                  if (tab === "ltkm") {
                    generateLtkmReportPdf(meta, rows);
                  } else {
                    generateReportPdf(meta, rows);
                  }
                }}
              >
                <Printer className="h-4 w-4" /> Cetak PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total Transaksi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Nilai Beli</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{fmtIDR(totals.buy)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Nilai Jual</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{fmtIDR(totals.sell)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              LTKM Ditandai
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.suspicious}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="harian">Harian</TabsTrigger>
          <TabsTrigger value="bulanan">Bulanan</TabsTrigger>
          <TabsTrigger value="ltkt">LTKT</TabsTrigger>
          <TabsTrigger value="ltkm">LTKM</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {title}
                </CardTitle>
                {tab === "bulanan" && (
                  <div className="flex flex-wrap gap-2">
                    {branchId !== "all" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setOpeningForm({ currency_id: "", foreign: "", idr: "" });
                          setOpeningModalOpen(true);
                        }}
                      >
                        Set Saldo Awal
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => exportLkubExcel(monthPeriod, lkubRows)}
                    >
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Unduh Excel LKUB
                    </Button>
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={() => {
                        if (lkubRows.length === 0) {
                          toast.info("Tidak ada data untuk dicetak");
                          return;
                        }
                        const selectedBranch = branches.find((b) => b.id === branchId);
                        const label =
                          branchId === "all"
                            ? "Semua Cabang"
                            : selectedBranch?.name ?? "-";
                        const branchAddress = selectedBranch?.address || undefined;
                        const range = monthRange(monthPeriod);
                        generateLkubReportPdf(
                          {
                            title,
                            variant: "bulanan",
                            branchLabel: label,
                            branchAddress,
                            dateFrom: range.from,
                            dateTo: range.to,
                            totals,
                          },
                          lkubRows,
                        );
                      }}
                    >
                      <Printer className="h-4 w-4" /> Cetak PDF LKUB
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {tab === "bulanan" ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Jenis Valuta</TableHead>
                        <TableHead>Jenis Produk</TableHead>
                        <TableHead className="text-right">Saldo Awal (Valas)</TableHead>
                        <TableHead className="text-right">Saldo Awal (Rp)</TableHead>
                        <TableHead className="text-right">Volume Beli (Valas)</TableHead>
                        <TableHead className="text-right">Volume Beli (Rp)</TableHead>
                        <TableHead className="text-right">Volume Jual (Valas)</TableHead>
                        <TableHead className="text-right">Volume Jual (Rp)</TableHead>
                        <TableHead className="text-right">Saldo Akhir (Valas)</TableHead>
                        <TableHead className="text-right">Kurs Tengah</TableHead>
                        <TableHead className="text-right">Saldo Akhir (Rp)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading || rows === null ? (
                        Array.from({ length: 4 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell colSpan={11}>
                              <Skeleton className="h-6 w-full" />
                            </TableCell>
                          </TableRow>
                        ))
                      ) : lkubRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={11} className="text-center py-12 text-sm text-muted-foreground">
                            Tidak ada transaksi pada periode ini.
                          </TableCell>
                        </TableRow>
                      ) : (
                        lkubRows.map((r) => {
                          const saldoAkhirValas = r.opening_foreign + r.buy_foreign - r.sell_foreign;
                          const saldoAkhirIdr = r.mid_rate !== null ? saldoAkhirValas * r.mid_rate : 0;
                          
                          return (
                            <TableRow key={r.currency_code}>
                              <TableCell className="font-mono font-semibold">
                                {r.currency_code}
                              </TableCell>
                              <TableCell>1 - UKA</TableCell>
                              <TableCell className="text-right font-mono">
                                {fmtNum(r.opening_foreign)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {fmtIDR(r.opening_idr)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {fmtNum(r.buy_foreign)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {fmtIDR(r.buy_idr)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {fmtNum(r.sell_foreign)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {fmtIDR(r.sell_idr)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {fmtNum(saldoAkhirValas)}
                              </TableCell>
                                <TableCell className="text-right font-mono">
                                  {r.mid_rate !== null ? (
                                    "Rp " + new Intl.NumberFormat("id-ID", {
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 0,
                                    }).format(r.mid_rate)
                                  ) : (
                                  <span className="text-amber-600 text-xs">
                                    belum diisi
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {fmtIDR(saldoAkhirIdr)}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Trx</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Nasabah</TableHead>
                    <TableHead>Valas</TableHead>
                    <TableHead className="text-right">Nominal Valas</TableHead>
                    <TableHead className="text-right">Nominal IDR</TableHead>
                    <TableHead>Metode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24 text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading || rows === null ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={10}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-sm text-muted-foreground">
                        Tidak ada transaksi pada periode & filter ini.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow
                        key={r.id}
                        className={r.is_suspicious ? "bg-amber-50/50" : ""}
                      >
                        <TableCell className="font-mono text-xs">
                          {r.transaction_no}
                        </TableCell>
                        <TableCell className="text-xs">
                          {fmtDate(r.transaction_date)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={r.transaction_type === "buy" ? "default" : "secondary"}
                          >
                            {r.transaction_type === "buy" ? "Beli" : "Jual"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.customers?.full_name ?? "—"}
                          {r.customers?.id_number && (
                            <div className="text-muted-foreground">
                              {r.customers.id_number}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono">
                          {r.currencies?.code}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {new Intl.NumberFormat("id-ID", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          }).format(Number(r.foreign_amount))}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtIDR(Number(r.idr_amount))}
                        </TableCell>
                        <TableCell className="capitalize text-xs">
                          {r.payment_method}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant={
                                r.status === "completed"
                                  ? "default"
                                  : r.status === "voided"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {r.status}
                            </Badge>
                            {r.is_suspicious && (
                              <Badge
                                variant="outline"
                                className="gap-1 border-amber-400 text-amber-700"
                              >
                                <AlertTriangle className="h-3 w-3" />
                                LTKM
                              </Badge>
                            )}
                            {r.ltkm_report_no && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                #{r.ltkm_report_no}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {canFlag && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openFlag(r)}
                              className="gap-1"
                            >
                              <Flag className="h-3.5 w-3.5" />
                              {r.is_suspicious ? "Kelola" : "Tandai"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={flagOpen} onOpenChange={setFlagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tandai Transaksi Mencurigakan (LTKM)</DialogTitle>
            <DialogDescription>
              Cantumkan alasan yang jelas dan spesifik. Data ini menjadi dasar
              Laporan Transaksi Keuangan Mencurigakan kepada PPATK.
            </DialogDescription>
          </DialogHeader>
          {flagTarget && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between rounded-md bg-muted p-3">
                <span className="font-mono">{flagTarget.transaction_no}</span>
                <span>{fmtIDR(Number(flagTarget.idr_amount))}</span>
              </div>
              <div className="space-y-2">
                <Label>Alasan / Red Flag *</Label>
                <Textarea
                  rows={4}
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  placeholder="mis. Nominal tidak sesuai profil ekonomi nasabah; transaksi terpecah (structuring) untuk menghindari ambang LTKT; identitas nasabah mencurigakan; dll."
                  maxLength={1000}
                />
              </div>
              {flagTarget.is_suspicious && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs">
                  <div className="font-medium text-amber-900">
                    Status: Ditandai sebagai LTKM
                  </div>
                  {flagTarget.ltkm_report_no ? (
                    <div className="mt-1 text-amber-800">
                      Sudah dilaporkan — No. Laporan{" "}
                      <span className="font-mono">
                        {flagTarget.ltkm_report_no}
                      </span>{" "}
                      pada{" "}
                      {flagTarget.ltkm_reported_at &&
                        fmtDate(flagTarget.ltkm_reported_at)}
                    </div>
                  ) : (
                    <div className="mt-1 text-amber-800">
                      Belum dilaporkan ke PPATK.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {flagTarget?.is_suspicious && (
              <>
                <Button
                  variant="outline"
                  onClick={markReported}
                  disabled={flagSaving}
                >
                  Catat No. Laporan PPATK
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => saveFlag(false)}
                  disabled={flagSaving}
                >
                  Batalkan Penandaan
                </Button>
              </>
            )}
            <Button
              variant="outline"
              onClick={() => setFlagOpen(false)}
              disabled={flagSaving}
            >
              Tutup
            </Button>
            <Button
              onClick={() => saveFlag(true)}
              disabled={flagSaving}
              className="gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              {flagTarget?.is_suspicious ? "Perbarui Alasan" : "Tandai LTKM"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={openingModalOpen} onOpenChange={setOpeningModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Saldo Awal LKUB</DialogTitle>
            <DialogDescription>
              Tentukan saldo awal (carry-over) untuk periode {monthPeriod} di cabang yang dipilih.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Mata Uang</Label>
              <Select 
                value={openingForm.currency_id} 
                onValueChange={(v) => setOpeningForm(prev => ({ ...prev, currency_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih mata uang" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(idToCode.entries()).map(([id, code]) => (
                    <SelectItem key={id} value={id}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Saldo Awal (Valas)</Label>
              <Input 
                type="text"
                inputMode="numeric"
                value={openingForm.foreign ? fmtNum(Number(openingForm.foreign), 0) : ""}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^\d]/g, "");
                  setOpeningForm(prev => ({ ...prev, foreign: val }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Saldo Awal (Rp - Historical Cost)</Label>
              <Input 
                type="text"
                inputMode="numeric"
                value={openingForm.idr ? fmtNum(Number(openingForm.idr), 0) : ""}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^\d]/g, "");
                  setOpeningForm(prev => ({ ...prev, idr: val }));
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpeningModalOpen(false)}>Batal</Button>
            <Button onClick={saveOpeningBalance} disabled={openingSaving}>
              {openingSaving ? "Menyimpan..." : "Simpan Saldo Awal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

