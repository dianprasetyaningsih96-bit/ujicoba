import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Clock, LogIn, LogOut, Play, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { useAppSettings } from "@/hooks/use-app-settings";
import { MasterPageHeader } from "@/components/master-data/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/shifts")({
  component: ShiftsPage,
});

type ShiftType = "pagi" | "siang";
type ShiftStatus = "open" | "closed";

interface ShiftRow {
  id: string;
  branch_id: string;
  user_id: string;
  shift_type: ShiftType;
  status: ShiftStatus;
  opening_capital: number;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  branch?: { name: string } | null;
  user?: { full_name: string | null; email: string | null } | null;
}

interface Currency {
  id: string;
  code: string;
  name: string;
  decimals: number;
}

interface Branch { id: string; name: string; code: string }

function formatIDR(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDateTime(s: string | null) {
  if (!s) return "-";
  return new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function ShiftsPage() {
  const { user, profile, roles } = useCurrentUser();
  const { settings } = useAppSettings();
  const isManager = hasAnyRole(roles, ["super_admin", "branch_manager", "owner"]);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [myOpenShift, setMyOpenShift] = useState<ShiftRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState<ShiftRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [b, c, s] = await Promise.all([
      supabase.from("branches").select("id, name, code").eq("is_active", true).order("name"),
      supabase.from("currencies").select("id, code, name, decimals").eq("is_active", true).order("code"),
      (() => {
        let query = supabase
          .from("shifts")
          .select("id, branch_id, user_id, shift_type, status, opening_capital, opened_at, closed_at, notes, branch:branches(name)")
          .order("opened_at", { ascending: false })
          .limit(100);
        
        // Filter by branch if not super_admin
        const isSuperAdmin = roles.includes("super_admin");
        if (!isSuperAdmin && profile?.branch_id) {
          query = query.eq("branch_id", profile.branch_id);
        }
        
        return query;
      })(),
    ]);
    if (s.error) {
      toast.error("Gagal memuat shif: " + s.error.message);
    }
    setBranches((b.data as Branch[]) ?? []);
    setCurrencies((c.data as Currency[]) ?? []);
    let rows = (s.data as unknown as ShiftRow[]) ?? [];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      const map = new Map<string, { full_name: string | null; email: string | null }>();
      (profs ?? []).forEach((p: { id: string; full_name: string | null; email: string | null }) =>
        map.set(p.id, { full_name: p.full_name, email: p.email }),
      );
      rows = rows.map((r) => ({ ...r, user: map.get(r.user_id) ?? null }));
    }
    setShifts(rows);
    setMyOpenShift(rows.find((r) => r.user_id === user?.id && r.status === "open") ?? null);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { if (user?.id) load(); }, [user?.id, load]);

  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Shif Kerja"
        description={`Jam operasional (WITA) — Pagi ${settings.shift_pagi_start}–${settings.shift_pagi_end} · Siang ${settings.shift_siang_start}–${settings.shift_siang_end}`}
        canWrite={!myOpenShift}
        onAdd={() => setOpenDialog(true)}
        addLabel="Buka Shif"
      />

      {myOpenShift && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4" />
                  Shif Aktif Anda — {myOpenShift.shift_type === "pagi" ? "Pagi" : "Siang/Sore"}
                </CardTitle>
                <CardDescription>
                  Dibuka {formatDateTime(myOpenShift.opened_at)}
                  {myOpenShift.opening_capital > 0 && (
                    <> · Modal awal: <b>{formatIDR(myOpenShift.opening_capital)}</b></>
                  )}
                </CardDescription>
              </div>
              <Button variant="destructive" onClick={() => setCloseDialog(myOpenShift)} className="gap-2">
                <LogOut className="h-4 w-4" /> Tutup Shif
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Shif</CardTitle>
          <CardDescription>
            {roles.includes("super_admin") 
              ? "100 shif terakhir dari seluruh cabang" 
              : "100 shif terakhir dari cabang Anda"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Petugas</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Shif</TableHead>
                <TableHead>Buka</TableHead>
                <TableHead>Tutup</TableHead>
                <TableHead className="text-right">Modal Awal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Memuat…</TableCell></TableRow>
              ) : shifts.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Belum ada shif</TableCell></TableRow>
              ) : shifts.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.user?.full_name || s.user?.email || "—"}</TableCell>
                  <TableCell>{s.branch?.name ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{s.shift_type === "pagi" ? "Pagi" : "Siang/Sore"}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(s.opened_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(s.closed_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.opening_capital > 0 ? formatIDR(s.opening_capital) : "—"}</TableCell>
                  <TableCell>
                    {s.status === "open" ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">Terbuka</Badge>
                    ) : (
                      <Badge variant="secondary">Tertutup</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.status === "open" && (s.user_id === user?.id || isManager) && (
                      <Button size="sm" variant="outline" onClick={() => setCloseDialog(s)} className="gap-1">
                        <Square className="h-3 w-3" /> Tutup
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {openDialog && (
        <OpenShiftDialog
          onClose={() => setOpenDialog(false)}
          onSaved={() => { setOpenDialog(false); load(); }}
          branches={branches}
          currencies={currencies}
          defaultBranchId={profile?.branch_id ?? null}
          userId={user?.id ?? ""}
          lockBranch={!isManager}
        />
      )}

      {closeDialog && (
        <CloseShiftDialog
          shift={closeDialog}
          currencies={currencies}
          onClose={() => setCloseDialog(null)}
          onSaved={() => { setCloseDialog(null); load(); }}
          userId={user?.id ?? ""}
        />
      )}
    </div>
  );
}

interface PrevShiftInfo {
  idrAmount: number;
  source: "reconciliation" | "cash_balance";
  shiftTime?: string | null;
  foreignCurrencies?: { code: string; amount: number }[];
}

function OpenShiftDialog({
  onClose, onSaved, branches, currencies, defaultBranchId, userId, lockBranch,
}: {
  onClose: () => void; onSaved: () => void;
  branches: Branch[]; currencies: Currency[]; defaultBranchId: string | null; userId: string;
  lockBranch: boolean;
}) {
  const [branchId, setBranchId] = useState<string>(defaultBranchId ?? (lockBranch ? "" : branches[0]?.id ?? ""));
  const [shiftType, setShiftType] = useState<ShiftType>("pagi");
  const [openingCapital, setOpeningCapital] = useState<string>("");
  const [additionalCapital, setAdditionalCapital] = useState<string>("");
  const [requestedCapital, setRequestedCapital] = useState<string>("");
  const [prevInfo, setPrevInfo] = useState<PrevShiftInfo | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [branchOpenShifts, setBranchOpenShifts] = useState<{ morningOpen: boolean; afternoonOpen: boolean }>({
    morningOpen: false,
    afternoonOpen: false,
  });

  useEffect(() => {
    if (!branchId && !lockBranch && branches.length) setBranchId(branches[0].id);
  }, [branches, branchId, lockBranch]);

  // Cek apakah ada shif yang sedang terbuka di cabang ini untuk mendisable opsi shif
  useEffect(() => {
    if (branchId) {
      (async () => {
        try {
          const { data: openShifts } = await supabase
            .from("shifts")
            .select("shift_type, status")
            .eq("branch_id", branchId)
            .eq("status", "open");

          const morningOpen = Boolean(openShifts?.some((s) => s.shift_type === "pagi"));
          const afternoonOpen = Boolean(openShifts?.some((s) => s.shift_type === "siang"));
          
          setBranchOpenShifts({ morningOpen, afternoonOpen });

          if (morningOpen && !afternoonOpen) {
            setShiftType("siang");
          }
        } catch (err) {
          console.warn("Failed checking open shifts:", err);
        }
      })();
    }
  }, [branchId]);

  const assignedBranch = branches.find((b) => b.id === branchId) ?? branches.find((b) => b.id === defaultBranchId);
  const isHq = Boolean(
    assignedBranch &&
    ((assignedBranch as any).is_head_office ||
      (assignedBranch as any).is_hq ||
      assignedBranch.name.toLowerCase().includes("pusat") ||
      assignedBranch.name.toLowerCase().includes("jimbaran"))
  );

  useEffect(() => {
    // Cari riwayat saldo:
    // 1. Jika Shif Siang di Cabang manapun (serah terima shif pagi)
    // 2. Jika Shif Pagi di Kantor Pusat / Jimbaran (sisa saldo penutupan hari kemarin / carry over)
    const shouldFetchPrev = (shiftType === "siang") || (isHq && shiftType === "pagi");

    if (shouldFetchPrev && branchId) {
      (async () => {
        setLoadingPrev(true);
        try {
          const idrCur = currencies.find((c) => c.code.toUpperCase() === "IDR");

          // 1. Cari shif terakhir yang ditutup di cabang ini
          let latestShiftQuery = supabase
            .from("shifts")
            .select("id, closed_at, shift_type, notes")
            .eq("branch_id", branchId)
            .eq("status", "closed")
            .order("closed_at", { ascending: false });

          if (shiftType === "siang") {
            latestShiftQuery = latestShiftQuery.eq("shift_type", "pagi");
          }

          const { data: latestShift } = await latestShiftQuery.limit(1).maybeSingle();

          let foundFromRecon = false;
          if (latestShift) {
            const { data: reconData } = await supabase
              .from("shift_reconciliations")
              .select("currency_id, physical_balance, system_balance, currencies(code)")
              .eq("shift_id", latestShift.id);

            if (reconData && reconData.length > 0) {
              foundFromRecon = true;
              const idrRow = reconData.find(
                (r: any) =>
                  r.currencies?.code?.toUpperCase() === "IDR" ||
                  (idrCur && r.currency_id === idrCur.id),
              );
              const idrVal = idrRow
                ? Number(idrRow.physical_balance ?? idrRow.system_balance ?? 0)
                : 0;

              const valas = reconData
                .filter(
                  (r: any) =>
                    r.currencies?.code?.toUpperCase() !== "IDR" &&
                    (Number(r.physical_balance) > 0 || Number(r.system_balance) > 0),
                )
                .map((r: any) => ({
                  code: r.currencies?.code || "VALAS",
                  amount: Number(r.physical_balance ?? r.system_balance ?? 0),
                }));

              setPrevInfo({
                idrAmount: idrVal,
                source: "reconciliation",
                shiftTime: latestShift.closed_at,
                foreignCurrencies: valas,
              });

              if (isHq && shiftType === "pagi" && idrVal > 0) {
                setOpeningCapital(String(idrVal));
              }
            }
          }

          if (!foundFromRecon) {
            const { data: cashData } = await supabase
              .from("cash_balances")
              .select("currency_id, balance, currencies(code)")
              .eq("branch_id", branchId);

            if (cashData && cashData.length > 0) {
              const idrCash = cashData.find(
                (c: any) =>
                  c.currencies?.code?.toUpperCase() === "IDR" ||
                  (idrCur && c.currency_id === idrCur.id),
              );
              const idrVal = idrCash ? Number(idrCash.balance || 0) : 0;

              const valas = cashData
                .filter(
                  (c: any) =>
                    c.currencies?.code?.toUpperCase() !== "IDR" && Number(c.balance) > 0,
                )
                .map((c: any) => ({
                  code: c.currencies?.code || "VALAS",
                  amount: Number(c.balance || 0),
                }));

              setPrevInfo({
                idrAmount: idrVal,
                source: "cash_balance",
                shiftTime: latestShift?.closed_at ?? null,
                foreignCurrencies: valas,
              });

              if (isHq && shiftType === "pagi" && idrVal > 0) {
                setOpeningCapital(String(idrVal));
              }
            } else {
              setPrevInfo(null);
            }
          }
        } catch (e) {
          console.warn("Error fetching prev morning balance:", e);
          setPrevInfo(null);
        } finally {
          setLoadingPrev(false);
        }
      })();
    } else {
      setPrevInfo(null);
    }
  }, [shiftType, branchId, isHq, currencies]);

  async function submit() {
    if (!branchId) {
      toast.error(lockBranch ? "Anda belum memiliki cabang penugasan. Hubungi admin." : "Pilih cabang");
      return;
    }
    if (!userId) { toast.error("Sesi tidak valid"); return; }
    
    const reqCapVal = Number(requestedCapital.replace(/[^\d]/g, "")) || 0;
    const baseCapVal = isHq && shiftType === "pagi" ? (prevInfo?.idrAmount ?? 0) : 0;
    const addCapVal = isHq && shiftType === "pagi" ? Number(additionalCapital.replace(/[^\d]/g, "")) || 0 : 0;
    const totalHqCap = baseCapVal + addCapVal;

    setSaving(true);
    const { data: shiftData, error } = await supabase
      .from("shifts")
      .insert({
        branch_id: branchId,
        user_id: userId,
        shift_type: shiftType,
        opening_capital: totalHqCap,
        notes: notes || null,
      })
      .select("id")
      .single();

    if (error) {
      setSaving(false);
      toast.error("Gagal membuka shif: " + error.message);
      return;
    }

    // Jika di Kantor Pusat ada penambahan modal kas fisik baru di pagi hari
    if (isHq && shiftType === "pagi" && addCapVal > 0) {
      try {
        const idrCur = currencies.find((c) => c.code.toUpperCase() === "IDR");
        if (idrCur) {
          await supabase.from("cash_movements").insert({
            branch_id: branchId,
            created_by: userId,
            currency_id: idrCur.id,
            amount: addCapVal,
            movement_type: "deposit",
            reference_id: shiftData.id,
            notes: `Tambahan modal awal shif pagi (${notes || "Suntikan dana kas pagi"})`,
            reference_no: "MODAL-AWAL-TOPUP",
          });
        }
      } catch (addErr) {
        console.warn("Failed recording top up capital:", addErr);
      }
    }

    // Jika cabang meminta modal ke Kantor Pusat
    if (!isHq && reqCapVal > 0) {
      try {
        const idrCur = currencies.find((c) => c.code.toUpperCase() === "IDR");
        const hqBranch =
          branches.find(
            (b) =>
              (b as any).is_head_office ||
              (b as any).is_hq ||
              b.name.toLowerCase().includes("pusat") ||
              b.name.toLowerCase().includes("jimbaran"),
          ) || branches[0];

        if (idrCur && hqBranch) {
          const { error: trfErr } = await supabase.from("branch_transfers").insert({
            branch_id: hqBranch.id, // Sumber: Kantor Pusat
            target_branch_id: branchId, // Tujuan: Cabang pemohon
            currency_id: idrCur.id,
            amount: reqCapVal,
            shift_id: shiftData.id,
            status: "pending",
            notes: `Permintaan modal buka shif ${shiftType === "pagi" ? "Pagi" : "Siang/Sore"} (${assignedBranch?.name ?? "Cabang"})`,
          });

          if (trfErr) {
            toast.error("Gagal mengirim permintaan modal: " + trfErr.message);
          } else {
            toast.info(`Permintaan modal ${formatIDR(reqCapVal)} dikirim ke Kantor Pusat untuk persetujuan.`);
          }
        }
      } catch (trfException) {
        console.warn("Transfer request error:", trfException);
      }
    }

    setSaving(false);
    toast.success("Shif berhasil dibuka");
    onSaved();
  }

  const baseCapNum = isHq && shiftType === "pagi" ? (prevInfo?.idrAmount ?? 0) : 0;
  const addCapNum = Number(additionalCapital.replace(/[^\d]/g, "")) || 0;
  const totalHqCapital = baseCapNum + addCapNum;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LogIn className="h-4 w-4" /> Buka Shif</DialogTitle>
          <DialogDescription>Catat pembukaan shif kerja Anda.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Cabang</Label>
            {lockBranch ? (
              <>
                <Input value={assignedBranch?.name ?? "Belum ada cabang penugasan"} disabled />
                <p className="text-xs text-muted-foreground">
                  Anda hanya bisa membuka shif di cabang penugasan Anda.
                </p>
              </>
            ) : (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue placeholder="Pilih cabang" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label>Jenis Shif</Label>
            <Select value={shiftType} onValueChange={(v) => setShiftType(v as ShiftType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem 
                  value="pagi" 
                  disabled={branchOpenShifts.morningOpen}
                >
                  {branchOpenShifts.morningOpen
                    ? "Shif Pagi (08.00–15.00 WITA) — Sedang Terbuka"
                    : "Shif Pagi (08.00–15.00 WITA)"}
                </SelectItem>
                <SelectItem 
                  value="siang" 
                  disabled={branchOpenShifts.afternoonOpen}
                >
                  {branchOpenShifts.afternoonOpen
                    ? "Shif Siang/Sore (15.00–22.00 WITA) — Sedang Terbuka"
                    : "Shif Siang/Sore (15.00–22.00 WITA)"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Informasi Saldo Shif Pagi (Serah Terima Shif Siang) */}
          {shiftType === "siang" && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                  Informasi Saldo Shif Pagi (Serah Terima)
                </span>
                {prevInfo?.shiftTime && (
                  <span className="text-[11px] text-muted-foreground">
                    Ditutup: {formatDateTime(prevInfo.shiftTime)}
                  </span>
                )}
              </div>

              {loadingPrev ? (
                <p className="text-xs text-muted-foreground animate-pulse">Mencari saldo terakhir...</p>
              ) : prevInfo ? (
                <div className="space-y-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Saldo Kas Rupiah (IDR):</div>
                    <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                      {formatIDR(prevInfo.idrAmount)}
                    </div>
                  </div>

                  {prevInfo.foreignCurrencies && prevInfo.foreignCurrencies.length > 0 && (
                    <div className="pt-2 border-t border-border/50">
                      <div className="text-[11px] text-muted-foreground mb-1">Saldo Valuta Asing (Valas):</div>
                      <div className="flex flex-wrap gap-1.5">
                        {prevInfo.foreignCurrencies.map((f) => (
                          <Badge key={f.code} variant="outline" className="text-xs font-mono bg-background">
                            {f.code}: {new Intl.NumberFormat("id-ID").format(f.amount)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Tidak ditemukan riwayat saldo shif pagi sebelumnya.</p>
              )}
            </div>
          )}

          {/* Informasi Sisa Saldo Hari Kemarin (Carry Over) untuk Kantor Pusat Shif Pagi */}
          {isHq && shiftType === "pagi" && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                  Sisa Saldo Kas Hari Sebelumnya (Bawaan)
                </span>
                {prevInfo?.shiftTime && (
                  <span className="text-[11px] text-muted-foreground">
                    Ditutup: {formatDateTime(prevInfo.shiftTime)}
                  </span>
                )}
              </div>

              {loadingPrev ? (
                <p className="text-xs text-muted-foreground animate-pulse">Mencari saldo penutupan hari kemarin...</p>
              ) : prevInfo ? (
                <div className="space-y-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Sisa Saldo Kas Rupiah (IDR):</div>
                    <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                      {formatIDR(prevInfo.idrAmount)}
                    </div>
                  </div>

                  {prevInfo.foreignCurrencies && prevInfo.foreignCurrencies.length > 0 && (
                    <div className="pt-2 border-t border-emerald-200/50 dark:border-emerald-800/50">
                      <div className="text-[11px] text-muted-foreground mb-1">Stok Valuta Asing (Valas):</div>
                      <div className="flex flex-wrap gap-1.5">
                        {prevInfo.foreignCurrencies.map((f) => (
                          <Badge key={f.code} variant="outline" className="text-xs font-mono bg-background">
                            {f.code}: {new Intl.NumberFormat("id-ID").format(f.amount)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Belum ada riwayat saldo penutupan kemarin.</p>
              )}
            </div>
          )}

          {/* Isian Modal / Permintaan Modal */}
          {isHq ? (
            shiftType === "pagi" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Tambahan Modal Baru (IDR) <span className="text-muted-foreground font-normal">(Opsional)</span></Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    prefix="Rp"
                    placeholder="Contoh: 10.000.000 (Jika ada suntikan dana pagi)"
                    value={additionalCapital ? formatIDR(Number(additionalCapital.replace(/[^\d]/g, ""))).replace("Rp", "").trim() : ""}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^\d]/g, "");
                      setAdditionalCapital(val);
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Sisa saldo kemarin otomatis menjadi modal awal. Jika ada penambahan modal fisik baru di pagi hari, kas Kantor Pusat otomatis ditambah sebesar nominal ini.
                  </p>
                </div>

                {addCapNum > 0 && (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">Total Modal Awal Shif Pagi:</span>
                    <span className="font-bold text-sm font-mono text-emerald-600 dark:text-emerald-400">
                      {formatIDR(totalHqCapital)}
                    </span>
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="space-y-2">
              <Label>Permintaan Modal (IDR) ke Kantor Pusat</Label>
              <Input
                type="text"
                inputMode="numeric"
                prefix="Rp"
                placeholder="Contoh: 50.000.000"
                value={requestedCapital ? formatIDR(Number(requestedCapital.replace(/[^\d]/g, ""))).replace("Rp", "").trim() : ""}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^\d]/g, "");
                  setRequestedCapital(val);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Permintaan modal ini akan dikirimkan ke Kantor Pusat untuk disetujui/ditolak.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Catatan (opsional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={submit} disabled={saving} className="gap-2">
            <Play className="h-4 w-4" />
            {saving ? "Menyimpan…" : "Buka Shif"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReconRow {
  currency_id: string;
  code: string;
  name: string;
  decimals: number;
  system_balance: number;
  physical_balance: string;
}

function CloseShiftDialog({
  shift, currencies, onClose, onSaved, userId,
}: {
  shift: ShiftRow; currencies: Currency[];
  onClose: () => void; onSaved: () => void; userId: string;
}) {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [transfering, setTransfering] = useState(false);
  const [branchInfo, setBranchInfo] = useState<{ is_head_office: boolean } | null>(null);

  useEffect(() => {
    supabase.from("branches").select("is_head_office").eq("id", shift.branch_id).single().then(({ data }) => {
      setBranchInfo(data);
    });
  }, [shift.branch_id]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("cash_balances")
        .select("currency_id, balance")
        .eq("branch_id", shift.branch_id);
      const balMap = new Map<string, number>();
      (data ?? []).forEach((r) => balMap.set(r.currency_id as string, Number(r.balance) || 0));
      setRows(
        currencies.map((c) => ({
          currency_id: c.id,
          code: c.code,
          name: c.name,
          decimals: c.decimals,
          system_balance: balMap.get(c.id) ?? 0,
          physical_balance: String(balMap.get(c.id) ?? 0),
        })),
      );
      setLoading(false);
    })();
  }, [shift.branch_id, currencies]);

  const totalDiff = useMemo(
    () => rows.reduce((sum, r) => sum + ((Number(r.physical_balance) || 0) - r.system_balance), 0),
    [rows],
  );

  async function submit() {
    setSaving(true);
    const closedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("shifts")
      .update({ status: "closed", closed_at: closedAt, closed_by: userId, notes: notes || shift.notes })
      .eq("id", shift.id);
    if (updErr) { setSaving(false); toast.error("Gagal menutup shif: " + updErr.message); return; }
    const payload = rows.map((r) => ({
      shift_id: shift.id,
      currency_id: r.currency_id,
      system_balance: r.system_balance,
      physical_balance: Number(r.physical_balance) || 0,
    }));
    if (payload.length) {
      const { error: recErr } = await supabase.from("shift_reconciliations").insert(payload);
      if (recErr) { setSaving(false); toast.error("Rekonsiliasi gagal: " + recErr.message); return; }
    }

    // Automatically transfer to Head Office if NOT Head Office and Siang/Sore shift
    // Transfer ALL remaining balances (IDR + Valas) to Head Office!
    if (branchInfo && !branchInfo.is_head_office && shift.shift_type === "siang") {
      setTransfering(true);
      try {
        const { data: hqData } = await supabase
          .from("branches")
          .select("id")
          .or("is_head_office.eq.true,is_hq.eq.true,name.ilike.%pusat%,name.ilike.%jimbaran%")
          .limit(1)
          .maybeSingle();

        const targetHqId = hqData?.id ?? null;

        const transfers = rows
          .filter((r) => r.system_balance > 0)
          .map((r) => ({
            branch_id: shift.branch_id,
            target_branch_id: targetHqId,
            currency_id: r.currency_id,
            amount: r.system_balance,
            shift_id: shift.id,
            status: "pending" as const,
            notes: `Setoran sisa saldo kas & valas tutup shif sore ${shift.branch?.name || ""}`,
          }));

        if (transfers.length > 0) {
          const { error: txErr } = await supabase.from("branch_transfers").insert(transfers);
          if (txErr) {
            toast.error("Gagal membuat transfer otomatis: " + txErr.message);
          } else {
            toast.info(`${transfers.length} saldo kas & valas otomatis ditransfer ke Kantor Pusat untuk persetujuan.`);
          }
        }
      } catch (err) {
        console.warn("Auto transfer error:", err);
      }
      setTransfering(false);
    }

    setSaving(false);
    toast.success("Shif ditutup & rekonsiliasi tersimpan");
    onSaved();
  }

  const isSaving = saving || transfering;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LogOut className="h-4 w-4" /> Tutup Shif — Rekonsiliasi Kas</DialogTitle>
          <DialogDescription>
            Masukkan saldo fisik hasil hitung tunai per mata uang. Sistem akan menghitung selisih terhadap saldo sistem.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="py-8 text-center text-muted-foreground">Memuat saldo…</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mata Uang</TableHead>
                  <TableHead className="text-right">Saldo Sistem</TableHead>
                  <TableHead className="text-right">Saldo Fisik</TableHead>
                  <TableHead className="text-right">Selisih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, idx) => {
                  const diff = (Number(r.physical_balance) || 0) - r.system_balance;
                  return (
                    <TableRow key={r.currency_id}>
                      <TableCell className="font-medium">{r.code} <span className="text-xs text-muted-foreground">— {r.name}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{r.system_balance.toLocaleString("id-ID", { minimumFractionDigits: r.decimals, maximumFractionDigits: r.decimals })}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="text-right"
                          inputMode="decimal"
                          value={r.physical_balance}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^\d.-]/g, "");
                            setRows((prev) => prev.map((p, i) => i === idx ? { ...p, physical_balance: v } : p));
                          }}
                        />
                      </TableCell>
                      <TableCell className={"text-right tabular-nums " + (diff === 0 ? "" : diff > 0 ? "text-emerald-600" : "text-destructive")}>
                        {diff.toLocaleString("id-ID", { minimumFractionDigits: r.decimals, maximumFractionDigits: r.decimals })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="space-y-2">
          <Label>Catatan tutup shif (opsional)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Kondisi kas, kejadian penting, dll." />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total selisih (semua mata uang, tanpa konversi)</span>
          <span className={"font-semibold tabular-nums " + (totalDiff === 0 ? "" : totalDiff > 0 ? "text-emerald-600" : "text-destructive")}>
            {totalDiff.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Batal</Button>
          <Button onClick={submit} disabled={isSaving || loading} variant="destructive" className="gap-2">
            <Square className="h-4 w-4" />
            {isSaving ? "Memproses…" : "Tutup Shif"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}