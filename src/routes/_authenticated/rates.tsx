import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Pencil, Trash2, LineChart, History, Tv } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { MasterPageHeader } from "@/components/master-data/page-header";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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

export const Route = createFileRoute("/_authenticated/rates")({
  component: RatesPage,
});

interface Rate {
  id: string;
  currency_id: string;
  branch_id: string | null;
  buy_rate: number;
  sell_rate: number;
  effective_date: string;
  is_active: boolean;
  note: string | null;
  created_at: string;
  currencies?: { code: string; name: string } | null;
  branches?: { code: string; name: string } | null;
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

const HQ = "__hq__";
const ALL = "__all__";

const schema = z
  .object({
    currency_id: z.string().uuid("Pilih mata uang"),
    branch_id: z.string(),
    buy_rate: z.coerce.number().positive("Kurs beli > 0"),
    sell_rate: z.coerce.number().positive("Kurs jual > 0"),
    effective_date: z.string().min(1),
    is_active: z.boolean(),
    note: z.string().trim().max(255).optional().or(z.literal("")),
  })
  .refine((v) => v.sell_rate >= v.buy_rate, {
    path: ["sell_rate"],
    message: "Kurs jual harus ≥ kurs beli",
  });

type Form = z.infer<typeof schema>;

const today = () => new Date().toISOString().slice(0, 10);

const empty = (): Form => ({
  currency_id: "",
  branch_id: HQ,
  buy_rate: 0,
  sell_rate: 0,
  effective_date: today(),
  is_active: true,
  note: "",
});

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(n);

function RatesPage() {
  const { roles, profile } = useCurrentUser();
  const isTeller = roles.includes("teller") && !hasAnyRole(roles, ["super_admin", "owner", "branch_manager"]);
  const canWrite = hasAnyRole(roles, [
    "super_admin",
    "owner",
    "branch_manager",
    "teller",
  ]);

  const [rows, setRows] = useState<Rate[] | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyOpt[]>([]);
  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rate | null>(null);
  const [deleting, setDeleting] = useState<Rate | null>(null);
  const [form, setForm] = useState<Form>(empty());
  const [saving, setSaving] = useState(false);
  const [buyInput, setBuyInput] = useState("");
  const [sellInput, setSellInput] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>(ALL);
  const [multiBranches, setMultiBranches] = useState<string[]>([HQ]);

  async function load() {
    const [{ data: rateData, error }, { data: cur }, { data: br }] =
      await Promise.all([
        supabase
          .from("exchange_rates")
          .select(
            "*, currencies(code, name), branches(code, name)",
          )
          .order("effective_date", { ascending: false })
          .limit(200),
        supabase
          .from("currencies")
          .select("id, code, name")
          .eq("is_active", true)
          .order("code"),
        supabase
          .from("branches")
          .select("id, code, name")
          .eq("is_active", true)
          .order("name"),
      ]);
    if (error) {
      toast.error("Gagal memuat kurs", { description: error.message });
      return;
    }
    setRows(rateData ? (rateData as unknown as Rate[]) : []);
    setCurrencies((cur as CurrencyOpt[]) ?? []);
    setBranches((br as BranchOpt[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  const spread = useMemo(() => {
    if (!form.buy_rate || !form.sell_rate) return null;
    const s = form.sell_rate - form.buy_rate;
    const pct = (s / form.buy_rate) * 100;
    return { s, pct };
  }, [form.buy_rate, form.sell_rate]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    if (branchFilter === ALL) return rows;
    if (branchFilter === HQ) return rows.filter((r) => r.branch_id === null);
    return rows.filter((r) => r.branch_id === branchFilter);
  }, [rows, branchFilter]);

  // Pagination Kurs Valuta
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setCurrentPage(1);
  }, [branchFilter]);

  const paginatedRates = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  function openCreate() {
    setEditing(null);
    const tellerBranch = profile?.branch_id ?? HQ;
    setForm({
      ...empty(),
      branch_id: isTeller ? tellerBranch : (branchFilter === ALL ? HQ : branchFilter),
    });
    setBuyInput("");
    setSellInput("");
    const defaultBranch = isTeller
      ? tellerBranch
      : (profile?.branch_id ?? (branchFilter === ALL ? HQ : branchFilter));
    setMultiBranches([defaultBranch]);
    setOpen(true);
  }

  function openEdit(row: Rate) {
    if (isTeller && row.branch_id !== profile?.branch_id && (row.branch_id || profile?.branch_id)) {
      toast.error("Anda hanya dapat mengubah kurs pada cabang Anda.");
      return;
    }
    setEditing(row);
    const buyVal = Number(row.buy_rate);
    const sellVal = Number(row.sell_rate);
    setForm({
      currency_id: row.currency_id,
      branch_id: row.branch_id ?? HQ,
      buy_rate: buyVal,
      sell_rate: sellVal,
      effective_date: row.effective_date,
      is_active: row.is_active,
      note: row.note ?? "",
    });
    setBuyInput(new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(buyVal));
    setSellInput(new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sellVal));
    setMultiBranches([row.branch_id ?? HQ]);
    setOpen(true);
  }

  async function save() {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error("Data tidak valid", {
        description: parsed.error.issues[0]?.message,
      });
      return;
    }
    if (!editing && !isTeller && multiBranches.length === 0) {
      toast.error("Pilih minimal satu cabang tujuan");
      return;
    }
    setSaving(true);
    const targetBranches = isTeller ? [profile?.branch_id ?? HQ] : multiBranches;

    // Cek duplikasi kurs untuk mata uang yang sama pada cabang yang sama ATAU pada HQ/Default
    if (!editing) {
      for (const b of targetBranches) {
        const branchToCheck = b === HQ ? null : b;
        const duplicate = rows?.find(
          (r) =>
            r.currency_id === parsed.data.currency_id &&
            (r.branch_id === branchToCheck || r.branch_id === null),
        );
        if (duplicate) {
          const curObj = currencies.find((c) => c.id === parsed.data.currency_id);
          toast.error(`Kurs untuk mata uang ${curObj?.code || ""} sudah ada (di Cabang atau HQ/Default).`, {
            description: "Gunakan tombol Edit (Pensil) pada tabel jika ingin mengubah nilai kurs yang sudah ada.",
          });
          setSaving(false);
          return;
        }
      }
    }

    const base = {
      currency_id: parsed.data.currency_id,
      buy_rate: parsed.data.buy_rate,
      sell_rate: parsed.data.sell_rate,
      effective_date: parsed.data.effective_date,
      is_active: parsed.data.is_active,
      note: parsed.data.note || null,
    };
    const { error } = editing
      ? await supabase
          .from("exchange_rates")
          .update({
            ...base,
            branch_id:
              (isTeller ? (profile?.branch_id ?? null) : (parsed.data.branch_id === HQ ? null : parsed.data.branch_id)),
          })
          .eq("id", editing.id)
      : await supabase.from("exchange_rates").insert(
          targetBranches.map((b) => ({
            ...base,
            branch_id: b === HQ ? null : b,
          })),
        );
    setSaving(false);
    if (error) {
      toast.error("Gagal menyimpan", { description: error.message });
      return;
    }
    toast.success(
      editing
        ? "Kurs diperbarui"
        : `Kurs ditambahkan untuk ${targetBranches.length} cabang/target`,
    );
    setOpen(false);
    load();
  }

