import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { History, Search, ArrowRight, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { id } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/rates-history")({
  component: RatesHistoryPage,
});

interface RateLog {
  id: string;
  currency_code: string;
  branch_name: string;
  old_buy_rate: number | null;
  new_buy_rate: number | null;
  old_sell_rate: number | null;
  new_sell_rate: number | null;
  changed_at: string;
  action_type: string;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

const fmt = (n: number | null) => {
  if (n === null) return "—";
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
};

function RatesHistoryPage() {
  const { roles } = useCurrentUser();
  const [rows, setRows] = useState<RateLog[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("ALL");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  async function load() {
    setLoading(true);
    
    // Load branches for filter
    const { data: brData } = await supabase.from("branches").select("id, name").order("name");
    setBranches(brData || []);

    let query = supabase
      .from("exchange_rate_logs")
      .select(`
        *,
        profiles!changed_by(full_name, email)
      `)
      .order("changed_at", { ascending: false })
      .limit(200);

    if (branchFilter !== "ALL") {
        query = query.eq("branch_name", branchFilter === "HQ" ? "HQ / Default" : branches.find(b => b.id === branchFilter)?.name);
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Gagal memuat riwayat", { description: error.message });
    } else {
      setRows((data as any) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [branchFilter]);

  const filtered = useMemo(() => {
    return rows?.filter(r => 
      r.currency_code.toLowerCase().includes(search.toLowerCase()) ||
      (r.profiles?.full_name || "").toLowerCase().includes(search.toLowerCase())
    ) ?? [];
  }, [rows, search]);

  // Pagination Riwayat Kurs
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, branchFilter]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Riwayat Perubahan Kurs</h1>
            <p className="text-sm text-muted-foreground">
              Log aktivitas perubahan kurs beli dan jual secara real-time.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full max-w-sm space-y-2">
          <Label>Cari Mata Uang / Petugas</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="w-full max-w-xs space-y-2">
          <Label>Filter Cabang</Label>
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua Cabang</SelectItem>
              <SelectItem value="HQ">HQ / Default</SelectItem>
              {branches.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu & Tanggal</TableHead>
                <TableHead>Mata Uang</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Kurs Beli (Lama → Baru)</TableHead>
                <TableHead>Kurs Jual (Lama → Baru)</TableHead>
                <TableHead>Petugas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : filtered?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    Tidak ada riwayat ditemukan.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows?.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      <div className="font-bold">{format(new Date(row.changed_at), "HH:mm:ss")}</div>
                      <div className="text-muted-foreground">{format(new Date(row.changed_at), "dd MMM yyyy", { locale: id })}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-bold">{row.currency_code}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{row.branch_name}</TableCell>
                    <TableCell>
                      <Badge 
                        variant={
                            row.action_type === 'INSERT' ? 'default' : 
                            row.action_type === 'DELETE' ? 'destructive' : 'outline'
                        }
                        className="text-[10px]"
                      >
                        {row.action_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{fmt(row.old_buy_rate)}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-bold">{fmt(row.new_buy_rate)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{fmt(row.old_sell_rate)}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-bold">{fmt(row.new_sell_rate)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span>{row.profiles?.full_name || row.profiles?.email || 'System'}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {filtered && filtered.length > 0 && (
            <DataTablePagination
              currentPage={currentPage}
              pageSize={pageSize}
              totalRecords={filtered.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setCurrentPage(1);
              }}
              entityLabel="riwayat kurs"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
