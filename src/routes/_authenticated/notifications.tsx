import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { formatDistanceToNow, format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  CheckCheck,
  AlertCircle,
  AlertTriangle,
  Info,
  ExternalLink,
  RefreshCw,
  Inbox,
  Filter,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterPageHeader } from "@/components/master-data/page-header";
import {
  useNotifications,
  type NotificationCategory,
  type NotificationRow,
  type NotificationSeverity,
} from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
  head: () => ({
    meta: [
      { title: "Notifikasi - KUPVA BB" },
      { name: "description", content: "Pusat notifikasi ambang batas dan peringatan sistem." },
    ],
  }),
});

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  ltkt_threshold: "LTKT / Nilai Besar",
  ltkm_suspicious: "LTKM Mencurigakan",
  blacklist_attempt: "DTTOT / Blacklist",
  low_cash: "Saldo Kas Rendah",
  approval_request: "Permintaan Persetujuan",
  approval_decision: "Keputusan Persetujuan",
  system: "Sistem",
};

function severityBadge(sev: NotificationRow["severity"]) {
  if (sev === "critical")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" /> Kritis
      </Badge>
    );
  if (sev === "warning")
    return (
      <Badge className="gap-1 bg-amber-500 text-white hover:bg-amber-500/90">
        <AlertTriangle className="h-3 w-3" /> Peringatan
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      <Info className="h-3 w-3" /> Info
    </Badge>
  );
}

function NotificationsPage() {
  const navigate = useNavigate();
  const { items, unread, userId, markRead, markAllRead, refresh } =
    useNotifications(200);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [category, setCategory] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [q, setQ] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setCurrentPage(1);
  }, [tab, category, severity, q]);

  const filtered = useMemo(() => {
    return items.filter((n) => {
      if (tab === "unread" && userId && (n.read_by ?? []).includes(userId))
        return false;
      if (category !== "all" && n.category !== category) return false;
      if (severity !== "all" && n.severity !== severity) return false;
      if (q.trim()) {
        const s = q.toLowerCase();
        return (
          n.title.toLowerCase().includes(s) ||
          n.message.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [items, tab, category, severity, q, userId]);

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const stats = useMemo(() => {
    return {
      total: items.length,
      unread: unread.length,
      critical: items.filter((n) => n.severity === "critical").length,
      today: items.filter((n) => {
        const d = new Date(n.created_at);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      }).length,
    };
  }, [items, unread]);

  const handleOpen = async (n: NotificationRow) => {
    if (userId && !(n.read_by ?? []).includes(userId)) {
      await markRead(n.id);
    }
    if (n.link) navigate({ to: n.link });
  };

  const handleMarkOne = async (id: string) => {
    await markRead(id);
    toast.success("Notifikasi ditandai dibaca");
  };

  const handleMarkAll = async () => {
    await markAllRead();
    toast.success("Semua notifikasi ditandai dibaca");
  };

  const handleRefresh = () => {
    refresh();
    toast.info("Memperbarui notifikasi...");
  };

  const resetFilters = () => {
    setQ("");
    setCategory("all");
    setSeverity("all");
    setTab("all");
  };

  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Notifikasi"
        description="Peringatan ambang batas, LTKT/LTKM, saldo kas, dan alur persetujuan."
        canWrite={false}
        extra={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              Perbarui
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAll}
              disabled={unread.length === 0}
              className="gap-1.5"
            >
              <CheckCheck className="h-4 w-4" />
              Tandai semua dibaca
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Notifikasi", value: stats.total, color: "text-foreground" },
          { label: "Belum Dibaca", value: stats.unread, color: stats.unread > 0 ? "text-primary" : "text-foreground" },
          { label: "Tingkat Kritis", value: stats.critical, color: stats.critical > 0 ? "text-destructive" : "text-foreground" },
          { label: "Diterima Hari Ini", value: stats.today, color: "text-foreground" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "unread")}>
              <TabsList>
                <TabsTrigger value="all">Semua</TabsTrigger>
                <TabsTrigger value="unread">
                  Belum dibaca {unread.length > 0 && `(${unread.length})`}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Cari notifikasi..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full sm:w-56"
              />
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua kategori</SelectItem>
                  {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="w-full sm:w-36">
                  <SelectValue placeholder="Tingkat" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua tingkat</SelectItem>
                  <SelectItem value="critical">Kritis</SelectItem>
                  <SelectItem value="warning">Peringatan</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
              {(q || category !== "all" || severity !== "all") && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  title="Reset filter"
                  onClick={resetFilters}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
              <Inbox className="h-10 w-10 stroke-[1.5] mb-3 opacity-40" />
              <div className="font-semibold text-foreground">Tidak ada notifikasi</div>
              <div className="text-xs text-muted-foreground mt-1 max-w-sm">
                {items.length === 0
                  ? "Belum ada notifikasi yang diterima untuk akun Anda."
                  : "Tidak ada notifikasi yang cocok dengan filter pencarian saat ini."}
              </div>
              {(q || category !== "all" || severity !== "all" || tab !== "all") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetFilters}
                  className="mt-4"
                >
                  Reset Filter
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {paginatedItems.map((n) => {
                const isUnread = userId
                  ? !(n.read_by ?? []).includes(userId)
                  : false;
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-start sm:gap-4 hover:bg-muted/40",
                      isUnread && "bg-primary/5 font-medium",
                    )}
                  >
                    <div className="flex flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {severityBadge(n.severity)}
                        <Badge variant="outline" className="text-xs font-normal">
                          {CATEGORY_LABEL[n.category] ?? n.category}
                        </Badge>
                        {isUnread && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                            BARU
                          </span>
                        )}
                      </div>
                      <div className="font-semibold text-foreground text-sm leading-snug">
                        {n.title}
                      </div>
                      <div className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                        {n.message}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {format(new Date(n.created_at), "dd MMM yyyy HH:mm", {
                          locale: idLocale,
                        })}
                        {" • "}
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                          locale: idLocale,
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      {isUnread && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs gap-1"
                          onClick={() => handleMarkOne(n.id)}
                        >
                          <CheckCheck className="h-3.5 w-3.5" />
                          Tandai
                        </Button>
                      )}
                      {n.link && (
                        <Button
                          size="sm"
                          className="h-8 text-xs gap-1"
                          onClick={() => handleOpen(n)}
                        >
                          Buka
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {filtered.length > 0 && (
            <div className="pt-2">
              <DataTablePagination
                currentPage={currentPage}
                pageSize={pageSize}
                totalRecords={filtered.length}
                onPageChange={setCurrentPage}
                onPageSizeChange={(sz) => {
                  setPageSize(sz);
                  setCurrentPage(1);
                }}
                entityLabel="notifikasi"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}