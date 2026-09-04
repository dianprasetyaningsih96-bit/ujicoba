import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { z } from "zod";
import {
  ArrowLeftRight,
  ArrowDownCircle,
  ArrowUpCircle,
  Receipt,
  Search,
  Check,
  ChevronsUpDown,
  Ban,
  Trash2,
  Printer,
  FileDown,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import { Plus, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CustomerForm } from "@/components/customers/customer-form";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { useAppSettings } from "@/hooks/use-app-settings";
import { COUNTRIES } from "@/lib/countries";
import { MasterPageHeader } from "@/components/master-data/page-header";
import { generateReceiptPdf, printReceiptDirect, formatBirthDate } from "@/lib/pdf-receipt";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { up, UPPERCASE_FORM } from "@/lib/text-case";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/transactions")({
  component: TransactionsPage,
});

type TxType = "buy" | "sell";
type TxStatus = "draft" | "completed" | "voided";
type PayMethod = "cash" | "transfer" | "other";

interface Transaction {
  id: string;
  transaction_no: string;
  transaction_type: TxType;
  transaction_date: string;
  customer_id: string | null;
  currency_id: string;
  branch_id: string | null;
  rate: number;
  foreign_amount: number;
  idr_amount: number;
  payment_method: PayMethod;
  status: TxStatus;
  notes: string | null;
  teller_id: string | null;
  currencies?: { code: string; name: string } | null;
  branches?: {
    code: string;
    name: string;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
  } | null;
  customers?: {
    customer_code: string;
    full_name: string;
    nationality?: string | null;
    occupation?: string | null;
    date_of_birth?: string | null;
    place_of_birth?: string | null;
  } | null;
  profiles?: { full_name: string | null } | null;
}

interface CurrencyOpt {
  id: string;
  code: string;
  name: string;
}
interface BranchOpt {
  id: string;
  code: string;
  name: string;
}
interface CustomerOpt {
  id: string;
  customer_code: string;
  full_name: string;
  risk_rating: string;
  kyc_status: string;
  is_blacklisted: boolean;
  blacklist_reason?: string | null;
}
interface RateRow {
  currency_id: string;
  branch_id: string | null;
  buy_rate: number;
  sell_rate: number;
  effective_date: string;
}

interface ActiveShift {
  id: string;
  branch_id: string;
  shift_type: string;
  status: string;
  opened_at: string;
  branches?: { code: string; name: string } | null;
}

const HQ = "__hq__";
const NO_CUSTOMER = "__walkin__";

const schema = z.object({
  transaction_type: z.enum(["buy", "sell"]),
  currency_id: z.string().uuid("Pilih mata uang"),
  branch_id: z.string(),
  customer_id: z.string(),
  rate: z.coerce.number().positive("Kurs harus > 0"),
  foreign_amount: z.coerce.number().positive("Nominal valas harus > 0"),
  payment_method: z.enum(["cash", "transfer", "other"]),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  transaction_date: z.string().optional().or(z.literal("")),
});

type Form = z.infer<typeof schema>;

const emptyForm = (): Form => ({
  transaction_type: "buy",
  currency_id: "",
  branch_id: HQ,
  customer_id: NO_CUSTOMER,
  rate: 0,
  foreign_amount: 0,
  payment_method: "cash",
  notes: "",
  transaction_date: "",
});

const fmtIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const fmtNum = (n: number, d = 2) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);

// PPATK CDD threshold — Rp 100 juta untuk transaksi tunai
const CDD_THRESHOLD_IDR = 100_000_000;

