import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Search, Download, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { MasterPageHeader } from "@/components/master-data/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { DataTablePagination } from "@/components/ui/data-table-pagination";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

type AuditAction = "insert" | "update" | "delete";

interface AuditLog {
  id: string;
  table_name: string;
  record_id: string | null;
  action: AuditAction;
  actor_id: string | null;
  actor_email: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  created_at: string;
}

const TABLES = [
  "customers",
  "transactions",
  "exchange_rates",
  "currencies",
  "branches",
  "user_roles",
  "cash_movements",
  "approval_requests",
];

const ACTION_STYLES: Record<AuditAction, string> = {
  insert: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  update: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  delete: "bg-red-500/15 text-red-700 border-red-500/30",
};

const ACTION_LABELS: Record<AuditAction, string> = {
  insert: "Tambah",
  update: "Ubah",
  delete: "Hapus",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function AuditPage() {
  const { roles, loading: userLoading } = useCurrentUser();
  const canView = hasAnyRole(roles, ["super_admin", "auditor", "owner"]);

  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, tableFilter, actionFilter]);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (tableFilter !== "all") q = q.eq("table_name", tableFilter);
    if (actionFilter !== "all") q = q.eq("action", actionFilter);
    const { data, error } = await q;
    if (error) {
      toast.error("Gagal memuat audit log", { description: error.message });
      setLoading(false);
      return;
    }
    setRows((data as AuditLog[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    load();
     
  }, [canView, tableFilter, actionFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.table_name.toLowerCase().includes(q) ||
        (r.actor_email ?? "").toLowerCase().includes(q) ||
        (r.record_id ?? "").toLowerCase().includes(q) ||
        (r.changed_fields ?? []).join(",").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  function exportCsv() {
    const header = [
      "waktu",
      "tabel",
      "aksi",
      "record_id",
      "aktor",
      "field_berubah",
    ];
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push(
        [
          fmtDateTime(r.created_at),
          r.table_name,
          r.action,
          r.record_id ?? "",
          r.actor_email ?? "",
          (r.changed_fields ?? []).join("|"),
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!userLoading && !canView) {
    return (
      <div className="space-y-6">
        <MasterPageHeader
          title="Audit Trail"
          description="Riwayat perubahan data sistem."
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Anda tidak memiliki akses ke Audit Trail. Hanya Super Admin,
            Auditor, dan Owner yang dapat melihat log.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Audit Trail"
        description="Riwayat semua perubahan data pada tabel inti sistem — immutable."
        extra={
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Ekspor CSV
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari tabel, email aktor, record id, field…"
                className="pl-9"
              />
            </div>
            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Semua tabel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua tabel</SelectItem>
                {TABLES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Semua aksi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua aksi</SelectItem>
                <SelectItem value="insert">Tambah</SelectItem>
                <SelectItem value="update">Ubah</SelectItem>
                <SelectItem value="delete">Hapus</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Tabel</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Record ID</TableHead>
                  <TableHead>Aktor</TableHead>
                  <TableHead>Field Berubah</TableHead>
                  <TableHead className="text-right">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Tidak ada log.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDateTime(r.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.table_name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={ACTION_STYLES[r.action]}
                        >
                          {ACTION_LABELS[r.action]}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-xs">
                        {r.record_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.actor_email ?? (
                          <span className="text-muted-foreground">sistem</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[240px]">
                        {r.changed_fields && r.changed_fields.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {r.changed_fields.slice(0, 4).map((f) => (
                              <Badge
                                key={f}
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {f}
                              </Badge>
                            ))}
                            {r.changed_fields.length > 4 && (
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                              >
                                +{r.changed_fields.length - 4}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDetail(r)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {filtered.length > 0 && (
            <DataTablePagination
              currentPage={currentPage}
              pageSize={pageSize}
              totalRecords={filtered.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setCurrentPage(1);
              }}
              entityLabel="log audit"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detail Log</DialogTitle>
            <DialogDescription>
              {detail && (
                <span className="font-mono text-xs">
                  {detail.table_name} · {ACTION_LABELS[detail.action]} ·{" "}
                  {fmtDateTime(detail.created_at)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label className="text-xs">Aktor</Label>
                  <div>{detail.actor_email ?? "sistem"}</div>
                </div>
                <div>
                  <Label className="text-xs">Record ID</Label>
                  <div className="font-mono text-xs">
                    {detail.record_id ?? "—"}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label className="text-xs">Data Lama</Label>
                  <pre className="mt-1 max-h-80 overflow-auto rounded-md border bg-muted/50 p-2 text-[11px]">
                    {detail.old_data
                      ? JSON.stringify(detail.old_data, null, 2)
                      : "—"}
                  </pre>
                </div>
                <div>
                  <Label className="text-xs">Data Baru</Label>
                  <pre className="mt-1 max-h-80 overflow-auto rounded-md border bg-muted/50 p-2 text-[11px]">
                    {detail.new_data
                      ? JSON.stringify(detail.new_data, null, 2)
                      : "—"}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

void ShieldCheck;