  async function remove() {
    if (!deleting) return;
    if (isTeller && deleting.branch_id !== profile?.branch_id) {
        toast.error("Anda tidak memiliki izin menghapus kurs ini.");
        return;
    }
    const { error } = await supabase
      .from("exchange_rates")
      .delete()
      .eq("id", deleting.id);
    setDeleting(null);
    if (error) {
      toast.error("Gagal menghapus", { description: error.message });
      return;
    }
    toast.success("Kurs dihapus");
    load();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <MasterPageHeader
          title="Kurs Valuta"
          description="Setiap cabang dapat memiliki kurs beli & jual sendiri. Jika cabang tidak memiliki kurs, transaksi memakai kurs HQ / Default."
          onAdd={openCreate}
          addLabel="Tambah Kurs"
          canWrite={canWrite}
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" asChild>
            <a href="/rate-board">
              <Tv className="h-4 w-4 text-blue-500" />
              Papan Kurs (TV)
            </a>
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <a href="/rates-history">
              <History className="h-4 w-4" />
              Riwayat Kurs
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-xs text-muted-foreground">Filter cabang:</Label>
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua cabang</SelectItem>
            <SelectItem value={HQ}>HQ / Default</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.code} — {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Mata Uang</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead className="text-right">Kurs Beli</TableHead>
                <TableHead className="text-right">Kurs Jual</TableHead>
                <TableHead className="text-right">Spread</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <LineChart className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Belum ada kurs yang dicatat.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRates.map((row) => {
                  const sp = Number(row.sell_rate) - Number(row.buy_rate);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-sm">
                        {row.effective_date}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono font-semibold">
                          {row.currencies?.code}
                        </span>
                        <span className="text-muted-foreground text-xs ml-2">
                          {row.currencies?.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        {row.branches ? (
                          <span>
                            <span className="font-mono text-xs">
                              {row.branches.code}
                            </span>{" "}
                            {row.branches.name}
                          </span>
                        ) : (
                          <Badge variant="outline">HQ / Default</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {fmt(Number(row.buy_rate))}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {fmt(Number(row.sell_rate))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {fmt(sp)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={row.is_active ? "default" : "secondary"}
                        >
                          {row.is_active ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canWrite && (!isTeller || (row.branch_id === profile?.branch_id) || (!row.branch_id && !profile?.branch_id)) && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(row)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleting(row)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {filteredRows.length > 0 && (
            <DataTablePagination
              currentPage={currentPage}
              pageSize={pageSize}
              totalRecords={filteredRows.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setCurrentPage(1);
              }}
              entityLabel="kurs"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Kurs" : "Tambah Kurs"}
            </DialogTitle>
            <DialogDescription>
              Kurs beli dan jual per mata uang, tanggal, dan cabang.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-1">
              <Label>Mata Uang *</Label>
              <Select
                value={form.currency_id}
                onValueChange={(v) => setForm({ ...form, currency_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih mata uang" />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => {
                    const branchToCheck = isTeller
                      ? (profile?.branch_id ?? null)
                      : (form.branch_id === HQ ? null : form.branch_id);
                    const alreadyExists =
                      !editing &&
                      rows?.some(
                        (r) =>
                          r.currency_id === c.id &&
                          (r.branch_id === branchToCheck || r.branch_id === null),
                      );
                    return (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                        disabled={alreadyExists}
                      >
                        {c.code} — {c.name}
                        {alreadyExists ? " (Sudah ada di HQ/Cabang)" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-1">
              <Label>Cabang</Label>
              {isTeller ? (
                <div>
                  <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground opacity-80 font-medium">
                    {branches.find((b) => b.id === (profile?.branch_id ?? form.branch_id))?.code || "HQ"} — {branches.find((b) => b.id === (profile?.branch_id ?? form.branch_id))?.name || "Kantor Pusat (HQ)"}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Terkunci sesuai cabang penugasan Anda.
                  </p>
                </div>
              ) : editing ? (
                <Select
                  value={form.branch_id}
                  onValueChange={(v) => setForm({ ...form, branch_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HQ}>HQ / Default (semua)</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="rounded-md border p-2 max-h-40 overflow-y-auto space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() =>
                        setMultiBranches([HQ, ...branches.map((b) => b.id)])
                      }
                    >
                      Pilih semua
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setMultiBranches([])}
                    >
                      Kosongkan
                    </button>
                  </div>
                  {[{ id: HQ, code: "HQ", name: "Default (fallback semua cabang)" }, ...branches].map(
                    (b) => {
                      const checked = multiBranches.includes(b.id);
                      return (
                        <label
                          key={b.id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setMultiBranches((prev) =>
                                v
                                  ? [...prev, b.id]
                                  : prev.filter((x) => x !== b.id),
                              );
                            }}
                          />
                          <span className="font-mono text-xs">{b.code}</span>
                          <span className="text-muted-foreground">
                            {b.name}
                          </span>
                        </label>
                      );
                    },
                  )}
                </div>
              )}
              {!editing && !isTeller && (
                <p className="text-xs text-muted-foreground">
                  Kurs akan dibuat terpisah untuk tiap cabang yang dipilih.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Kurs Beli *</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">Rp</span>
                <Input
                  type="text"
                  className="pl-9"
                  value={buyInput}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^\d,\.]/g, "");
                    setBuyInput(val);
                    const normalized = val.replace(/\./g, "").replace(",", ".");
                    const num = parseFloat(normalized) || 0;
                    setForm({ ...form, buy_rate: num });
                  }}
                  onBlur={() => {
                    if (form.buy_rate > 0) {
                      setBuyInput(
                        new Intl.NumberFormat("id-ID", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }).format(form.buy_rate)
                      );
                    }
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Kurs Jual *</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">Rp</span>
                <Input
                  type="text"
                  className="pl-9"
                  value={sellInput}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^\d,\.]/g, "");
                    setSellInput(val);
                    const normalized = val.replace(/\./g, "").replace(",", ".");
                    const num = parseFloat(normalized) || 0;
                    setForm({ ...form, sell_rate: num });
                  }}
                  onBlur={() => {
                    if (form.sell_rate > 0) {
                      setSellInput(
                        new Intl.NumberFormat("id-ID", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }).format(form.sell_rate)
                      );
                    }
                  }}
                />
              </div>
            </div>
            {spread && (
              <div className="col-span-2 text-xs text-muted-foreground">
                Spread: <span className="font-mono">{fmt(spread.s)}</span> (
                {spread.pct.toFixed(2)}%)
              </div>
            )}
            <div className="space-y-2 col-span-1">
              <Label>Tanggal Efektif *</Label>
              <Input
                type="date"
                value={form.effective_date}
                onChange={(e) =>
                  setForm({ ...form, effective_date: e.target.value })
                }
              />
            </div>
            <div className="flex items-center gap-3 col-span-1 pt-6">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                id="rate-active"
              />
              <Label htmlFor="rate-active" className="cursor-pointer">
                Aktif
              </Label>
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Catatan</Label>
              <Input
                value={form.note ?? ""}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                maxLength={255}
                placeholder="Opsional"
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

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus kurs?</AlertDialogTitle>
            <AlertDialogDescription>
              Baris kurs ini akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}