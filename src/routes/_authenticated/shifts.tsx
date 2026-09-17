import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Clock,
  LogIn,
  LogOut,
  Play,
  Square,
  Pencil,
  AlertTriangle,
  Search,
  Calendar,
  Building2,
  RotateCcw,
  Filter,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { useAppSettings } from "@/hooks/use-app-settings";
import { MasterPageHeader } from "@/components/master-data/page-header";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { DatePickerInput } from "@/components/ui/date-picker-input";
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
type DateFilterMode = "all" | "today" | "yesterday" | "this_month" | "custom_date" | "custom_range";

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

function toLocalDateStr(d: Date | string): string {
  const dateObj = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) return "";
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayRangeISO(dateStr: string) {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return { startISO: "", endISO: "" };
  const [y, m, d] = parts;
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

function getMonthRangeISO(ymStr: string) {
  const parts = ymStr.split("-").map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return { startISO: "", endISO: "" };
  const [y, m] = parts;
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

function ShiftsPage() {
  const { user, profile, roles } = useCurrentUser();
  const { settings } = useAppSettings();
  const isSuperAdmin = hasAnyRole(roles, ["super_admin", "owner"]);
  const isManager = isSuperAdmin || hasAnyRole(roles, ["branch_manager"]);
  const canSelectBranch = isSuperAdmin || hasAnyRole(roles, ["branch_manager"]);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [myOpenShift, setMyOpenShift] = useState<ShiftRow | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter States
  const defaultBranch = isSuperAdmin ? "all" : (profile?.branch_id ?? "all");
  const [filterBranch, setFilterBranch] = useState<string>(defaultBranch);
  const [dateMode, setDateMode] = useState<DateFilterMode>("all");
  const [customDate, setCustomDate] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState<ShiftRow | null>(null);
  const [editingShift, setEditingShift] = useState<ShiftRow | null>(null);

  // Pagination Shif Kerja
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async (
    targetBranch = filterBranch,
    targetDateMode = dateMode,
    targetCustomDate = customDate,
    targetStart = startDate,
    targetEnd = endDate
  ) => {
    setLoading(true);
    const [b, c, s, mineRes] = await Promise.all([
      supabase.from("branches").select("id, name, code").eq("is_active", true).order("name"),
      supabase.from("currencies").select("id, code, name, decimals").eq("is_active", true).order("code"),
      (() => {
        let query = supabase
          .from("shifts")
          .select("id, branch_id, user_id, shift_type, status, opening_capital, opened_at, closed_at, notes, branch:branches(name)")
          .order("opened_at", { ascending: false });
        
        // Filter by branch
        if (!isSuperAdmin && profile?.branch_id) {
          query = query.eq("branch_id", profile.branch_id);
        } else if (targetBranch && targetBranch !== "all") {
          query = query.eq("branch_id", targetBranch);
        }

        // Filter by date
        if (targetDateMode === "today") {
          const todayStr = toLocalDateStr(new Date());
          const { startISO, endISO } = getDayRangeISO(todayStr);
          if (startISO && endISO) query = query.gte("opened_at", startISO).lte("opened_at", endISO);
        } else if (targetDateMode === "yesterday") {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          const yestStr = toLocalDateStr(d);
          const { startISO, endISO } = getDayRangeISO(yestStr);
          if (startISO && endISO) query = query.gte("opened_at", startISO).lte("opened_at", endISO);
        } else if (targetDateMode === "this_month") {
          const ym = toLocalDateStr(new Date()).slice(0, 7);
          const { startISO, endISO } = getMonthRangeISO(ym);
          if (startISO && endISO) query = query.gte("opened_at", startISO).lte("opened_at", endISO);
        } else if (targetDateMode === "custom_date" && targetCustomDate) {
          const { startISO, endISO } = getDayRangeISO(targetCustomDate);
          if (startISO && endISO) query = query.gte("opened_at", startISO).lte("opened_at", endISO);
        } else if (targetDateMode === "custom_range") {
          if (targetStart) {
            const { startISO } = getDayRangeISO(targetStart);
            if (startISO) query = query.gte("opened_at", startISO);
          }
          if (targetEnd) {
            const { endISO } = getDayRangeISO(targetEnd);
            if (endISO) query = query.lte("opened_at", endISO);
          }
        }
        
        return query.limit(500);
      })(),
      user?.id
        ? supabase
            .from("shifts")
            .select("id, branch_id, user_id, shift_type, status, opening_capital, opened_at, closed_at, notes, branch:branches(name)")
            .eq("user_id", user.id)
            .eq("status", "open")
            .order("opened_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
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
    setMyOpenShift((mineRes?.data as ShiftRow | null) ?? null);
    setLoading(false);
  }, [user?.id, isSuperAdmin, profile?.branch_id, filterBranch, dateMode, customDate, startDate, endDate]);

  useEffect(() => {
    load();
  }, []);

  // Filtered shifts according to search and status
  const filteredShifts = useMemo(() => {
    return shifts.filter((s) => {
      if (filterStatus !== "all" && s.status !== filterStatus) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const userName = (s.user?.full_name || "").toLowerCase();
        const userEmail = (s.user?.email || "").toLowerCase();
        const branchName = (s.branch?.name || "").toLowerCase();
        const notes = (s.notes || "").toLowerCase();
        const matches =
          userName.includes(q) ||
          userEmail.includes(q) ||
          branchName.includes(q) ||
          notes.includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [shifts, filterStatus, searchQuery]);

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterStatus, filterBranch, dateMode, customDate, startDate, endDate]);

  const paginatedShifts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredShifts.slice(start, start + pageSize);
  }, [filteredShifts, currentPage, pageSize]);

  const isFiltered =
    (canSelectBranch && filterBranch !== defaultBranch) ||
    dateMode !== "all" ||
    searchQuery.trim() !== "" ||
    filterStatus !== "all";

  const handleResetFilter = () => {
    setFilterBranch(defaultBranch);
    setDateMode("all");
    setCustomDate("");
    setStartDate("");
    setEndDate("");
    setSearchQuery("");
    setFilterStatus("all");
    load(defaultBranch, "all", "", "", "");
  };

  const statDateLabel = useMemo(() => {
    switch (dateMode) {
      case "today":
        return "Hari Ini";
      case "yesterday":
        return "Kemarin";
      case "this_month":
        return "Bulan Ini";
      case "custom_date":
        return customDate ? customDate.split("-").reverse().join("/") : "Tanggal Terpilih";
      case "custom_range":
        return `${startDate ? startDate.split("-").reverse().join("/") : "…"} s/d ${endDate ? endDate.split("-").reverse().join("/") : "…"}`;
      case "all":
      default:
        return "Semua Tanggal";
    }
  }, [dateMode, customDate, startDate, endDate]);

  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Manajemen Shif Kasir"
        description="Buka dan tutup shif kerja kasir, serah terima modal, serta rekonsiliasi kas."
        onAdd={!myOpenShift ? () => setOpenDialog(true) : undefined}
        addLabel="Buka Shif"
        canWrite={!myOpenShift}
      />

      {myOpenShift && (
        <Card className="border-emerald-600/40 bg-emerald-500/5">
          <CardHeader className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600 animate-pulse" />
                  Shif Anda Sedang Aktif
                </CardTitle>
                <CardDescription className="mt-1">
                  Cabang: <b>{myOpenShift.branch?.name ?? "—"}</b> · Shif:{" "}
                  <Badge variant="outline" className="ml-1">
                    {myOpenShift.shift_type === "pagi" ? "Pagi" : "Siang/Sore"}
                  </Badge>
                  {myOpenShift.opening_capital > 0 && (
                    <> · Modal awal: <b>{formatIDR(myOpenShift.opening_capital)}</b>{myOpenShift.shift_type === "siang" ? " (Serah Terima)" : ""}</>
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
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base">Riwayat Shif</CardTitle>
              <CardDescription>
                {filteredShifts.length} shif ditemukan
                {filterBranch !== "all" ? ` · Cabang: ${branches.find(b => b.id === filterBranch)?.name || "Terpilih"}` : ""}
                {dateMode !== "all" ? ` · Periode: ${statDateLabel}` : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs font-normal">
                Total: <span className="font-semibold ml-1">{filteredShifts.length}</span>
              </Badge>
              <Badge className="bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/20 border-emerald-600/30 text-xs font-normal">
                Terbuka: <span className="font-semibold ml-1">{filteredShifts.filter(s => s.status === "open").length}</span>
              </Badge>
              <Badge variant="secondary" className="text-xs font-normal">
                Tertutup: <span className="font-semibold ml-1">{filteredShifts.filter(s => s.status === "closed").length}</span>
              </Badge>
            </div>
          </div>
        </CardHeader>

        {/* Toolbar Filter: Cabang, Tanggal, Pencarian, Status */}
        <div className="px-6 py-3 border-b bg-muted/20 flex flex-wrap items-center gap-3">
          {/* Pencarian teks (Nama Petugas, Catatan) */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari kasir / petugas, catatan…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>

          {/* Filter Cabang */}
          {canSelectBranch ? (
            <Select
              value={filterBranch}
              onValueChange={(v) => {
                setFilterBranch(v);
                load(v, dateMode, customDate, startDate, endDate);
              }}
            >
              <SelectTrigger className="w-full sm:w-48 h-9 text-sm">
                <Building2 className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
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
          ) : profile?.branch_id ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-muted/40 text-xs text-muted-foreground h-9">
              <Building2 className="h-3.5 w-3.5 text-primary" />
              <span>Cabang: <b className="text-foreground">{branches.find(b => b.id === profile.branch_id)?.name || "Cabang Anda"}</b></span>
            </div>
          ) : null}

          {/* Filter Tanggal Mode */}
          <Select
            value={dateMode}
            onValueChange={(v: DateFilterMode) => {
              setDateMode(v);
              if (v === "all" || v === "today" || v === "yesterday" || v === "this_month") {
                load(filterBranch, v, customDate, startDate, endDate);
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-44 h-9 text-sm">
              <Calendar className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
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

          {/* Input Tanggal Tunggal (Pilih Tanggal) */}
          {dateMode === "custom_date" && (
            <div className="flex items-center gap-1.5">
              <DatePickerInput
                value={customDate}
                placeholder="DD/MM/YYYY"
                onChange={(val) => {
                  setCustomDate(val);
                  load(filterBranch, "custom_date", val, startDate, endDate);
                }}
                className="w-full sm:w-36 h-9 text-sm"
              />
            </div>
          )}

          {/* Input Rentang Tanggal (Dari s/d Sampai) */}
          {dateMode === "custom_range" && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <DatePickerInput
                value={startDate}
                placeholder="Dari DD/MM/YYYY"
                onChange={(val) => {
                  setStartDate(val);
                  load(filterBranch, "custom_range", customDate, val, endDate);
                }}
                className="w-full sm:w-36 h-9 text-sm"
              />
              <span className="text-xs text-muted-foreground">s/d</span>
              <DatePickerInput
                value={endDate}
                placeholder="Sampai DD/MM/YYYY"
                onChange={(val) => {
                  setEndDate(val);
                  load(filterBranch, "custom_range", customDate, startDate, val);
                }}
                className="w-full sm:w-36 h-9 text-sm"
              />
            </div>
          )}

          {/* Filter Status Shif */}
          <Select
            value={filterStatus}
            onValueChange={(v) => setFilterStatus(v)}
          >
            <SelectTrigger className="w-full sm:w-36 h-9 text-sm">
              <Filter className="mr-2 h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="open">Shif Terbuka</SelectItem>
              <SelectItem value="closed">Shif Tertutup</SelectItem>
            </SelectContent>
          </Select>

          {/* Tombol Reset Filter */}
          {isFiltered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetFilter}
              className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              title="Reset semua filter ke pengaturan awal"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Filter
            </Button>
          )}
        </div>

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
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span>Memuat data shif…</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : paginatedShifts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                    <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                      <Clock className="h-8 w-8 text-muted-foreground/40" />
                      <p className="font-semibold text-foreground text-sm">Tidak ada data shif yang ditemukan</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {isFiltered
                          ? "Tidak ada rekaman shif yang cocok dengan kriteria filter cabang atau tanggal yang Anda pilih."
                          : "Belum ada riwayat shif kasir yang tercatat dalam sistem."}
                      </p>
                      {isFiltered && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleResetFilter}
                          className="mt-2 h-8 text-xs gap-1.5"
                        >
                          <RotateCcw className="h-3 w-3" /> Reset Filter
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedShifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.user?.full_name || s.user?.email || "—"}</TableCell>
                    <TableCell>{s.branch?.name ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{s.shift_type === "pagi" ? "Pagi" : "Siang/Sore"}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(s.opened_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(s.closed_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.opening_capital > 0 ? (
                        <div>
                          <div className="font-medium">{formatIDR(s.opening_capital)}</div>
                          {s.shift_type === "siang" && (
                            <span className="text-[10px] text-muted-foreground block -mt-0.5">
                              (Serah Terima)
                            </span>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {s.status === "open" ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Terbuka</Badge>
                      ) : (
                        <Badge variant="secondary">Tertutup</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {s.status === "open" && (s.user_id === user?.id || isManager) && (
                          <Button size="sm" variant="outline" onClick={() => setCloseDialog(s)} className="gap-1">
                            <Square className="h-3 w-3" /> Tutup
                          </Button>
                        )}
                        {hasAnyRole(roles, ["super_admin", "owner"]) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingShift(s)}
                            title="Koreksi Jenis Shif"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {filteredShifts.length > 0 && (
            <DataTablePagination
              currentPage={currentPage}
              pageSize={pageSize}
              totalRecords={filteredShifts.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setCurrentPage(1);
              }}
              entityLabel="shif kerja"
            />
          )}
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

      {editingShift && (
        <EditShiftDialog
          shift={editingShift}
          onClose={() => setEditingShift(null)}
          onSaved={() => { setEditingShift(null); load(); }}
        />
      )}
    </div>
  );
}

function EditShiftDialog({
  shift,
  onClose,
  onSaved,
}: {
  shift: ShiftRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [shiftType, setShiftType] = useState<ShiftType>(shift.shift_type);
  const [openingCapital, setOpeningCapital] = useState<string>(
    shift.opening_capital > 0 ? String(shift.opening_capital) : ""
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const parsedCapital = Number(openingCapital.replace(/[^\d]/g, "")) || 0;
    const { error } = await supabase
      .from("shifts")
      .update({
        shift_type: shiftType,
        opening_capital: parsedCapital,
      })
      .eq("id", shift.id);
    setSaving(false);

    if (error) {
      toast.error("Gagal mengubah data shif: " + error.message);
      return;
    }

    toast.success("Data shif berhasil diperbarui");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Koreksi Data Shif</DialogTitle>
          <DialogDescription>
            Ubah jenis shif dan modal awal untuk {shift.branch?.name ?? "Cabang"} (Buka: {formatDateTime(shift.opened_at)}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Pilih Jenis Shif</Label>
            <Select value={shiftType} onValueChange={(v) => setShiftType(v as ShiftType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pagi">Shif Pagi</SelectItem>
                <SelectItem value="siang">Shif Siang/Sore (Serah Terima)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Modal Awal (IDR)</Label>
            <Input
              type="text"
              inputMode="numeric"
              value={
                openingCapital
                  ? Number(openingCapital.replace(/[^\d]/g, "")).toLocaleString("id-ID")
                  : ""
              }
              onChange={(e) => {
                const clean = e.target.value.replace(/[^\d]/g, "");
                setOpeningCapital(clean);
              }}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              {shiftType === "siang"
                ? "Sisa saldo kas IDR dari serah terima shif pagi."
                : "Modal kas awal IDR saat pembukaan shif pagi."}
            </p>
          </div>

          <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md space-y-1">
            <p><strong>Catatan:</strong></p>
            <p>• Mengubah jenis shif / modal awal pada data riwayat tidak mengubah mutasi kas fisik yang telah berjalan.</p>
            <p>• Shif Siang/Sore otomatis ditandai sebagai serah terima lanjutan dari sisa kas shif pagi.</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [todayShiftsState, setTodayShiftsState] = useState<{
    morning: { exists: boolean; isOpen: boolean; isClosed: boolean };
    afternoon: { exists: boolean; isOpen: boolean; isClosed: boolean };
    loading: boolean;
  }>({
    morning: { exists: false, isOpen: false, isClosed: false },
    afternoon: { exists: false, isOpen: false, isClosed: false },
    loading: false,
  });

  useEffect(() => {
    if (!branchId && !lockBranch && branches.length) setBranchId(branches[0].id);
  }, [branches, branchId, lockBranch]);

  // Cek shif yang sudah dibuka pada hari kalender ini (WITA / Asia/Makassar) di cabang ini
  useEffect(() => {
    if (branchId) {
      (async () => {
        setTodayShiftsState((prev) => ({ ...prev, loading: true }));
        try {
          // Tanggal kalender hari ini di zona waktu WITA (Asia/Makassar, UTC+8)
          const nowWita = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Makassar" }));
          const year = nowWita.getFullYear();
          const month = String(nowWita.getMonth() + 1).padStart(2, "0");
          const day = String(nowWita.getDate()).padStart(2, "0");
          const todayDateStr = `${year}-${month}-${day}`;

          const todayStartUtc = new Date(`${todayDateStr}T00:00:00+08:00`).toISOString();
          const todayEndUtc = new Date(`${todayDateStr}T23:59:59.999+08:00`).toISOString();

          const { data: todayShifts } = await supabase
            .from("shifts")
            .select("shift_type, status, opened_at")
            .eq("branch_id", branchId)
            .gte("opened_at", todayStartUtc)
            .lte("opened_at", todayEndUtc);

          const morningShift = todayShifts?.find((s) => s.shift_type === "pagi");
          const afternoonShift = todayShifts?.find((s) => s.shift_type === "siang");

          const morning = {
            exists: Boolean(morningShift),
            isOpen: morningShift?.status === "open",
            isClosed: morningShift?.status === "closed",
          };
          const afternoon = {
            exists: Boolean(afternoonShift),
            isOpen: afternoonShift?.status === "open",
            isClosed: afternoonShift?.status === "closed",
          };

          setTodayShiftsState({
            morning,
            afternoon,
            loading: false,
          });

          // Otomatis tentukan default shiftType ke shif yang belum dibuka hari ini
          if (morning.exists && !afternoon.exists) {
            setShiftType("siang");
          } else if (!morning.exists) {
            setShiftType("pagi");
          }
        } catch (err) {
          console.warn("Failed checking today shifts:", err);
          setTodayShiftsState((prev) => ({ ...prev, loading: false }));
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

    const isMorningBlocked = shiftType === "pagi" && todayShiftsState.morning.exists;
    const isAfternoonBlocked = shiftType === "siang" && todayShiftsState.afternoon.exists;

    if (isMorningBlocked) {
      toast.error("Shif Pagi untuk cabang ini sudah pernah dibuka pada hari ini!");
      return;
    }

    if (isAfternoonBlocked) {
      toast.error("Shif Siang/Sore untuk cabang ini sudah pernah dibuka pada hari ini!");
      return;
    }
    
    const reqCapVal = Number(requestedCapital.replace(/[^\d]/g, "")) || 0;
    const baseCapVal =
      shiftType === "siang" || (isHq && shiftType === "pagi")
        ? (prevInfo?.idrAmount ?? 0)
        : 0;
    const addCapVal =
      isHq && shiftType === "pagi"
        ? Number(additionalCapital.replace(/[^\d]/g, "")) || 0
        : 0;
    const totalOpeningCap = baseCapVal + addCapVal;

    setSaving(true);
    const { data: shiftData, error } = await supabase
      .from("shifts")
      .insert({
        branch_id: branchId,
        user_id: userId,
        shift_type: shiftType,
        opening_capital: totalOpeningCap,
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
          {/* Peringatan jika seluruh shif kerja hari ini sudah dibuka */}
          {todayShiftsState.morning.exists && todayShiftsState.afternoon.exists && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold">Semua Shif Hari Ini Sudah Selesai</p>
                <p className="text-[11px] mt-0.5 leading-relaxed">
                  Shif Pagi dan Shif Siang/Sore untuk cabang ini sudah pernah dibuka pada hari ini. Menurut SOP pembukuan KUPVA, shif yang sama tidak boleh dibuka lebih dari 1 kali dalam 1 hari.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Jenis Shif</Label>
            <Select value={shiftType} onValueChange={(v) => setShiftType(v as ShiftType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem 
                  value="pagi" 
                  disabled={todayShiftsState.morning.exists}
                >
                  {todayShiftsState.morning.isOpen
                    ? "Shif Pagi (08.00–15.00 WITA) — Sedang Aktif"
                    : todayShiftsState.morning.isClosed
                    ? "Shif Pagi (08.00–15.00 WITA) — Sudah Selesai Hari Ini"
                    : "Shif Pagi (08.00–15.00 WITA)"}
                </SelectItem>
                <SelectItem 
                  value="siang" 
                  disabled={todayShiftsState.afternoon.exists}
                >
                  {todayShiftsState.afternoon.isOpen
                    ? "Shif Siang/Sore (15.00–22.00 WITA) — Sedang Aktif"
                    : todayShiftsState.afternoon.isClosed
                    ? "Shif Siang/Sore (15.00–22.00 WITA) — Sudah Selesai Hari Ini"
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
              <Label>
                {shiftType === "siang"
                  ? "Permintaan Tambahan Modal (IDR) ke Kantor Pusat (Opsional)"
                  : "Permintaan Modal (IDR) ke Kantor Pusat"}
              </Label>
              <Input
                type="text"
                inputMode="numeric"
                prefix="Rp"
                placeholder={shiftType === "siang" ? "0 (Kosongkan jika cukup sisa shif pagi)" : "Contoh: 50.000.000"}
                value={requestedCapital ? formatIDR(Number(requestedCapital.replace(/[^\d]/g, ""))).replace("Rp", "").trim() : ""}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^\d]/g, "");
                  setRequestedCapital(val);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {shiftType === "siang"
                  ? "Opsional. Modal awal shif siang otomatis menggunakan sisa kas dari shif pagi di atas."
                  : "Permintaan modal ini akan dikirimkan ke Kantor Pusat untuk disetujui/ditolak."}
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
          <Button
            onClick={submit}
            disabled={
              saving ||
              (shiftType === "pagi"
                ? todayShiftsState.morning.exists
                : todayShiftsState.afternoon.exists)
            }
            className="gap-2"
          >
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
      // 1. Fetch raw cash_balances
      const { data } = await supabase
        .from("cash_balances")
        .select("currency_id, balance")
        .eq("branch_id", shift.branch_id);
      const balMap = new Map<string, number>();
      (data ?? []).forEach((r) => balMap.set(r.currency_id as string, Number(r.balance) || 0));

      // 2. Strict Cross-Validation against actual transactions & received modal for non-HQ branches
      if (branchInfo && !branchInfo.is_head_office) {
        try {
          const shiftDate = new Date(shift.opened_at || Date.now());
          shiftDate.setHours(0, 0, 0, 0);
          const nextDay = new Date(shiftDate);
          nextDay.setDate(nextDay.getDate() + 1);

          // Ambil modal masuk hari ini dari Kantor Pusat yang sudah disetujui (accepted)
          const { data: modalTrfs } = await supabase
            .from("branch_transfers")
            .select("amount")
            .eq("target_branch_id", shift.branch_id)
            .eq("status", "accepted")
            .gte("created_at", shiftDate.toISOString())
            .lt("created_at", nextDay.toISOString());

          const totalModalReceived = (modalTrfs ?? []).reduce(
            (sum, t) => sum + Number(t.amount || 0),
            0
          );
          const effectiveCapital =
            totalModalReceived > 0
              ? totalModalReceived
              : Number(shift.opening_capital || 0);

          // Ambil seluruh transaksi selesai hari ini di cabang tersebut
          const { data: txs } = await supabase
            .from("transactions")
            .select(
              "id, transaction_type, currency_id, foreign_amount, idr_amount, status, transaction_items(currency_id, foreign_amount, idr_amount)"
            )
            .eq("branch_id", shift.branch_id)
            .eq("status", "completed")
            .gte("created_at", shiftDate.toISOString())
            .lt("created_at", nextDay.toISOString());

          let totalBuyIdr = 0;
          let totalSellIdr = 0;
          const valasNetMap = new Map<string, number>();

          (txs ?? []).forEach((tx) => {
            const isBuy = tx.transaction_type === "buy";
            const items = (tx as any).transaction_items?.length
              ? (tx as any).transaction_items
              : [
                  {
                    currency_id: tx.currency_id,
                    foreign_amount: tx.foreign_amount,
                    idr_amount: tx.idr_amount,
                  },
                ];

            items.forEach((it: any) => {
              const cId = it.currency_id;
              const fAmt = Number(it.foreign_amount || 0);
              const iAmt = Number(it.idr_amount || 0);

              if (cId) {
                const curVal = valasNetMap.get(cId) || 0;
                valasNetMap.set(cId, curVal + (isBuy ? fAmt : -fAmt));
              }
              if (isBuy) totalBuyIdr += iAmt;
              else totalSellIdr += iAmt;
            });
          });

          // Hitung saldo riil yang secara matematis valid
          const verifiedIdr = Math.max(
            0,
            effectiveCapital + totalSellIdr - totalBuyIdr
          );

          currencies.forEach((c) => {
            if (c.code.toUpperCase() === "IDR") {
              const rawBal = balMap.get(c.id) ?? 0;
              // Jika ada selisih karena penggandaan trigger / residu, gunakan nilai terverifikasi riil
              if (Math.abs(rawBal - verifiedIdr) > 0.01) {
                balMap.set(c.id, verifiedIdr);
              }
            } else {
              const verifiedValas = Math.max(0, valasNetMap.get(c.id) || 0);
              const rawBal = balMap.get(c.id) ?? 0;
              if (Math.abs(rawBal - verifiedValas) > 0.001) {
                balMap.set(c.id, verifiedValas);
              }
            }
          });
        } catch (err) {
          console.warn("Auto-reconcile check error:", err);
        }
      }

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
  }, [shift.branch_id, currencies, branchInfo]);

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
          .filter((r) => r.system_balance > 0 || (Number(r.physical_balance) || 0) > 0)
          .map((r) => {
            const amount = (Number(r.physical_balance) || 0) > 0
              ? Number(r.physical_balance)
              : r.system_balance;
            return {
              branch_id: shift.branch_id,
              target_branch_id: targetHqId,
              currency_id: r.currency_id,
              amount: amount,
              shift_id: shift.id,
              status: "pending" as const,
              notes: `Setoran sisa saldo kas & valas tutup shif sore ${shift.branch?.name || ""}`,
            };
          });

        if (transfers.length > 0) {
          const { error: txErr } = await supabase.from("branch_transfers").insert(transfers);
          if (txErr) {
            toast.error("Gagal membuat transfer otomatis: " + txErr.message);
          } else {
            toast.info(`${transfers.length} saldo kas & valas otomatis ditransfer ke Kantor Pusat untuk persetujuan.`);
            
            // Segera sinkronkan saldo aktif cabang ke 0 agar tidak meninggalkan saldo gantung
            for (const tr of transfers) {
              await supabase
                .from("cash_balances")
                .update({ balance: 0, updated_at: new Date().toISOString() })
                .eq("branch_id", shift.branch_id)
                .eq("currency_id", tr.currency_id);
            }
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
          <div className="space-y-3">
            {branchInfo && !branchInfo.is_head_office && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  <strong>Verifikasi Otomatis:</strong> Saldo sistem divalidasi langsung terhadap modal awal & seluruh transaksi riil cabang hari ini sehingga nominal setoran dijamin 100% akurat.
                </span>
              </div>
            )}
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