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
  Pencil,
  Printer,
  FileDown,
  AlertTriangle,
  ShieldAlert,
  Calendar,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Plus, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CustomerForm } from "@/components/customers/customer-form";
import { EditTransactionDialog } from "@/components/transactions/edit-transaction-dialog";
import { DatePickerInput } from "@/components/ui/date-picker-input";
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

interface TransactionItemRow {
  id: string;
  transaction_id: string;
  currency_id: string;
  foreign_amount: number;
  rate: number;
  idr_amount: number;
  currencies?: { code: string; name: string } | null;
}

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
  transaction_items?: TransactionItemRow[];
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
  customer_type?: "individual" | "corporate" | string | null;
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

interface FormCurrencyItem {
  id: string;
  currency_id: string;
  foreign_amount: number;
  rate: number;
  foreignInput: string;
  rateInput: string;
}

interface FormState {
  transaction_type: TxType;
  branch_id: string;
  customer_id: string;
  payment_method: PayMethod;
  notes: string;
  transaction_date: string;
  items: FormCurrencyItem[];
}

const createEmptyItem = (): FormCurrencyItem => ({
  id: Math.random().toString(36).substring(2, 9),
  currency_id: "",
  foreign_amount: 0,
  rate: 0,
  foreignInput: "",
  rateInput: "",
});

