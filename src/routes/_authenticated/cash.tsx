import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Banknote,
  ArrowDownCircle,
  ArrowUpCircle,
  Scale,
  Wallet,
  Coins,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { MasterPageHeader } from "@/components/master-data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrencyFlagUrl, getCurrencyInfo } from "@/lib/currency-flags";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/cash")({
  component: CashPage,
});

interface Branch {
  id: string;
  code: string;
  name: string;
  is_head_office?: boolean;
}
interface Currency {
  id: string;
  code: string;
  name: string;
  decimals: number;
}
interface Balance {
  id: string;
  branch_id: string;
  currency_id: string;
  balance: number;
  updated_at: string;
  currencies?: Currency | null;
  branches?: { code: string; name: string } | null;
}
interface Movement {
  id: string;
  branch_id: string;
  currency_id: string;
  movement_type: string;
  amount: number;
  balance_after: number | null;
  reference_no: string | null;
  reference_id?: string | null;
  notes: string | null;
  created_at: string;
  currencies?: { code: string } | null;
  branches?: { code: string; name: string } | null;
}
interface BranchTransferInfo {
  id: string;
  branch_id: string;
  target_branch_id: string | null;
  currency_id: string;
  amount: number;
  status: string;
  notes: string | null;
  created_at: string;
  branch?: { code: string; name: string } | null;
  target_branch?: { code: string; name: string } | null;
}

type MovementKind = "deposit" | "withdrawal" | "adjustment" | "opening";

const KIND_LABEL: Record<string, string> = {
  opening: "Saldo Awal",
  deposit: "Setoran Kas",
  withdrawal: "Pengeluaran Kas",
  adjustment: "Penyesuaian",
  buy: "Transaksi Beli",
  sell: "Transaksi Jual",
  transfer_in: "Transfer Masuk",
  transfer_out: "Transfer Keluar",
};

const movementSchema = z.object({
  branch_id: z.string().uuid("Pilih cabang"),
  currency_id: z.string().uuid("Pilih mata uang"),
  kind: z.enum(["deposit", "withdrawal", "adjustment", "opening"]),
  amount: z.number().positive("Nominal harus > 0"),
  notes: z.string().max(500).optional(),
});

function fmt(n: number, decimals = 2) {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: decimals === 0 ? 0 : 2,
    maximumFractionDigits: decimals,
  }).format(n);
}