function TransactionsPage() {
  const { roles, user, profile } = useCurrentUser();
  const { settings } = useAppSettings();
  
  // Load branch info to check if Head Office
  const [branchInfo, setBranchInfo] = useState<{ is_head_office: boolean } | null>(null);

  useEffect(() => {
    if (profile?.branch_id) {
      supabase.from("branches").select("is_head_office").eq("id", profile.branch_id).single().then(({ data }) => {
        setBranchInfo(data);
      });
    }
  }, [profile?.branch_id]);

  const canWrite = hasAnyRole(roles, [
    "super_admin",
    "owner",
    "branch_manager",
    "teller",
  ]);
  
  const canVoid = hasAnyRole(roles, [
    "super_admin",
    "owner",
    "branch_manager",
  ]);
  
  const isSuperAdmin = hasAnyRole(roles, ["super_admin"]);
  
  // Branches can ONLY buy. Head Office can buy AND sell. Super Admin bypass.
  const canSell = isSuperAdmin || (branchInfo?.is_head_office ?? false);
  const shiftExempt = isSuperAdmin;

  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyOpt[]>([]);
  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);

  const [search, setSearch] = useState("");
  
  const routerSearch = Route.useSearch() as any;
  useEffect(() => {
    if (routerSearch.search) {
      setSearch(routerSearch.search);
    }
  }, [routerSearch.search]);
  const [filterType, setFilterType] = useState<"all" | TxType>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | TxStatus>("all");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm());
  const [foreignInput, setForeignInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [rateInput, setRateInput] = useState("");

  const [viewing, setViewing] = useState<Transaction | null>(null);
  const [mustPrint, setMustPrint] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [voiding, setVoiding] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [showAddCustomer, setShowAddCustomer] = useState(false);

  async function load() {
    let query = supabase
      .from("transactions")
      .select(
        "*, currencies(code, name), branches(code, name, address, city, phone), customers(customer_code, full_name, nationality, occupation, date_of_birth, place_of_birth), profiles!teller_id(full_name)",
      )
      .order("transaction_date", { ascending: false })
      .limit(200);

    // Filter by branch if not super admin
    if (!isSuperAdmin && profile?.branch_id) {
      query = query.eq("branch_id", profile.branch_id);
    }

    const [
      { data: trx, error },
      { data: cur },
      { data: br },
      { data: cust },
      { data: rt },
      { data: sh },
    ] = await Promise.all([
      query,
      supabase
        .from("currencies")
        .select("id, code, name")
        .eq("is_active", true)
        .order("code"),
      supabase
        .from("branches")
        .select("id, code, name")
        .eq("is_active", true)
        .order("code"),
      supabase
        .from("customers")
        .select("id, customer_code, full_name, risk_rating, kyc_status, is_blacklisted, blacklist_reason")
        .order("full_name")
        .limit(500),
      supabase
        .from("exchange_rates")
        .select("currency_id, branch_id, buy_rate, sell_rate, effective_date")
        .eq("is_active", true)
        .order("effective_date", { ascending: false })
        .limit(500),
      user?.id
        ? supabase
            .from("shifts")
            .select("id, branch_id, shift_type, status, opened_at, branches(code, name)")
            .eq("user_id", user.id)
            .eq("status", "open")
            .order("opened_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (error) {
      toast.error("Gagal memuat transaksi", { description: error.message });
      return;
    }
    setRows((trx as Transaction[]) ?? []);
    setCurrencies((cur as CurrencyOpt[]) ?? []);
    setBranches((br as BranchOpt[]) ?? []);
    setCustomers((cust as CustomerOpt[]) ?? []);
    setRates((rt as RateRow[]) ?? []);
    setActiveShift((sh as ActiveShift | null) ?? null);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Auto-suggest rate ketika mata uang / cabang / tipe berubah
  useEffect(() => {
    if (!form.currency_id) return;
    const branchId = form.branch_id === HQ ? null : form.branch_id;
    const match =
      rates.find(
        (r) => r.currency_id === form.currency_id && r.branch_id === branchId,
      ) ||
      rates.find(
        (r) => r.currency_id === form.currency_id && r.branch_id === null,
      );
    if (match) {
      const suggested =
        form.transaction_type === "buy"
          ? Number(match.buy_rate)
          : Number(match.sell_rate);
      if (form.rate === 0 || form.rate === Number(match.buy_rate) || form.rate === Number(match.sell_rate)) {
        setForm((f) => ({ ...f, rate: suggested }));
        setRateInput(fmtNum(suggested, 0) + ",00");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.currency_id, form.branch_id, form.transaction_type, rates]);

  const idrAmount = useMemo(
    () => Number((form.rate * form.foreign_amount).toFixed(2)),
    [form.rate, form.foreign_amount],
  );

  const requiresCDD = idrAmount >= CDD_THRESHOLD_IDR;
  const selectedCustomer = customers.find((c) => c.id === form.customer_id);
  const isVerified = selectedCustomer?.kyc_status === "verified";
  const blacklistBlock = selectedCustomer?.is_blacklisted;

  function openCreate(type: TxType) {
    if (!activeShift && !shiftExempt) {
      toast.error("Shif belum dibuka", {
        description:
          "Buka shif kerja terlebih dahulu di menu Shif Kerja sebelum memulai transaksi.",
      });
      return;
    }
    const newForm = {
      ...emptyForm(),
      transaction_type: type,
      branch_id: activeShift?.branch_id ?? HQ,
    };
    setForm(newForm);
    setForeignInput("");
    setRateInput("");
    setOpen(true);
  }

  async function save() {
    if (!activeShift && !shiftExempt) {
      toast.error("Shif belum dibuka", {
        description: "Buka shif kerja dahulu sebelum menyimpan transaksi.",
      });
      return;
    }

    // 1. Check Monthly Threshold for Customers
    if (form.customer_id !== NO_CUSTOMER) {
      const { data: withinThreshold, error: thresholdError } = await supabase.rpc(
        "check_transaction_threshold",
        {
          p_customer_id: form.customer_id,
          p_new_amount_idr: idrAmount,
          p_threshold_usd: settings.transaction_threshold_usd || 10000,
        }
      );

      if (thresholdError) {
        console.error("Threshold check error:", thresholdError);
      } else if (withinThreshold === false) {
        toast.error("Melebihi ambang batas bulanan", {
          description: `Total transaksi nasabah bulan ini akan melebihi batas $${settings.transaction_threshold_usd.toLocaleString()}.`,
        });
        return;
      }
    }

    // 2. Check inventory if selling and prevent_oversell is active
    if (form.transaction_type === "sell" && settings.prevent_oversell) {
      const branchId = form.branch_id === HQ ? null : form.branch_id;
      
      // Query inventory for this currency at the specific branch
      const { data: inv, error: invError } = await supabase
        .from("cash_balances")
        .select("balance")
        .eq("currency_id", form.currency_id)
        .eq(branchId ? "branch_id" : "branch_id_is_null", branchId ? branchId : true)
        .maybeSingle();

      // Note: If using null in .eq(), Supabase JS might need .is("branch_id", null) 
      // but the schema usually handles branch_id = null for HQ.
      // Let's use a more robust check for branch_id.
      
      const { data: specificInv, error: specificError } = await (branchId 
        ? supabase.from("cash_balances").select("balance").eq("currency_id", form.currency_id).eq("branch_id", branchId)
        : supabase.from("cash_balances").select("balance").eq("currency_id", form.currency_id).is("branch_id", null)
      ).maybeSingle();

      if (specificError) {
        toast.error("Gagal memeriksa saldo", { description: specificError.message });
        return;
      }

      const currentBalance = specificInv?.balance || 0;

      if (currentBalance < form.foreign_amount) {
        toast.error("Saldo cabang tidak mencukupi", {
          description: `Stok cabang ini: ${fmtNum(currentBalance, 2)}. Transaksi jual ditolak.`,
        });
        return;
      }
    }

    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error("Data tidak valid", {
        description: parsed.error.issues[0]?.message,
      });
      return;
    }
    if (blacklistBlock) {
      toast.error("Nasabah masuk daftar hitam", {
        description: "Transaksi tidak dapat diproses.",
      });
      return;
    }
    if (requiresCDD) {
      if (parsed.data.customer_id === NO_CUSTOMER) {
        toast.error("CDD wajib", {
          description: "Transaksi ≥ Rp 100 juta wajib mencantumkan nasabah terdaftar.",
        });
        return;
      }
      
      if (!isVerified) {
        toast.error("Nasabah belum memenuhi CDD", {
          description: "Data identitas nasabah ini belum lengkap atau belum terverifikasi untuk transaksi ≥ Rp 100 juta.",
        });
        return;
      }
    }
    setSaving(true);
    const payload = {
      transaction_type: parsed.data.transaction_type,
      currency_id: parsed.data.currency_id,
      branch_id: parsed.data.branch_id === HQ ? null : parsed.data.branch_id,
      customer_id:
        parsed.data.customer_id === NO_CUSTOMER
          ? null
          : parsed.data.customer_id,
      rate: parsed.data.rate,
      foreign_amount: parsed.data.foreign_amount,
      idr_amount: idrAmount,
      payment_method: parsed.data.payment_method,
      status: "completed" as const,
      notes: up(parsed.data.notes),
      teller_id: user?.id ?? null,
      ...(isSuperAdmin && parsed.data.transaction_date
        ? { transaction_date: new Date(parsed.data.transaction_date).toISOString() }
        : {}),
    };
    const { data, error } = await supabase
      .from("transactions")
      .insert(payload)
      .select(
        "*, currencies(code, name), branches(code, name, address, city, phone), customers(customer_code, full_name, nationality, occupation, date_of_birth, place_of_birth), profiles!teller_id(full_name)",
      )
      .single();
    setSaving(false);
    if (error) {
      toast.error("Gagal menyimpan", { description: error.message });
      return;
    }
    toast.success("Transaksi tersimpan", {
      description: (data as Transaction).transaction_no,
    });
    setOpen(false);
    setViewing(data as Transaction);
    setMustPrint(true);
    setPrinted(false);
    load();
  }

  async function doVoid() {
    if (!voiding) return;
    if (!voidReason.trim()) {
      toast.error("Alasan pembatalan wajib diisi");
      return;
    }
    const { error } = await supabase
      .from("transactions")
      .update({
        status: "voided",
        voided_at: new Date().toISOString(),
        voided_by: user?.id ?? null,
        void_reason: voidReason.trim(),
      })
      .eq("id", voiding.id);
    if (error) {
      toast.error("Gagal membatalkan", { description: error.message });
      return;
    }
    toast.success("Transaksi dibatalkan");
    setVoiding(null);
    setVoidReason("");
    load();
  }

  async function doDelete() {
    if (!deleting) return;
    setDeletingBusy(true);
    const { error } = await supabase.rpc("admin_delete_transaction", {
      _transaction_id: deleting.id,
    });
    setDeletingBusy(false);
    if (error) {
      toast.error("Gagal menghapus transaksi", { description: error.message });
      return;
    }
    toast.success("Transaksi dihapus", {
      description: "Nomor transaksi pada tanggal tersebut telah diurutkan ulang.",
    });
    setDeleting(null);
    load();
  }

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterType !== "all" && r.transaction_type !== filterType)
        return false;
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (!q) return true;
      return (
        r.transaction_no.toLowerCase().includes(q) ||
        r.currencies?.code.toLowerCase().includes(q) ||
        r.customers?.full_name.toLowerCase().includes(q) ||
        r.customers?.customer_code.toLowerCase().includes(q)
      );
    });
  }, [rows, search, filterType, filterStatus]);

  const stats = useMemo(() => {
    if (!rows) return null;
    const today = new Date().toISOString().slice(0, 10);
    const t = rows.filter(
      (r) => r.transaction_date.slice(0, 10) === today && r.status !== "voided",
    );
    const buy = t
      .filter((r) => r.transaction_type === "buy")
      .reduce((a, r) => a + Number(r.idr_amount), 0);
    const sell = t
      .filter((r) => r.transaction_type === "sell")
      .reduce((a, r) => a + Number(r.idr_amount), 0);
    return { count: t.length, buy, sell, net: sell - buy };
  }, [rows]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <MasterPageHeader
        title="Transaksi"
        description="Pencatatan transaksi beli & jual valuta asing."
        canWrite={false}
        extra={
          canWrite && (
            <>
              <Button
                onClick={() => openCreate("buy")}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              >
                <ArrowDownCircle className="h-4 w-4" />
                Beli Valas
              </Button>
              {canSell && (
                <Button
                  onClick={() => openCreate("sell")}
                  className="gap-2 bg-rose-600 hover:bg-rose-700 text-white shadow-sm"
                >
                  <ArrowUpCircle className="h-4 w-4" />
                  Jual Valas
                </Button>
              )}
            </>
          )
        }
      />

      {canWrite && !activeShift && !shiftExempt && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium">Shif belum dibuka</p>
            <p className="opacity-90">
              Anda belum membuka shif kerja. Transaksi tidak dapat dilakukan
              sampai shif (Pagi atau Siang/Sore) dibuka di menu{" "}
              <span className="font-semibold">Shif Kerja</span>.
            </p>
          </div>
        </div>
      )}

      {canWrite && !activeShift && shiftExempt && (
        <div className="text-xs text-muted-foreground">
          Mode Super Admin — transaksi tidak memerlukan shif aktif.
        </div>
      )}

      {canWrite && activeShift && (
        <div className="text-xs text-muted-foreground">
          Shif aktif:{" "}
          <span className="font-semibold text-foreground">
            {activeShift.shift_type === "morning" ? "Pagi" : "Siang/Sore"}
          </span>
          {activeShift.branches ? ` · ${activeShift.branches.code} — ${activeShift.branches.name}` : ""}
          {" · dibuka "}
          {new Date(activeShift.opened_at).toLocaleString("id-ID")}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Transaksi Hari Ini" value={String(stats.count)} />
          <StatCard
            label="Beli Valas Hari Ini"
            value={fmtIDR(stats.buy)}
            tone="emerald"
          />
          <StatCard
            label="Jual Valas Hari Ini"
            value={fmtIDR(stats.sell)}
            tone="blue"
          />
          <StatCard
            label="Net Position"
            value={fmtIDR(stats.net)}
            tone={stats.net >= 0 ? "emerald" : "red"}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari no transaksi, mata uang, nasabah…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={filterType}
          onValueChange={(v) => setFilterType(v as "all" | TxType)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua tipe</SelectItem>
            <SelectItem value="buy">Beli Valas</SelectItem>
            <SelectItem value="sell">Jual Valas</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filterStatus}
          onValueChange={(v) => setFilterStatus(v as "all" | TxStatus)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua status</SelectItem>
            <SelectItem value="completed">Selesai</SelectItem>
            <SelectItem value="voided">Dibatalkan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. Transaksi</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Mata Uang</TableHead>
                <TableHead className="text-right">Nominal Valas</TableHead>
                <TableHead className="text-right">Kurs</TableHead>
                <TableHead className="text-right">Total IDR</TableHead>
                <TableHead>Nasabah</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-32">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered === null ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={10}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12">
                    <ArrowLeftRight className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Belum ada transaksi yang cocok.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.transaction_no}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(r.transaction_date).toLocaleString("id-ID", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "gap-1 text-white shadow-none",
                          r.transaction_type === "buy"
                            ? "bg-emerald-600 hover:bg-emerald-600"
                            : "bg-rose-600 hover:bg-rose-600",
                        )}
                      >
                        {r.transaction_type === "buy" ? (
                          <ArrowDownCircle className="h-3 w-3" />
                        ) : (
                          <ArrowUpCircle className="h-3 w-3" />
                        )}
                        {r.transaction_type === "buy" ? "Beli" : "Jual"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono font-semibold">
                      {r.currencies?.code}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmtNum(Number(r.foreign_amount))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(Number(r.rate), 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {fmtIDR(Number(r.idr_amount))}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.customers ? (
                        <div>
                          <div className="font-medium">
                            {r.customers.full_name}
                          </div>
                          <div className="text-muted-foreground font-mono">
                            {r.customers.customer_code}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">
                          Walk-in
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "completed"
                            ? "default"
                            : r.status === "voided"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {r.status === "completed"
                          ? "Selesai"
                          : r.status === "voided"
                            ? "Batal"
                            : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setViewing(r)}
                          title="Lihat struk"
                        >
                          <Receipt className="h-4 w-4" />
                        </Button>
                        {canVoid && r.status === "completed" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setVoiding(r)}
                            title="Batalkan"
                          >
                            <Ban className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                        {isSuperAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleting(r)}
                            title="Hapus transaksi"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={`max-w-2xl max-h-[90vh] overflow-y-auto ${UPPERCASE_FORM}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {form.transaction_type === "buy" ? (
                <>
                  <ArrowDownCircle className="h-5 w-5 text-emerald-600" /> Beli
                  Valas dari Nasabah
                </>
              ) : (
                <>
                  <ArrowUpCircle className="h-5 w-5 text-primary" /> Jual Valas
                  kepada Nasabah
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {form.transaction_type === "buy"
                ? "Money changer menerima valas, membayar rupiah kepada nasabah."
                : "Money changer menyerahkan valas, menerima rupiah dari nasabah."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Mata Uang *</Label>
              <Select
                value={form.currency_id}
                onValueChange={(v) => setForm({ ...form, currency_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih mata uang" />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cabang</Label>
              {roles.includes("teller") && !roles.includes("super_admin") ? (
                <div className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground opacity-70">
                  {branches.find((b) => b.id === form.branch_id)?.code || "HQ"} — {branches.find((b) => b.id === form.branch_id)?.name || "Default"}
                </div>
              ) : (
                <Select
                  value={form.branch_id}
                  onValueChange={(v) => setForm({ ...form, branch_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HQ}>HQ / Default</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Nominal Valas ({currencies.find(c => c.id === form.currency_id)?.code || "-"}) *</Label>
              <Input
                type="text"
                prefix={currencies.find(c => c.id === form.currency_id)?.code}
                value={foreignInput}
                onChange={(e) => {
                  let val = e.target.value;
                  // Allow only digits, one comma, and dots as separators
                  // But for the state we need it formatted visually
                  const clean = val.replace(/[^\d,\.]/g, "");
                  setForeignInput(clean);
                  
                  // Parse for DB/Logic: remove dots, replace comma with dot
                  const normalized = clean.replace(/\./g, "").replace(",", ".");
                  const num = parseFloat(normalized) || 0;
                  setForm({ ...form, foreign_amount: num });
                }}
                onBlur={() => {
                  // On blur, format it properly
                  if (form.foreign_amount > 0) {
                    setForeignInput(new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 5 }).format(form.foreign_amount));
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Kurs *</Label>
              <Input
                type="text"
                prefix="Rp"
                value={rateInput}
                onChange={(e) => {
                  let val = e.target.value;
                  // Allow digits, dots, and one comma
                  const clean = val.replace(/[^\d,\.]/g, "");
                  setRateInput(clean);
                  
                  // Parse for logic: remove dots, replace comma with dot
                  const normalized = clean.replace(/\./g, "").replace(",", ".");
                  const num = parseFloat(normalized) || 0;
                  setForm({ ...form, rate: num });
                }}
                onBlur={() => {
                  // Format as Rupiah on blur: dots separator and ,00
                  if (form.rate > 0) {
                    setRateInput(fmtNum(form.rate, 0) + ",00");
                  }
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                Kurs disarankan otomatis dari master kurs aktif — dapat diubah.
              </p>
            </div>

            <div className="col-span-2 rounded-xl bg-muted/40 p-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">
                  Total {form.transaction_type === "buy" ? "Dibayar" : "Diterima"} (IDR)
                </div>
                <div className="text-2xl font-bold font-mono">
                  {fmtIDR(idrAmount)}
                </div>
              </div>
              {requiresCDD && (
                <Badge variant="destructive" className="text-xs">
                  Wajib CDD — ≥ Rp 100 jt
                </Badge>
              )}
            </div>

            <div className="space-y-2 col-span-2">
              <div className="flex items-center justify-between">
                <Label>Nasabah {requiresCDD && "*"}</Label>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 gap-1 text-xs" 
                  onClick={() => setShowAddCustomer(true)}
                >
                  <Plus className="h-3 w-3" />
                  Tambah Nasabah Baru
                </Button>
              </div>

              {showAddCustomer ? (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4">
                    <CustomerForm 
                      onSuccess={(id) => {
                        load();
                        setForm(f => ({ ...f, customer_id: id }));
                        setShowAddCustomer(false);
                      }}
                      onCancel={() => setShowAddCustomer(false)}
                      initialBranchId={form.branch_id === HQ ? undefined : form.branch_id}
                    />
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          "w-full justify-between font-normal",
                          !form.customer_id && "text-muted-foreground"
                        )}
                      >
                        {form.customer_id === NO_CUSTOMER
                          ? "Walk-in (tanpa nasabah terdaftar)"
                          : customers.find((c) => c.id === form.customer_id)
                            ? `${customers.find((c) => c.id === form.customer_id)?.customer_code} — ${customers.find((c) => c.id === form.customer_id)?.full_name}`
                            : "Pilih nasabah"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command>
                        <CommandInput placeholder="Cari nasabah (Nama/Kode)..." />
                        <CommandList>
                          <CommandEmpty>Nasabah tidak ditemukan.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="walk-in"
                              onSelect={() => {
                                setForm({ ...form, customer_id: NO_CUSTOMER });
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  form.customer_id === NO_CUSTOMER ? "opacity-100" : "opacity-0"
                                )}
                              />
                              Walk-in (tanpa nasabah terdaftar)
                            </CommandItem>
                            {customers.map((c) => (
                              <CommandItem
                                key={c.id}
                                value={`${c.customer_code} ${c.full_name}`}
                                onSelect={() => {
                                  setForm({ ...form, customer_id: c.id });
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    form.customer_id === c.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <div className="flex flex-col">
                                  <span>{c.customer_code} — {c.full_name}</span>
                                  {c.is_blacklisted || c.risk_rating === "high" ? (
                                    <div className="flex gap-1 mt-0.5">
                                      {c.is_blacklisted && <Badge variant="destructive" className="text-[9px] h-3 px-1">DTTOT</Badge>}
                                      {c.risk_rating === "high" && <Badge variant="secondary" className="text-[9px] h-3 px-1 border-orange-500 text-orange-500">High Risk</Badge>}
                                    </div>
                                  ) : null}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {blacklistBlock && (
                    <div className="rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-destructive space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wide">
                        <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
                        <span>Peringatan Regulasi APU-PPT Bank Indonesia</span>
                      </div>
                      <p className="text-xs font-medium">
                        Nasabah ini terdaftar dalam <strong>DTTOT (Daftar Terduga Teroris & Organisasi Teroris)</strong>. Sesuai ketentuan Bank Indonesia, <strong>transaksi DITOLAK & DIBLOKIR otomatis oleh sistem</strong>.
                      </p>
                      {selectedCustomer?.blacklist_reason && (
                        <p className="text-[11px] text-muted-foreground">
                          Keterangan: {selectedCustomer.blacklist_reason}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label>Metode Pembayaran</Label>
              <Select
                value={form.payment_method}
                onValueChange={(v) =>
                  setForm({ ...form, payment_method: v as PayMethod })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Tunai</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                  <SelectItem value="other">Lainnya</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Input
                value={form.notes ?? ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                maxLength={500}
                placeholder="Opsional"
              />
            </div>

            {isSuperAdmin && (
              <div className="space-y-2 col-span-2">
                <Label>Tanggal Transaksi (Super Admin)</Label>
                <Input
                  type="datetime-local"
                  value={form.transaction_date ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, transaction_date: e.target.value })
                  }
                />
                <p className="text-[10px] text-muted-foreground">
                  Kosongkan untuk memakai waktu saat ini. Super Admin dapat
                  memilih tanggal yang sudah lewat untuk pencatatan mundur.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={save}
              disabled={saving || blacklistBlock}
              className={blacklistBlock ? "bg-destructive text-destructive-foreground cursor-not-allowed" : ""}
            >
              {saving
                ? "Menyimpan…"
                : blacklistBlock
                ? "⛔ Transaksi Diblokir (DTTOT)"
                : "Simpan Transaksi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt dialog */}
      <Dialog
        open={!!viewing}
        onOpenChange={(o) => {
          if (o) return;
          if (mustPrint && !printed) {
            toast.error("Cetak struk wajib", {
              description:
                "Transaksi baru selesai setelah struk dicetak. Klik 'Cetak Struk' untuk menyelesaikan.",
            });
            return;
          }
          setViewing(null);
          setMustPrint(false);
          setPrinted(false);
        }}
      >
        <DialogContent
          className="sm:max-w-[440px] w-[95vw] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden bg-background shadow-2xl rounded-2xl border"
          onEscapeKeyDown={(e) => {
            if (mustPrint && !printed) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (mustPrint && !printed) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (mustPrint && !printed) e.preventDefault();
          }}
        >
          <DialogHeader className="px-5 py-3 border-b bg-muted/30 shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-base font-bold">
                <Receipt className="h-4 w-4 text-primary" /> Struk Transaksi
              </DialogTitle>
              {mustPrint && !printed && (
                <Badge variant="destructive" className="text-[10px] animate-pulse">
                  Wajib Cetak
                </Badge>
              )}
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              {mustPrint && !printed
                ? "Cetak struk untuk menyelesaikan transaksi."
                : "Pratinjau struk (76 × 297mm) — sesuai hasil cetak printer thermal."}
            </DialogDescription>
          </DialogHeader>

          {viewing && (
            <div className="flex-1 overflow-y-auto p-4 bg-slate-100 dark:bg-slate-950 flex justify-center">
              <div
                id="receipt"
                className="w-[330px] shrink-0 h-fit bg-white text-black border border-dashed border-slate-300 px-6 py-6 font-mono text-[10.5px] leading-[1.38] shadow-lg rounded-xs select-text block"
                style={{
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  fontFamily: "'Courier New', Courier, ui-monospace, monospace",
                }}
              >
                {/* Header Identitas */}
                <div className="text-center">
                  <div className="font-bold text-[12px] uppercase">
                    {settings.company_name}
                  </div>
                  <div className="font-bold">AUTHORIZED MONEY CHANGER</div>
                  {(viewing.branches?.address || settings.company_address) && (
                    <div className="uppercase">
                      {viewing.branches?.address || settings.company_address}
                    </div>
                  )}
                  {(viewing.branches?.phone || settings.company_phone) && (
                    <div>TELP/WA {viewing.branches?.phone || settings.company_phone}</div>
                  )}
                  {settings.license_pva && (
                    <div>IZIN PVA {settings.license_pva}</div>
                  )}
                  {settings.npwp_number && <div>NPWP:{settings.npwp_number}</div>}
                </div>

                {/* Info Transaksi */}
                <div className="mt-2.5 flex justify-between font-bold">
                  <span>
                    {viewing.transaction_type === "buy"
                      ? "BUYING (BN)"
                      : "SELLING (JN)"}
                  </span>
                  <span>NO:{viewing.transaction_no}</span>
                </div>
                <ThermalDivider />

                <ThermalDetail
                  k="Date"
                  v={new Date(viewing.transaction_date).toLocaleString("id-ID", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                />
                <ThermalDetail
                  k="Name"
                  v={(viewing.customers?.full_name || "WALK-IN CUSTOMER").toUpperCase()}
                />
                <ThermalDetail
                  k="ID/KTP"
                  v={viewing.customers?.customer_code || "-"}
                />
                <ThermalDetail
                  k="Nationality"
                  v={(viewing.customers?.nationality || "-").toUpperCase()}
                />
                <ThermalDetail
                  k="Occupation"
                  v={(viewing.customers?.occupation || "-").toUpperCase()}
                />
                <ThermalDetail
                  k="DateBirth"
                  v={formatBirthDate(viewing.customers?.date_of_birth)}
                />
                <ThermalDetail
                  k="PlaceBirth"
                  v={(viewing.customers?.place_of_birth || "-").toUpperCase()}
                />
                <ThermalDetail
                  k="Pay type"
                  v={(viewing.payment_method ?? "cash").toUpperCase()}
                />
                <ThermalDetail
                  k="Outlet/DC"
                  v={(viewing.branches?.name || viewing.branches?.code || "-").toUpperCase()}
                />
                <ThermalDetail k="Objective" v="CURRENCY EXCHANGE" />
                <ThermalDivider />

                {/* Rincian Valuta */}
                <div className="flex justify-between font-bold text-[10px]">
                  <span>CURRENCY / AMOUNT</span>
                  <span>RATE</span>
                  <span>TOTAL RP</span>
                </div>
                <ThermalDivider />

                <div className="flex justify-between items-baseline my-1">
                  <span>{(viewing.currencies?.code ?? "-").toUpperCase()} {fmtNum(Number(viewing.foreign_amount), 2)}</span>
                  <span>x {fmtNum(Number(viewing.rate), 2)} =</span>
                  <span>
                    {new Intl.NumberFormat("id-ID").format(
                      Math.round(Number(viewing.idr_amount)),
                    )}
                  </span>
                </div>
                <ThermalDivider />

                {/* Total */}
                <div className="flex justify-end gap-3 font-bold">
                  <span>TOTAL RP =</span>
                  <span>
                    {new Intl.NumberFormat("id-ID").format(
                      Math.round(Number(viewing.idr_amount)),
                    )}
                  </span>
                </div>
                <div className="mt-1 flex justify-between font-bold text-[11.5px]">
                  <span>(RP)</span>
                  <span>
                    {new Intl.NumberFormat("id-ID").format(
                      Math.round(Number(viewing.idr_amount)),
                    )}
                  </span>
                </div>
                <ThermalDivider />

                {/* Operator & Signatures */}
                {viewing.profiles?.full_name && (
                  <ThermalDetail
                    k="Operator"
                    v={viewing.profiles.full_name.toUpperCase()}
                  />
                )}

                <div className="mt-6 flex justify-around text-center">
                  <span>( {viewing.profiles?.full_name?.toUpperCase() || "CUSTOMER"} )</span>
                  <span>( CASHIER )</span>
                </div>

                <div className="mt-5 text-center">
                  <div className="font-bold">ATTENTION #</div>
                  <div className="text-[9.5px]">Claim for shortage of cash after leaving</div>
                  <div className="text-[9.5px]">our premises cannot be considered</div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="px-4 py-3 border-t bg-background shrink-0 flex flex-row items-center justify-between gap-2">
            <div>
              {(!mustPrint || printed) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setViewing(null);
                    setMustPrint(false);
                    setPrinted(false);
                  }}
                >
                  Tutup
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs border-slate-300 hover:bg-muted"
                title="Unduh file PDF struk"
                onClick={() => {
                  if (!viewing) return;
                  generateReceiptPdf({
                    transaction_no: viewing.transaction_no,
                    transaction_date: viewing.transaction_date,
                    transaction_type: viewing.transaction_type,
                    branch: viewing.branches ?? null,
                    customer: viewing.customers ?? null,
                    currency: viewing.currencies?.code ?? "-",
                    foreign_amount: Number(viewing.foreign_amount),
                    rate: Number(viewing.rate),
                    idr_amount: Number(viewing.idr_amount),
                    payment_method: viewing.payment_method,
                    teller_name: viewing.profiles?.full_name || undefined,
                    company_name: settings.company_name,
                    company_address: viewing.branches?.address || settings.company_address,
                    company_phone: viewing.branches?.phone || settings.company_phone,
                    license_pva: settings.license_pva,
                    npwp_number: settings.npwp_number,
                  });
                }}
              >
                <FileDown className="h-3.5 w-3.5" />
                Simpan PDF
              </Button>

              <Button
                type="button"
                size="sm"
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
                onClick={() => {
                  if (!viewing) return;
                  printReceiptDirect({
                    transaction_no: viewing.transaction_no,
                    transaction_date: viewing.transaction_date,
                    transaction_type: viewing.transaction_type,
                    branch: viewing.branches ?? null,
                    customer: viewing.customers ?? null,
                    currency: viewing.currencies?.code ?? "-",
                    foreign_amount: Number(viewing.foreign_amount),
                    rate: Number(viewing.rate),
                    idr_amount: Number(viewing.idr_amount),
                    payment_method: viewing.payment_method,
                    teller_name: viewing.profiles?.full_name || undefined,
                    company_name: settings.company_name,
                    company_address: viewing.branches?.address || settings.company_address,
                    company_phone: viewing.branches?.phone || settings.company_phone,
                    license_pva: settings.license_pva,
                    npwp_number: settings.npwp_number,
                  });
                  setPrinted(true);
                  if (mustPrint) {
                    toast.success("Struk dikirim ke printer", {
                      description: "Transaksi selesai. Anda dapat menutup pratinjau.",
                    });
                  }
                }}
              >
                <Printer className="h-4 w-4" />
                {mustPrint && !printed ? "Cetak Struk (Wajib)" : "Cetak Struk"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void dialog */}
      <AlertDialog
        open={!!voiding}
        onOpenChange={(o) => {
          if (!o) {
            setVoiding(null);
            setVoidReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan transaksi?</AlertDialogTitle>
            <AlertDialogDescription>
              Transaksi {voiding?.transaction_no} akan ditandai sebagai
              dibatalkan. Data tetap tersimpan untuk audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>Alasan Pembatalan *</Label>
            <Textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Jelaskan alasan pembatalan…"
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doVoid}>
              Ya, Batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete dialog (Super Admin) */}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus transaksi permanen?</AlertDialogTitle>
            <AlertDialogDescription>
              Transaksi {deleting?.transaction_no} akan dihapus permanen, mutasi
              kas terkait dibatalkan (saldo dikembalikan), dan nomor transaksi
              pada tanggal tersebut akan diurutkan ulang. Tindakan ini tidak
              dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={deletingBusy}>
              {deletingBusy ? "Menghapus…" : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "blue" | "red";
}) {
  const toneCls =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "blue"
        ? "text-primary"
        : tone === "red"
          ? "text-destructive"
          : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold font-mono mt-1 ${toneCls}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function ReceiptRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}

function ThermalDivider() {
  return (
    <div
      className="my-1.5 border-t border-dashed border-slate-400"
      aria-hidden
    />
  );
}

function ThermalDetail({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1">
      <span className="w-[70px] shrink-0">{k}</span>
      <span>:</span>
      <span className="break-all">{v}</span>
    </div>
  );
}

function ThermalRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="opacity-80">{k}</span>
      <span className="font-semibold text-right">{v}</span>
    </div>
  );
}