const emptyForm = (): FormState => ({
  transaction_type: "buy",
  branch_id: HQ,
  customer_id: NO_CUSTOMER,
  payment_method: "cash",
  notes: "",
  transaction_date: "",
  items: [createEmptyItem()],
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

type DateFilterMode = "all" | "today" | "yesterday" | "this_month" | "custom_date" | "custom_range";

function toLocalDateStr(d: Date | string): string {
  const dateObj = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) return "";
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayRangeISO(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

function getMonthRangeISO(ymStr: string) {
  const [y, m] = ymStr.split("-").map(Number);
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

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
  const [filterBranch, setFilterBranch] = useState<string>("all");
  const [dateMode, setDateMode] = useState<DateFilterMode>("all");
  const [customDate, setCustomDate] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Pagination Transaksi (10 per halaman, dinamis)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [viewing, setViewing] = useState<Transaction | null>(null);
  const [mustPrint, setMustPrint] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [voiding, setVoiding] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [showAddCustomer, setShowAddCustomer] = useState(false);

  async function load(
    targetBranch = filterBranch,
    targetDateMode = dateMode,
    targetCustomDate = customDate,
    targetStart = startDate,
    targetEnd = endDate,
  ) {
    let query = supabase
      .from("transactions")
      .select(
        "*, currencies(code, name), branches(code, name, address, city, phone), customers(customer_code, full_name, nationality, occupation, date_of_birth, place_of_birth), profiles!teller_id(full_name), transaction_items(*, currencies(code, name))",
      )
      .order("transaction_date", { ascending: false });

    // Filter by branch if not super admin, or if super admin selects a specific branch
    if (!isSuperAdmin && profile?.branch_id) {
      query = query.eq("branch_id", profile.branch_id);
    } else if (isSuperAdmin && targetBranch !== "all") {
      query = query.eq("branch_id", targetBranch);
    }

    // Filter by date
    if (targetDateMode === "today") {
      const { startISO, endISO } = getDayRangeISO(toLocalDateStr(new Date()));
      query = query.gte("transaction_date", startISO).lte("transaction_date", endISO);
    } else if (targetDateMode === "yesterday") {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const { startISO, endISO } = getDayRangeISO(toLocalDateStr(y));
      query = query.gte("transaction_date", startISO).lte("transaction_date", endISO);
    } else if (targetDateMode === "this_month") {
      const ym = toLocalDateStr(new Date()).slice(0, 7);
      const { startISO, endISO } = getMonthRangeISO(ym);
      query = query.gte("transaction_date", startISO).lte("transaction_date", endISO);
    } else if (targetDateMode === "custom_date" && targetCustomDate) {
      const { startISO, endISO } = getDayRangeISO(targetCustomDate);
      query = query.gte("transaction_date", startISO).lte("transaction_date", endISO);
    } else if (targetDateMode === "custom_range") {
      if (targetStart) {
        const { startISO } = getDayRangeISO(targetStart);
        query = query.gte("transaction_date", startISO);
      }
      if (targetEnd) {
        const { endISO } = getDayRangeISO(targetEnd);
        query = query.lte("transaction_date", endISO);
      }
    }

    query = query.limit(1000);

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
        .select("id, customer_code, full_name, risk_rating, kyc_status, is_blacklisted, blacklist_reason, customer_type")
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

  const getSuggestedRate = (
    currId: string,
    branchIdStr: string,
    txType: TxType,
  ) => {
    if (!currId) return 0;
    const bId = branchIdStr === HQ ? null : branchIdStr;
    const match =
      rates.find((r) => r.currency_id === currId && r.branch_id === bId) ||
      rates.find((r) => r.currency_id === currId && r.branch_id === null);
    if (!match) return 0;
    return txType === "buy" ? Number(match.buy_rate) : Number(match.sell_rate);
  };

  const handleItemCurrencyChange = (index: number, newCurrencyId: string) => {
    setForm((prev) => {
      const nextItems = [...prev.items];
      const suggested = getSuggestedRate(newCurrencyId, prev.branch_id, prev.transaction_type);
      nextItems[index] = {
        ...nextItems[index],
        currency_id: newCurrencyId,
        rate: suggested,
        rateInput: suggested > 0 ? fmtNum(suggested, 0) + ",00" : "",
      };
      return { ...prev, items: nextItems };
    });
  };

  const handleItemForeignChange = (index: number, val: string) => {
    const clean = val.replace(/[^\d,\.]/g, "");
    const normalized = clean.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(normalized) || 0;
    setForm((prev) => {
      const nextItems = [...prev.items];
      nextItems[index] = {
        ...nextItems[index],
        foreignInput: clean,
        foreign_amount: num,
      };
      return { ...prev, items: nextItems };
    });
  };

  const handleItemForeignBlur = (index: number) => {
    setForm((prev) => {
      const nextItems = [...prev.items];
      const it = nextItems[index];
      if (it && it.foreign_amount > 0) {
        nextItems[index] = {
          ...it,
          foreignInput: new Intl.NumberFormat("id-ID", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 5,
          }).format(it.foreign_amount),
        };
      }
      return { ...prev, items: nextItems };
    });
  };

  const handleItemRateChange = (index: number, val: string) => {
    const clean = val.replace(/[^\d,\.]/g, "");
    const normalized = clean.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(normalized) || 0;
    setForm((prev) => {
      const nextItems = [...prev.items];
      nextItems[index] = {
        ...nextItems[index],
        rateInput: clean,
        rate: num,
      };
      return { ...prev, items: nextItems };
    });
  };

  const handleItemRateBlur = (index: number) => {
    setForm((prev) => {
      const nextItems = [...prev.items];
      const it = nextItems[index];
      if (it && it.rate > 0) {
        nextItems[index] = {
          ...it,
          rateInput: fmtNum(it.rate, 0) + ",00",
        };
      }
      return { ...prev, items: nextItems };
    });
  };

  const handleAddItem = () => {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, createEmptyItem()],
    }));
  };

  const handleRemoveItem = (index: number) => {
    if (form.items.length <= 1) return;
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const handleBranchChange = (newBranchId: string) => {
    setForm((prev) => {
      const nextItems = prev.items.map((it) => {
        const suggested = getSuggestedRate(it.currency_id, newBranchId, prev.transaction_type);
        if (suggested > 0 && (it.rate === 0 || it.rate === suggested)) {
          return {
            ...it,
            rate: suggested,
            rateInput: fmtNum(suggested, 0) + ",00",
          };
        }
        return it;
      });
      return { ...prev, branch_id: newBranchId, items: nextItems };
    });
  };

  const idrAmount = useMemo(() => {
    return form.items.reduce((acc, it) => {
      const sub = Number((it.rate * it.foreign_amount).toFixed(2));
      return acc + (isNaN(sub) ? 0 : sub);
    }, 0);
  }, [form.items]);

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
    const hqId =
      branches.find(
        (b) =>
          b.is_head_office ||
          (b as any).is_hq ||
          b.code.toUpperCase().includes("HQ") ||
          b.name.toLowerCase().includes("pusat") ||
          b.name.toLowerCase().includes("jimbaran"),
      )?.id ?? branches[0]?.id;
    const branchId = activeShift?.branch_id ?? hqId ?? HQ;
    setForm({
      ...emptyForm(),
      transaction_type: type,
      branch_id: branchId,
      items: [createEmptyItem()],
    });
    setOpen(true);
  }

  async function save() {
    if (!activeShift && !shiftExempt) {
      toast.error("Shif belum dibuka", {
        description: "Buka shif kerja dahulu sebelum menyimpan transaksi.",
      });
      return;
    }

    // Validate items
    if (form.items.length === 0) {
      toast.error("Minimal harus ada 1 mata uang");
      return;
    }

    for (let i = 0; i < form.items.length; i++) {
      const it = form.items[i];
      if (!it.currency_id) {
        toast.error(`Baris ke-${i + 1}: Pilih mata uang terlebih dahulu`);
        return;
      }
      if (!it.foreign_amount || it.foreign_amount <= 0) {
        toast.error(`Baris ke-${i + 1}: Nominal valas harus lebih besar dari 0`);
        return;
      }
      if (!it.rate || it.rate <= 0) {
        toast.error(`Baris ke-${i + 1}: Kurs harus lebih besar dari 0`);
        return;
      }
    }

    // 1. Check Monthly Threshold for Customers
    if (form.customer_id !== NO_CUSTOMER) {
      let custType = customers.find((c) => c.id === form.customer_id)?.customer_type;
      if (!custType) {
        const { data: custData } = await supabase
          .from("customers")
          .select("customer_type")
          .eq("id", form.customer_id)
          .maybeSingle();
        custType = custData?.customer_type;
      }

      const isCorporate = custType === "corporate";
      const isBuy = form.transaction_type === "buy";

      const isThresholdEnabled = isCorporate
        ? (isBuy ? settings.threshold_corporate_buy_enabled : settings.threshold_corporate_sell_enabled)
        : (isBuy ? settings.threshold_individual_buy_enabled : settings.threshold_individual_sell_enabled);

      const thresholdLimitUsd = isCorporate
        ? (isBuy ? settings.threshold_corporate_buy_usd : settings.threshold_corporate_sell_usd)
        : (isBuy ? settings.threshold_individual_buy_usd : settings.threshold_individual_sell_usd);

      if (isThresholdEnabled) {
        const { data: withinThreshold, error: thresholdError } = await supabase.rpc(
          "check_transaction_threshold" as any,
          {
            p_customer_id: form.customer_id,
            p_new_amount_idr: idrAmount,
            p_threshold_usd: thresholdLimitUsd || 10000,
            p_transaction_type: form.transaction_type,
          }
        );

        if (thresholdError) {
          console.error("Threshold check error:", thresholdError);
        } else if (withinThreshold === false) {
          const typeLabel = isBuy ? "Beli Valas" : "Jual Valas";
          const custCategory = isCorporate ? "Badan Usaha" : "Perseorangan";
          toast.error("Melebihi ambang batas bulanan", {
            description: `Total transaksi ${typeLabel} nasabah ${custCategory} bulan ini akan melebihi batas $${(thresholdLimitUsd || 10000).toLocaleString()}.`,
          });
          return;
        }
      }
    }

    // 2. Check inventory if selling and prevent_oversell is active
    if (form.transaction_type === "sell" && settings.prevent_oversell) {
      const branchId = form.branch_id === HQ ? null : form.branch_id;
      for (const it of form.items) {
        const { data: specificInv, error: specificError } = await (branchId 
          ? supabase.from("cash_balances").select("balance").eq("currency_id", it.currency_id).eq("branch_id", branchId)
          : supabase.from("cash_balances").select("balance").eq("currency_id", it.currency_id).is("branch_id", null)
        ).maybeSingle();

        if (specificError) {
          toast.error("Gagal memeriksa saldo", { description: specificError.message });
          return;
        }

        const currentBalance = specificInv?.balance || 0;
        if (currentBalance < it.foreign_amount) {
          const currCode = currencies.find((c) => c.id === it.currency_id)?.code || "Valas";
          toast.error(`Saldo ${currCode} cabang tidak mencukupi`, {
            description: `Stok cabang ini: ${fmtNum(currentBalance, 2)}. Transaksi jual ditolak.`,
          });
          return;
        }
      }
    }

    if (blacklistBlock) {
      toast.error("Nasabah masuk daftar hitam", {
        description: "Transaksi tidak dapat diproses.",
      });
      return;
    }
    if (requiresCDD) {
      if (form.customer_id === NO_CUSTOMER) {
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
    const payloadItems = form.items.map((it) => ({
      currency_id: it.currency_id,
      foreign_amount: it.foreign_amount,
      rate: it.rate,
      idr_amount: Number((it.foreign_amount * it.rate).toFixed(2)),
    }));

    const { data: rpcRes, error: rpcError } = await supabase.rpc(
      "create_multi_currency_transaction",
      {
        p_branch_id:
          form.branch_id === HQ
            ? (branches.find((b) => b.is_head_office)?.id ?? null)
            : form.branch_id,
        p_customer_id:
          form.customer_id === NO_CUSTOMER ? null : form.customer_id,
        p_transaction_type: form.transaction_type,
        p_payment_method: form.payment_method,
        p_notes: up(form.notes) || null,
        p_transaction_date:
          isSuperAdmin && form.transaction_date
            ? new Date(form.transaction_date).toISOString()
            : null,
        p_items: payloadItems,
      }
    );

    if (rpcError) {
      setSaving(false);
      toast.error("Gagal menyimpan transaksi", { description: rpcError.message });
      return;
    }

    const createdId = (rpcRes as any)?.id;
    const { data: fullTx } = await supabase
      .from("transactions")
      .select(
        "*, currencies(code, name), branches(code, name, address, city, phone), customers(customer_code, full_name, nationality, occupation, date_of_birth, place_of_birth), profiles!teller_id(full_name), transaction_items(*, currencies(code, name))",
      )
      .eq("id", createdId)
      .single();

    setSaving(false);
    const savedTx = (fullTx as Transaction) || (rpcRes as Transaction);
    toast.success("Transaksi tersimpan", {
      description: savedTx.transaction_no,
    });
    setOpen(false);
    setViewing(savedTx);
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
    const todayStr = toLocalDateStr(new Date());
    let yStr = "";
    if (dateMode === "yesterday") {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      yStr = toLocalDateStr(y);
    }
    const thisMonthStr = todayStr.slice(0, 7);

    return rows.filter((r) => {
      if (isSuperAdmin && filterBranch !== "all" && r.branch_id !== filterBranch)
        return false;
      if (filterType !== "all" && r.transaction_type !== filterType)
        return false;
      if (filterStatus !== "all" && r.status !== filterStatus) return false;

      // Date filtering
      const rowDateStr = toLocalDateStr(r.transaction_date);
      if (dateMode === "today" && rowDateStr !== todayStr) return false;
      if (dateMode === "yesterday" && rowDateStr !== yStr) return false;
      if (dateMode === "this_month" && !rowDateStr.startsWith(thisMonthStr)) return false;
      if (dateMode === "custom_date" && customDate && rowDateStr !== customDate) return false;
      if (dateMode === "custom_range") {
        if (startDate && rowDateStr < startDate) return false;
        if (endDate && rowDateStr > endDate) return false;
      }

      if (!q) return true;
      return (
        r.transaction_no.toLowerCase().includes(q) ||
        r.currencies?.code.toLowerCase().includes(q) ||
        (r.transaction_items && r.transaction_items.some((it) => it.currencies?.code.toLowerCase().includes(q))) ||
        r.customers?.full_name.toLowerCase().includes(q) ||
        r.customers?.customer_code.toLowerCase().includes(q) ||
        (r.branches?.name && r.branches.name.toLowerCase().includes(q)) ||
        (r.branches?.code && r.branches.code.toLowerCase().includes(q))
      );
    });
  }, [rows, search, filterType, filterStatus, isSuperAdmin, filterBranch, dateMode, customDate, startDate, endDate]);

  // Reset ke halaman 1 jika filter atau pencarian berubah
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterType, filterStatus, filterBranch, dateMode, customDate, startDate, endDate]);

  const totalRecords = filtered?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  // Ambil transaksi untuk halaman saat ini (10 transaksi per halaman secara default)
  const paginatedRows = useMemo(() => {
    if (!filtered) return null;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  // Generator nomor halaman dinamis dengan ellipsis
  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | "ellipsis-start" | "ellipsis-end")[] = [];
    if (currentPage <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push("ellipsis-end");
      pages.push(totalPages);
    } else if (currentPage >= totalPages - 3) {
      pages.push(1);
      pages.push("ellipsis-start");
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push("ellipsis-start");
      pages.push(currentPage - 1);
      pages.push(currentPage);
      pages.push(currentPage + 1);
      pages.push("ellipsis-end");
      pages.push(totalPages);
    }
    return pages;
  };

  const startIndex = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalRecords);

  const statLabels = useMemo(() => {
    switch (dateMode) {
      case "today":
        return {
          count: "Transaksi Hari Ini",
          buy: "Beli Valas Hari Ini",
          sell: "Jual Valas Hari Ini",
          net: "Net Position Hari Ini",
        };
      case "yesterday":
        return {
          count: "Transaksi Kemarin",
          buy: "Beli Valas Kemarin",
          sell: "Jual Valas Kemarin",
          net: "Net Position Kemarin",
        };
      case "this_month":
        return {
          count: "Transaksi Bulan Ini",
          buy: "Beli Valas Bulan Ini",
          sell: "Jual Valas Bulan Ini",
          net: "Net Position Bulan Ini",
        };
      case "custom_date":
        return {
          count: customDate ? `Transaksi (${customDate.split("-").reverse().join("/")})` : "Total Transaksi",
          buy: "Beli Valas",
          sell: "Jual Valas",
          net: "Net Position",
        };
      case "custom_range":
        return {
          count: "Transaksi Terfilter",
          buy: "Beli Valas Periode",
          sell: "Jual Valas Periode",
          net: "Net Position",
        };
      case "all":
      default:
        return {
          count: "Total Transaksi",
          buy: "Total Beli Valas",
          sell: "Total Jual Valas",
          net: "Net Position",
        };
    }
  }, [dateMode, customDate]);

  const stats = useMemo(() => {
    if (!filtered) return null;
    const t = filtered.filter((r) => r.status !== "voided");

    const getTrxTotalIdr = (r: Transaction) => {
      if (r.transaction_items && r.transaction_items.length > 0) {
        return r.transaction_items.reduce((acc, it) => acc + Number(it.idr_amount), 0);
      }
      return Number(r.idr_amount) || 0;
    };

    const buy = t
      .filter((r) => r.transaction_type === "buy")
      .reduce((a, r) => a + getTrxTotalIdr(r), 0);
    const sell = t
      .filter((r) => r.transaction_type === "sell")
      .reduce((a, r) => a + getTrxTotalIdr(r), 0);

    return { count: t.length, buy, sell, net: sell - buy };
  }, [filtered]);

  const viewingItems = useMemo(() => {
    if (!viewing) return [];
    if (viewing.transaction_items && viewing.transaction_items.length > 0) {
      return viewing.transaction_items.map((it) => ({
        currency: it.currencies?.code || viewing.currencies?.code || "-",
        foreign_amount: Number(it.foreign_amount),
        rate: Number(it.rate),
        idr_amount: Number(it.idr_amount),
      }));
    }
    return [
      {
        currency: viewing.currencies?.code ?? "-",
        foreign_amount: Number(viewing.foreign_amount),
        rate: Number(viewing.rate),
        idr_amount: Number(viewing.idr_amount),
      },
    ];
  }, [viewing]);

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
          <StatCard label={statLabels.count} value={String(stats.count)} />
          <StatCard
            label={statLabels.buy}
            value={fmtIDR(stats.buy)}
            tone="emerald"
          />
          <StatCard
            label={statLabels.sell}
            value={fmtIDR(stats.sell)}
            tone="blue"
          />
          <StatCard
            label={statLabels.net}
            value={fmtIDR(stats.net)}
            tone={stats.net >= 0 ? "emerald" : "red"}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari no transaksi, mata uang, nasabah…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {isSuperAdmin && (
          <Select
            value={filterBranch}
            onValueChange={(v) => {
              setFilterBranch(v);
              load(v, dateMode, customDate, startDate, endDate);
            }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Semua Cabang" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Cabang</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={dateMode}
          onValueChange={(v: DateFilterMode) => {
            setDateMode(v);
            if (v === "all" || v === "today" || v === "yesterday" || v === "this_month") {
              load(filterBranch, v, customDate, startDate, endDate);
            }
          }}
        >
          <SelectTrigger className="w-full sm:w-44">
            <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Tanggal</SelectItem>
            <SelectItem value="today">Hari Ini</SelectItem>
            <SelectItem value="yesterday">Kemarin</SelectItem>
            <SelectItem value="this_month">Bulan Ini</SelectItem>
            <SelectItem value="custom_date">Pilih Tanggal</SelectItem>
            <SelectItem value="custom_range">Rentang Tanggal</SelectItem>
          </SelectContent>
        </Select>

        {dateMode === "custom_date" && (
          <div className="flex items-center gap-1.5">
            <DatePickerInput
              value={customDate}
              placeholder="DD/MM/YYYY"
              onChange={(val) => {
                setCustomDate(val);
                load(filterBranch, "custom_date", val, startDate, endDate);
              }}
              className="w-full sm:w-36"
            />
          </div>
        )}

        {dateMode === "custom_range" && (
          <div className="flex items-center gap-1.5">
            <DatePickerInput
              value={startDate}
              placeholder="DD/MM/YYYY"
              onChange={(val) => {
                setStartDate(val);
                load(filterBranch, "custom_range", customDate, val, endDate);
              }}
              className="w-full sm:w-36"
            />
            <span className="text-xs text-muted-foreground">s/d</span>
            <DatePickerInput
              value={endDate}
              placeholder="DD/MM/YYYY"
              onChange={(val) => {
                setEndDate(val);
                load(filterBranch, "custom_range", customDate, startDate, val);
              }}
              className="w-full sm:w-36"
            />
          </div>
        )}

        {dateMode !== "all" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => {
              setDateMode("all");
              setCustomDate("");
              setStartDate("");
              setEndDate("");
              load(filterBranch, "all", "", "", "");
            }}
            title="Reset filter tanggal"
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        <Select
          value={filterType}
          onValueChange={(v) => setFilterType(v as "all" | TxType)}
        >
          <SelectTrigger className="w-full sm:w-36">
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
          <SelectTrigger className="w-full sm:w-36">
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
                paginatedRows?.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <div>{r.transaction_no}</div>
                      {isSuperAdmin && r.branches?.name && (
                        <div className="text-[10px] text-muted-foreground font-sans truncate max-w-[140px]">
                          {r.branches.name}
                        </div>
                      )}
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
                    <TableCell className="text-xs">
                      {r.transaction_items && r.transaction_items.length > 1 ? (
                        <div className="flex flex-col gap-1">
                          {r.transaction_items.map((it, idx) => (
                            <span key={it.id || idx} className="font-mono font-semibold">
                              {it.currencies?.code || "-"}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="font-mono font-semibold">
                          {r.transaction_items?.[0]?.currencies?.code || r.currencies?.code || "-"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.transaction_items && r.transaction_items.length > 1 ? (
                        <div className="flex flex-col gap-1">
                          {r.transaction_items.map((it, idx) => (
                            <span key={it.id || idx}>
                              {fmtNum(Number(it.foreign_amount))}
                            </span>
                          ))}
                        </div>
                      ) : (
                        fmtNum(Number(r.foreign_amount))
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.transaction_items && r.transaction_items.length > 1 ? (
                        <div className="flex flex-col gap-1">
                          {r.transaction_items.map((it, idx) => (
                            <span key={it.id || idx}>
                              {fmtNum(Number(it.rate), 2)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        fmtNum(Number(r.rate), 2)
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {fmtIDR(
                        r.transaction_items && r.transaction_items.length > 0
                          ? r.transaction_items.reduce((acc, it) => acc + Number(it.idr_amount), 0)
                          : Number(r.idr_amount)
                      )}
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
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setEditing(r)}
                              title="Edit transaksi"
                            >
                              <Pencil className="h-4 w-4 text-primary" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleting(r)}
                              title="Hapus transaksi"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* ── Dynamic Pagination Controls ── */}
          {filtered !== null && totalRecords > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t bg-card text-xs">
              <div className="flex items-center gap-3 text-muted-foreground">
                <span>
                  Menampilkan <span className="font-semibold text-foreground">{startIndex}–{endIndex}</span> dari{" "}
                  <span className="font-semibold text-foreground">{totalRecords}</span> transaksi
                </span>
                <div className="hidden sm:flex items-center gap-1.5 ml-2 border-l pl-3">
                  <span>Per halaman:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="h-7 w-[70px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  {/* Ke Halaman Pertama */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(1)}
                    title="Halaman Pertama"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>

                  {/* Halaman Sebelumnya */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 gap-1"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    title="Halaman Sebelumnya"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="hidden sm:inline">Prev</span>
                  </Button>

                  {/* Tombol Nomor Halaman Dinamis */}
                  <div className="flex items-center gap-1">
                    {getPageNumbers().map((p, idx) => {
                      if (p === "ellipsis-start" || p === "ellipsis-end") {
                        return (
                          <span
                            key={`ellipsis-${idx}`}
                            className="w-8 h-8 flex items-center justify-center text-muted-foreground select-none font-semibold"
                          >
                            …
                          </span>
                        );
                      }
                      const isCurrent = p === currentPage;
                      return (
                        <Button
                          key={p}
                          variant={isCurrent ? "default" : "outline"}
                          size="sm"
                          className={cn(
                            "h-8 w-8 p-0 font-medium",
                            isCurrent ? "pointer-events-none shadow-sm" : ""
                          )}
                          onClick={() => setCurrentPage(p as number)}
                        >
                          {p}
                        </Button>
                      );
                    })}
                  </div>

                  {/* Halaman Selanjutnya */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 gap-1"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    title="Halaman Selanjutnya"
                  >
                    <span className="hidden sm:inline">Next</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>

                  {/* Ke Halaman Terakhir */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(totalPages)}
                    title="Halaman Terakhir"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={`max-w-3xl max-h-[90vh] overflow-y-auto ${UPPERCASE_FORM}`}>
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

          <div className="flex flex-col gap-4">
            {/* Top row: Cabang & Metode Pembayaran */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cabang</Label>
                {roles.includes("teller") && !roles.includes("super_admin") ? (
                  <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground opacity-70">
                    {branches.find((b) => b.id === form.branch_id)?.code || "HQ"} — {branches.find((b) => b.id === form.branch_id)?.name || "Default"}
                  </div>
                ) : (
                  <Select
                    value={form.branch_id}
                    onValueChange={handleBranchChange}
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
            </div>

            {/* Nasabah Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Nasabah {requiresCDD && "*"}</Label>
                <Button 
                  type="button" 
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

            {/* Multiple Currency Items Section */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between border-b pb-2">
                <div>
                  <h4 className="text-sm font-semibold">Rincian Mata Uang ({form.items.length})</h4>
                  <p className="text-xs text-muted-foreground">
                    1 customer dapat menukarkan lebih dari 1 mata uang dalam 1 transaksi.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddItem}
                  className="gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Tambah Mata Uang
                </Button>
              </div>

              <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                {form.items.map((item, index) => {
                  const subtotal = Number((item.rate * item.foreign_amount).toFixed(2));
                  const selectedCurr = currencies.find((c) => c.id === item.currency_id);
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border bg-card p-3 shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted">
                          Baris #{index + 1}
                        </span>
                        {form.items.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => handleRemoveItem(index)}
                            title="Hapus baris ini"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Mata Uang *</Label>
                          <Select
                            value={item.currency_id}
                            onValueChange={(v) => handleItemCurrencyChange(index, v)}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Pilih valas" />
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

                        <div className="space-y-1">
                          <Label className="text-xs">
                            Nominal Valas ({selectedCurr?.code || "-"}) *
                          </Label>
                          <Input
                            type="text"
                            prefix={selectedCurr?.code}
                            className="h-9"
                            value={item.foreignInput}
                            onChange={(e) => handleItemForeignChange(index, e.target.value)}
                            onBlur={() => handleItemForeignBlur(index)}
                            placeholder="0"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Kurs (Rp) *</Label>
                          <Input
                            type="text"
                            prefix="Rp"
                            className="h-9"
                            value={item.rateInput}
                            onChange={(e) => handleItemRateChange(index, e.target.value)}
                            onBlur={() => handleItemRateBlur(index)}
                            placeholder="0"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t border-dashed">
                        <span className="text-muted-foreground">
                          Subtotal {selectedCurr?.code || "Valas"}:
                        </span>
                        <span className="font-mono font-semibold">
                          {fmtIDR(isNaN(subtotal) ? 0 : subtotal)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Grand Total Box */}
            <div className="rounded-xl bg-muted/40 p-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">
                  Grand Total {form.transaction_type === "buy" ? "Dibayar" : "Diterima"} (IDR)
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

            {/* Catatan */}
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
              <div className="space-y-2">
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

                {viewingItems.map((it, idx) => (
                  <div key={idx} className="flex justify-between items-baseline my-1">
                    <span>
                      {(it.currency ?? "-").toUpperCase()} {fmtNum(Number(it.foreign_amount), 2)}
                    </span>
                    <span>x {fmtNum(Number(it.rate), 2)} =</span>
                    <span>
                      {new Intl.NumberFormat("id-ID").format(
                        Math.round(Number(it.idr_amount)),
                      )}
                    </span>
                  </div>
                ))}
                <ThermalDivider />

                {/* Total */}
                <div className="flex justify-end gap-3 font-bold">
                  <span>TOTAL RP =</span>
                  <span>
                    {new Intl.NumberFormat("id-ID").format(
                      viewingItems.length > 0
                        ? viewingItems.reduce((acc, it) => acc + Math.round(Number(it.idr_amount)), 0)
                        : Math.round(Number(viewing.idr_amount)),
                    )}
                  </span>
                </div>
                <div className="mt-1 flex justify-between font-bold text-[11.5px]">
                  <span>(RP)</span>
                  <span>
                    {new Intl.NumberFormat("id-ID").format(
                      viewingItems.length > 0
                        ? viewingItems.reduce((acc, it) => acc + Math.round(Number(it.idr_amount)), 0)
                        : Math.round(Number(viewing.idr_amount)),
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

                <div className="mt-6 flex justify-between px-2 text-center text-[10px]">
                  <span>( {viewing.profiles?.full_name?.toUpperCase() || "TELLER"} )</span>
                  <span>( {viewing.customers?.full_name?.toUpperCase() || "CUSTOMER"} )</span>
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
                    items: viewingItems,
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
                    items: viewingItems,
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

      <EditTransactionDialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        transaction={editing}
        customers={customers}
        currencies={currencies}
        rates={rates}
        onReloadCustomers={load}
        onSaved={() => {
          load();
        }}
      />
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