function CashPage() {
  const { roles, user, profile } = useCurrentUser();
  const isSuperAdmin = hasAnyRole(roles, ["super_admin", "owner"]);
  const canWrite = hasAnyRole(roles, [
    "super_admin",
    "branch_manager",
    "teller",
    "owner",
  ]);
  const isTellerOnly =
    roles.length > 0 &&
    roles.every((r) => r === "teller");
  const lockedBranchId = isTellerOnly ? profile?.branch_id ?? null : null;

  const [branches, setBranches] = useState<Branch[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [transfers, setTransfers] = useState<BranchTransferInfo[]>([]);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    branch_id: "",
    currency_id: "",
    kind: "deposit" as MovementKind,
    amount: "",
    notes: "",
  });

  // State untuk Permintaan Modal Cabang ke Kantor Pusat
  const [capitalReqOpen, setCapitalReqOpen] = useState(false);
  const [reqAmount, setReqAmount] = useState("");
  const [reqNotes, setReqNotes] = useState("");
  const [reqSaving, setReqSaving] = useState(false);

  // Pagination Mutasi Terbaru
  const [movPage, setMovPage] = useState(1);
  const MOV_PER_PAGE = 10;

  async function loadRefs() {
    let branchQ = supabase
      .from("branches")
      .select("id, code, name, is_head_office")
      .eq("is_active", true)
      .order("code");
    if (lockedBranchId) branchQ = branchQ.eq("id", lockedBranchId);
    const [{ data: b }, { data: c }] = await Promise.all([
      branchQ,
      supabase
        .from("currencies")
        .select("id, code, name, decimals")
        .eq("is_active", true)
        .order("code"),
    ]);
    setBranches((b as Branch[]) ?? []);
    setCurrencies((c as Currency[]) ?? []);
    if (lockedBranchId) {
      setBranchId(lockedBranchId);
    } else if (!branchId && b && b.length > 0) {
      setBranchId(b[0].id);
    }
  }

  async function loadData(bId: string) {
    setBalances(null);
    setMovements(null);
    const isAll = !lockedBranchId && (bId === "__all__" || !bId);
    let balQ = supabase
      .from("cash_balances")
      .select("*, currencies(id, code, name, decimals), branches(code, name)");
    let mvQ = supabase
      .from("cash_movements")
      .select("*, currencies(code), branches(code, name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!isAll) {
      balQ = balQ.eq("branch_id", bId);
      mvQ = mvQ.eq("branch_id", bId);
    }
    const [
      { data: bal, error: e1 },
      { data: mv, error: e2 },
      { data: trfs, error: e3 },
    ] = await Promise.all([
      balQ,
      mvQ,
      supabase
        .from("branch_transfers")
        .select(
          "id, branch_id, target_branch_id, currency_id, amount, status, notes, created_at, branch:branches!branch_transfers_branch_id_fkey(code, name), target_branch:branches!branch_transfers_target_branch_id_fkey(code, name)",
        )
        .eq("status", "accepted"),
    ]);
    if (e1) toast.error("Gagal memuat saldo", { description: e1.message });
    if (e2) toast.error("Gagal memuat mutasi", { description: e2.message });
    setBalances((bal as Balance[]) ?? []);
    setMovements((mv as Movement[]) ?? []);
    setTransfers((trfs as unknown as BranchTransferInfo[]) ?? []);
    setMovPage(1); // reset halaman saat cabang berganti
  }

  useEffect(() => {
    loadRefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedBranchId]);

  useEffect(() => {
    if (branchId) loadData(branchId);
  }, [branchId]);

  const transferSources = useMemo(() => {
    const map = new Map<string, string[]>();
    transfers.forEach((t) => {
      if (t.target_branch_id && t.branch?.name) {
        const key = `${t.target_branch_id}_${t.currency_id}`;
        const existing = map.get(key) ?? [];
        if (!existing.includes(t.branch.name)) {
          existing.push(t.branch.name);
        }
        map.set(key, existing);
      }
    });
    return map;
  }, [transfers]);

  function openCreate() {
    setForm({
      branch_id: branchId,
      currency_id: "",
      kind: "deposit",
      amount: "",
      notes: "",
    });
    setOpen(true);
  }

  async function save() {
    const parsed = movementSchema.safeParse({
      branch_id: form.branch_id,
      currency_id: form.currency_id,
      kind: form.kind,
      amount: Number(form.amount),
      notes: form.notes,
    });
    if (!parsed.success) {
      toast.error("Data tidak valid", {
        description: parsed.error.issues[0]?.message,
      });
      return;
    }
    setSaving(true);
    const { kind, amount } = parsed.data;
    const signed =
      kind === "withdrawal" ? -Math.abs(amount) : Math.abs(amount);

    const { error } = await supabase.from("cash_movements").insert({
      branch_id: parsed.data.branch_id,
      currency_id: parsed.data.currency_id,
      movement_type: kind,
      amount: signed,
      notes: parsed.data.notes || null,
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) {
      toast.error("Gagal menyimpan mutasi", { description: error.message });
      return;
    }
    toast.success("Mutasi kas dicatat");
    setOpen(false);
    loadData(branchId);
  }

  async function submitCapitalRequest() {
    const targetBId = lockedBranchId ?? (branchId === "__all__" ? (branches[0]?.id ?? "") : branchId);
    if (!targetBId) {
      toast.error("Pilih cabang pemohon modal");
      return;
    }
    const amt = Number(reqAmount.replace(/[^\d]/g, "")) || 0;
    if (amt <= 0) {
      toast.error("Nominal permintaan modal wajib diisi");
      return;
    }

    const idrCur = currencies.find((c) => c.code.toUpperCase() === "IDR");
    const hqBranch =
      branches.find(
        (b) =>
          b.is_head_office ||
          (b as any).is_hq ||
          b.name.toLowerCase().includes("pusat") ||
          b.name.toLowerCase().includes("jimbaran"),
      ) || branches[0];

    if (!idrCur || !hqBranch) {
      toast.error("Konfigurasi mata uang IDR atau Kantor Pusat tidak ditemukan");
      return;
    }

    setReqSaving(true);
    const requestingBranch = branches.find((b) => b.id === targetBId);
    const { error } = await supabase.from("branch_transfers").insert({
      branch_id: hqBranch.id, // Sumber: Kantor Pusat
      target_branch_id: targetBId, // Tujuan: Cabang pemohon
      currency_id: idrCur.id,
      amount: amt,
      status: "pending",
      notes: `Permintaan tambahan modal tengah shif: ${reqNotes || "Tambahan modal operasional kas"} (${requestingBranch?.name || "Cabang"})`,
    });
    setReqSaving(false);

    if (error) {
      toast.error("Gagal mengirim permintaan modal: " + error.message);
      return;
    }

    toast.success("Permintaan modal dikirim ke Kantor Pusat", {
      description: `Nominal Rp ${fmt(amt, 0)} menunggu persetujuan Super Admin.`,
    });
    setCapitalReqOpen(false);
    setReqAmount("");
    setReqNotes("");
  }

  const activeBranch = branches.find(
    (b) => b.id === (branchId === "__all__" ? (lockedBranchId ?? "") : branchId),
  );
  const isHeadOffice = Boolean(
    activeBranch &&
      (activeBranch.is_head_office ||
        (activeBranch as any).is_hq ||
        activeBranch.name.toLowerCase().includes("pusat") ||
        activeBranch.name.toLowerCase().includes("jimbaran")),
  );

  // Tombol "Catat Mutasi" HANYA muncul untuk Super Admin / Kantor Pusat
  const showCatatMutasi = (isSuperAdmin || isHeadOffice) && branches.length > 0;
  // Tombol "Permintaan Modal" muncul untuk Cabang (non-HQ)
  const showPermintaanModal = canWrite && !isHeadOffice && branches.length > 0;

  // Tampilkan Rekap Valas Siap Jual hanya untuk super_admin / owner / teller Jimbaran (HQ)
  const showValasSummary =
    isSuperAdmin ||
    (hasAnyRole(roles, ["teller"]) && isHeadOffice);

  const totals = useMemo(() => {
    if (!balances) return { currencies: 0, idrEquiv: 0, valasSummary: [] as { code: string; name: string; balance: number; decimals: number }[] };
    const valasSummary = balances
      .filter((b) => b.currencies?.code !== "IDR" && (b.balance ?? 0) > 0)
      .map((b) => ({
        code: b.currencies?.code ?? "?",
        name: b.currencies?.name ?? "",
        balance: b.balance,
        decimals: b.currencies?.decimals ?? 2,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      currencies: balances.filter((b) => (b.balance ?? 0) !== 0).length,
      idrEquiv:
        balances.find((b) => b.currencies?.code === "IDR")?.balance ?? 0,
      valasSummary,
    };
  }, [balances]);

  // Pagination valas siap jual (computed)
  const pagedMovements = useMemo(() => {
    if (!movements) return [];
    const start = (movPage - 1) * MOV_PER_PAGE;
    return movements.slice(start, start + MOV_PER_PAGE);
  }, [movements, movPage, MOV_PER_PAGE]);
  const totalMovPages = movements ? Math.ceil(movements.length / MOV_PER_PAGE) : 1;



  return (
    <div className="flex flex-col gap-6 p-6">
      <MasterPageHeader
        title="Kas & Inventaris"
        description="Pantau saldo kas per mata uang di tiap cabang dan kelola modal kas operasional."
        onAdd={openCreate}
        addLabel="Catat Mutasi"
        canWrite={showCatatMutasi}
        extra={
          <div className="flex items-center gap-2">
            {showPermintaanModal && (
              <Button
                onClick={() => setCapitalReqOpen(true)}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              >
                <ArrowUpCircle className="h-4 w-4" /> Permintaan Modal
              </Button>
            )}
            <Select
              value={branchId}
              onValueChange={setBranchId}
              disabled={!!lockedBranchId}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Pilih cabang" />
              </SelectTrigger>
              <SelectContent>
                {!lockedBranchId && (
                  <SelectItem value="__all__">Semua Cabang</SelectItem>
                )}
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Saldo Rupiah</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              Rp {fmt(totals.idrEquiv, 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Kas rupiah di cabang ini
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Mata Uang Aktif
            </CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.currencies}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Mata uang dengan saldo tidak nol
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Total Mutasi
            </CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {movements?.length ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Total mutasi tercatat di cabang ini
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ============================================================
          Rekap Valas Siap Jual — hanya untuk super_admin / teller HQ
          ============================================================ */}
      {showValasSummary && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <Coins className="h-5 w-5 text-amber-500" />
            <CardTitle>Rekap Valas Siap Jual</CardTitle>
            <span className="ml-auto text-xs text-muted-foreground">
              Stok mata uang asing dengan saldo &gt; 0
            </span>
          </CardHeader>
          <CardContent>
            {balances === null ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-xl" />
                ))}
              </div>
            ) : totals.valasSummary.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm">Tidak ada valas yang tersedia untuk dijual saat ini.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {totals.valasSummary.map((v) => {
                  const flagUrl = getCurrencyFlagUrl(v.code);
                  return (
                    <div
                      key={v.code}
                      className="flex flex-col items-center justify-between gap-2 rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <img
                          src={flagUrl}
                          alt={v.code}
                          className="h-5 w-7 rounded-sm object-cover shadow-sm flex-shrink-0"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <div className="flex flex-col leading-tight">
                          <span className="font-bold text-base font-mono">{v.code}</span>
                          <span className="text-[10px] text-muted-foreground line-clamp-1">{v.name}</span>
                        </div>
                      </div>
                      <div className="w-full flex items-center justify-between mt-1">
                        <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50 gap-1 text-xs font-mono px-2 py-0.5">
                          <CheckCircle2 className="h-3 w-3" />
                          Siap Jual
                        </Badge>
                      </div>
                      <div className="w-full text-right">
                        <span className="text-lg font-bold font-mono tabular-nums">
                          {fmt(v.balance, v.decimals)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Saldo per Mata Uang</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Terakhir Diperbarui</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances === null ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : balances.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12">
                    <Banknote className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Belum ada saldo. Catat saldo awal untuk memulai.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                balances
                  .slice()
                  .sort((a, b) =>
                    (a.currencies?.code ?? "").localeCompare(
                      b.currencies?.code ?? "",
                    ),
                  )
                  .map((b) => {
                    const srcBranches = transferSources.get(
                      `${b.branch_id}_${b.currency_id}`,
                    );
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono font-semibold">
                          {b.currencies?.code}
                        </TableCell>
                        <TableCell>{b.currencies?.name}</TableCell>
                        <TableCell className="text-xs">
                          {srcBranches && srcBranches.length > 0 ? (
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">
                                {srcBranches.join(", ")}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                ➔ {b.branches?.name ?? "Kantor Pusat"}
                              </span>
                            </div>
                          ) : b.branches ? (
                            `${b.branches.code} — ${b.branches.name}`
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${b.balance < 0 ? "text-destructive" : ""}`}
                        >
                          {fmt(b.balance, b.currencies?.decimals ?? 2)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(b.updated_at).toLocaleString("id-ID")}
                        </TableCell>
                      </TableRow>
                    );
                  })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Mutasi Terbaru</CardTitle>
          {movements !== null && movements.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {(movPage - 1) * MOV_PER_PAGE + 1}–{Math.min(movPage * MOV_PER_PAGE, movements.length)} dari {movements.length} mutasi
            </span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Mata Uang</TableHead>
                <TableHead className="text-right">Nominal</TableHead>
                <TableHead className="text-right">Saldo Setelah</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements === null ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <p className="text-sm text-muted-foreground">
                      Belum ada mutasi kas.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                pagedMovements.map((m) => {
                  const isIn = m.amount >= 0;

                  // Tentukan nama cabang asal / tujuan transfer secara akurat
                  let sourceBranchLabel = m.branches ? `${m.branches.code}` : "—";
                  let isTransferIn = m.movement_type === "transfer_in";
                  let isTransferOut = m.movement_type === "transfer_out";

                  if (isTransferIn) {
                    const matchedTrf = transfers.find(
                      (t) =>
                        t.id === m.reference_id ||
                        t.id === m.reference_no ||
                        (m.reference_no && m.reference_no.includes(t.id)),
                    );
                    if (matchedTrf?.branch?.name) {
                      sourceBranchLabel = matchedTrf.branch.name;
                    } else if (m.notes && m.notes.toLowerCase().includes("dari")) {
                      const extracted = m.notes
                        .replace(/^.*dari\s+/i, "")
                        .split(/[\(\[\,\.]/)[0]
                        .trim();
                      if (extracted) sourceBranchLabel = extracted;
                    }
                  } else if (isTransferOut) {
                    const matchedTrf = transfers.find(
                      (t) =>
                        t.id === m.reference_id ||
                        t.id === m.reference_no ||
                        (m.reference_no && m.reference_no.includes(t.id)),
                    );
                    if (matchedTrf?.target_branch?.name) {
                      sourceBranchLabel = `${m.branches?.code ?? "Cabang"} ➔ ${matchedTrf.target_branch.name}`;
                    }
                  }

                  const cleanRefNo =
                    m.reference_no &&
                    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                      m.reference_no,
                    )
                      ? `[${m.reference_no}] `
                      : "";
                  const cleanNote = (m.notes ?? "—").replace(
                    /^\[[0-9a-f-]{36}\]\s*/i,
                    "",
                  );

                  return (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(m.created_at).toLocaleString("id-ID")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {isTransferIn ? (
                          <div className="flex flex-col">
                            <span className="font-semibold text-primary">
                              {sourceBranchLabel}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              ➔ {m.branches?.code ?? "HQ"}
                            </span>
                          </div>
                        ) : (
                          <span>{sourceBranchLabel}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={isIn ? "default" : "secondary"}
                          className="gap-1"
                        >
                          {isIn ? (
                            <ArrowDownCircle className="h-3 w-3" />
                          ) : (
                            <ArrowUpCircle className="h-3 w-3" />
                          )}
                          {KIND_LABEL[m.movement_type] ?? m.movement_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        {m.currencies?.code}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${isIn ? "text-emerald-600" : "text-destructive"}`}
                      >
                        {isIn ? "+" : ""}
                        {fmt(m.amount, 2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {m.balance_after !== null
                          ? fmt(m.balance_after, 2)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate" title={cleanNote}>
                        {cleanRefNo}{cleanNote}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {/* ── Pagination Controls ── */}
          {movements !== null && totalMovPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                Halaman <span className="font-semibold">{movPage}</span> dari <span className="font-semibold">{totalMovPages}</span>
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={movPage === 1}
                  onClick={() => setMovPage(1)}
                  title="Halaman pertama"
                >
                  «
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={movPage === 1}
                  onClick={() => setMovPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={movPage === totalMovPages}
                  onClick={() => setMovPage((p) => Math.min(totalMovPages, p + 1))}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={movPage === totalMovPages}
                  onClick={() => setMovPage(totalMovPages)}
                  title="Halaman terakhir"
                >
                  »
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Catat Mutasi Kas</DialogTitle>
            <DialogDescription>
              Setoran menambah saldo, pengeluaran mengurangi saldo. Penyesuaian
              & saldo awal bertanda positif.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>Cabang *</Label>
              <Select
                value={form.branch_id}
                onValueChange={(v) => setForm({ ...form, branch_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih cabang" />
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
            <div className="space-y-2">
              <Label>Jenis Mutasi *</Label>
              <Select
                value={form.kind}
                onValueChange={(v) =>
                  setForm({ ...form, kind: v as MovementKind })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opening">Saldo Awal (+)</SelectItem>
                  <SelectItem value="deposit">Setoran Kas (+)</SelectItem>
                  <SelectItem value="withdrawal">
                    Pengeluaran Kas (−)
                  </SelectItem>
                  <SelectItem value="adjustment">Penyesuaian (+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
            <div className="space-y-2 col-span-2">
              <Label>Nominal *</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Catatan</Label>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="mis. Setoran modal awal, biaya operasional, dsb."
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Permintaan Tambahan Modal Cabang ke Kantor Pusat */}
      <Dialog open={capitalReqOpen} onOpenChange={setCapitalReqOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpCircle className="h-5 w-5 text-emerald-600" /> Permintaan Tambahan Modal
            </DialogTitle>
            <DialogDescription>
              Ajukan permohonan penambahan modal kas Rupiah (IDR) ke Kantor Pusat / Super Admin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cabang Pemohon</Label>
              <Input
                value={
                  branches.find(
                    (b) =>
                      b.id ===
                      (lockedBranchId ??
                        (branchId === "__all__" ? branches[0]?.id : branchId)),
                  )?.name ?? "Cabang"
                }
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label>Nominal Modal Diminta (IDR) <span className="text-destructive">*</span></Label>
              <Input
                type="text"
                inputMode="numeric"
                prefix="Rp"
                placeholder="Contoh: 50.000.000"
                value={
                  reqAmount
                    ? fmt(Number(reqAmount.replace(/[^\d]/g, "")), 0)
                    : ""
                }
                onChange={(e) => {
                  const val = e.target.value.replace(/[^\d]/g, "");
                  setReqAmount(val);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Permintaan ini akan otomatis masuk ke daftar persetujuan Super Admin.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Alasan / Kebutuhan (opsional)</Label>
              <Textarea
                rows={3}
                placeholder="Contoh: Kas IDR menipis karena banyak nasabah jual valas hari ini..."
                value={reqNotes}
                onChange={(e) => setReqNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCapitalReqOpen(false)}
              disabled={reqSaving}
            >
              Batal
            </Button>
            <Button
              onClick={submitCapitalRequest}
              disabled={reqSaving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {reqSaving ? "Mengirim..." : "Kirim Permintaan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}