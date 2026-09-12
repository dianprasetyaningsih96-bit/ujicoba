import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Pencil,
  Trash2,
  Users,
  Search,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { MasterPageHeader } from "@/components/master-data/page-header";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { CustomerDocumentsDialog } from "@/components/customers/customer-documents-dialog";
import { COUNTRIES } from "@/lib/countries";
import { screenAgainstDttot } from "@/lib/dttot-screening";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { up, upReq, UPPERCASE_FORM } from "@/lib/text-case";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

type CustomerType = "individual" | "corporate";
type IdType = "ktp" | "passport" | "kitas" | "sim" | "npwp" | "other";
type RiskRating = "low" | "medium" | "high";
type KycStatus = "pending" | "verified" | "rejected" | "expired";

interface Customer {
  id: string;
  customer_code: string;
  customer_type: CustomerType;
  full_name: string;
  id_type: IdType;
  id_number: string;
  id_expiry_date: string | null;
  date_of_birth: string | null;
  place_of_birth: string | null;
  nationality: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  occupation: string | null;
  employer: string | null;
  source_of_funds: string | null;
  purpose_of_transaction: string | null;
  monthly_income_range: string | null;
  company_name: string | null;
  npwp_number: string | null;
  business_type: string | null;
  is_pep: boolean;
  pep_notes: string | null;
  risk_rating: RiskRating;
  kyc_status: KycStatus;
  kyc_notes: string | null;
  is_blacklisted: boolean;
  blacklist_reason: string | null;
  branch_id: string | null;
  created_at: string;
}

const customerSchema = z.object({
  customer_type: z.enum(["individual", "corporate"]),
  full_name: z.string().trim().min(2, "Nama minimal 2 karakter").max(150),
  id_type: z.enum(["ktp", "passport", "kitas", "sim", "npwp", "other"]),
  id_number: z.string().trim().min(3, "Nomor identitas wajib").max(50),
  id_expiry_date: z.string().optional().or(z.literal("")),
  date_of_birth: z.string().optional().or(z.literal("")),
  place_of_birth: z.string().trim().max(100).optional().or(z.literal("")),
  nationality: z.string().trim().max(3).optional().or(z.literal("")),
  gender: z.string().optional().or(z.literal("")),
  address: z.string().trim().max(255).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  province: z.string().trim().max(100).optional().or(z.literal("")),
  postal_code: z.string().trim().max(10).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email("Email tidak valid").max(150).optional().or(z.literal("")),
  occupation: z.string().trim().max(100).optional().or(z.literal("")),
  employer: z.string().trim().max(150).optional().or(z.literal("")),
  source_of_funds: z.string().trim().max(150).optional().or(z.literal("")),
  purpose_of_transaction: z.string().trim().max(150).optional().or(z.literal("")),
  monthly_income_range: z.string().optional().or(z.literal("")),
  company_name: z.string().trim().max(150).optional().or(z.literal("")),
  npwp_number: z.string().trim().max(30).optional().or(z.literal("")),
  business_type: z.string().trim().max(100).optional().or(z.literal("")),
  is_pep: z.boolean(),
  pep_notes: z.string().trim().max(500).optional().or(z.literal("")),
  risk_rating: z.enum(["low", "medium", "high"]),
  kyc_status: z.enum(["pending", "verified", "rejected", "expired"]),
  kyc_notes: z.string().trim().max(1000).optional().or(z.literal("")),
  is_blacklisted: z.boolean(),
  blacklist_reason: z.string().trim().max(500).optional().or(z.literal("")),
  branch_id: z.string().optional().or(z.literal("")),
});

type CustomerForm = z.infer<typeof customerSchema>;

const empty: CustomerForm = {
  customer_type: "individual",
  full_name: "",
  id_type: "ktp",
  id_number: "",
  id_expiry_date: "",
  date_of_birth: "",
  place_of_birth: "",
  nationality: "ID",
  gender: "",
  address: "",
  city: "",
  province: "",
  postal_code: "",
  phone: "",
  email: "",
  occupation: "",
  employer: "",
  source_of_funds: "",
  purpose_of_transaction: "",
  monthly_income_range: "",
  company_name: "",
  npwp_number: "",
  business_type: "",
  is_pep: false,
  pep_notes: "",
  risk_rating: "low",
  kyc_status: "pending",
  kyc_notes: "",
  is_blacklisted: false,
  blacklist_reason: "",
  branch_id: "",
};

const ID_TYPE_LABEL: Record<IdType, string> = {
  ktp: "KTP",
  passport: "Paspor",
  kitas: "KITAS",
  sim: "SIM",
  npwp: "NPWP",
  other: "Lainnya",
};

const KYC_LABEL: Record<KycStatus, string> = {
  pending: "Menunggu",
  verified: "Terverifikasi",
  rejected: "Ditolak",
  expired: "Kadaluarsa",
};

const RISK_LABEL: Record<RiskRating, string> = {
  low: "Rendah",
  medium: "Menengah",
  high: "Tinggi",
};

const INCOME_RANGES = [
  "< Rp 5 juta",
  "Rp 5 - 15 juta",
  "Rp 15 - 50 juta",
  "Rp 50 - 100 juta",
  "> Rp 100 juta",
];

const SOURCE_OF_FUNDS_OPTIONS = [
  "Gaji / Penghasilan Tetap",
  "Hasil Usaha",
  "Investasi",
  "Warisan / Hibah",
  "Penjualan Aset",
  "Lainnya",
];

const PURPOSE_OPTIONS = [
  "Perjalanan / Wisata",
  "Pendidikan",
  "Kesehatan",
  "Bisnis / Perdagangan",
  "Kebutuhan Pribadi",
  "Lainnya",
];

function CustomersPage() {
  const { roles, user } = useCurrentUser();
  const canWrite = hasAnyRole(roles, [
    "super_admin",
    "branch_manager",
    "teller",
    "owner",
  ]);
  const canDelete = hasAnyRole(roles, ["super_admin", "owner"]);

  const [rows, setRows] = useState<Customer[] | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
  const [search, setSearch] = useState("");
  
  const routerSearch = Route.useSearch() as any;
  useEffect(() => {
    if (routerSearch.search) {
      setSearch(routerSearch.search);
    }
  }, [routerSearch.search]);
  const [filterKyc, setFilterKyc] = useState<string>("all");
  const [filterRisk, setFilterRisk] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(empty);
  const [saving, setSaving] = useState(false);
  const [docsCustomer, setDocsCustomer] = useState<Customer | null>(null);
  const [dttotWarning, setDttotWarning] = useState<string | null>(null);

  async function load() {
    const [{ data: c, error }, { data: b }] = await Promise.all([
      supabase.from("customers").select("*").order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name, code").order("code"),
    ]);
    if (error) {
      toast.error("Gagal memuat nasabah", { description: error.message });
      return;
    }
    setRows((c as Customer[]) ?? []);
    setBranches((b as { id: string; name: string; code: string }[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  // Real-time screening deteksi DTTOT saat form diisi
  useEffect(() => {
    if (!open) {
      setDttotWarning(null);
      return;
    }
    const timer = setTimeout(async () => {
      const hasId = Boolean(form.id_number && form.id_number.trim().length >= 4);
      const hasName = Boolean(form.full_name && form.full_name.trim().length >= 3);
      if (hasId || hasName) {
        const res = await screenAgainstDttot(form.full_name, form.id_number);
        if (res.isMatch) {
          setDttotWarning(
            `Kecocokan ditemukan pada DTTOT: ${res.matchedEntry?.full_name} (${res.matchedEntry?.reference_code || "DTTOT"}). ${res.reason}. Sesuai regulasi Bank Indonesia, data nasabah ini TIDAK BISA disimpan.`
          );
        } else {
          setDttotWarning(null);
        }
      } else {
        setDttotWarning(null);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [form.id_number, form.full_name, open]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterKyc !== "all" && r.kyc_status !== filterKyc) return false;
      if (filterRisk !== "all" && r.risk_rating !== filterRisk) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        r.id_number.toLowerCase().includes(q) ||
        r.customer_code.toLowerCase().includes(q) ||
        (r.phone ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, filterKyc, filterRisk]);

  // Pagination Nasabah
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterKyc, filterRisk]);

  const paginatedRows = useMemo(() => {
    if (!filtered) return null;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const stats = useMemo(() => {
    if (!rows) return null;
    return {
      total: rows.length,
      verified: rows.filter((r) => r.kyc_status === "verified").length,
      pending: rows.filter((r) => r.kyc_status === "pending").length,
      high: rows.filter((r) => r.risk_rating === "high").length,
    };
  }, [rows]);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }

  function openEdit(row: Customer) {
    setEditing(row);
    setForm({
      customer_type: row.customer_type,
      full_name: row.full_name,
      id_type: row.id_type,
      id_number: row.id_number,
      id_expiry_date: row.id_expiry_date ?? "",
      date_of_birth: row.date_of_birth ?? "",
      place_of_birth: row.place_of_birth ?? "",
      nationality: row.nationality ?? "ID",
      gender: row.gender ?? "",
      address: row.address ?? "",
      city: row.city ?? "",
      province: row.province ?? "",
      postal_code: row.postal_code ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      occupation: row.occupation ?? "",
      employer: row.employer ?? "",
      source_of_funds: row.source_of_funds ?? "",
      purpose_of_transaction: row.purpose_of_transaction ?? "",
      monthly_income_range: row.monthly_income_range ?? "",
      company_name: row.company_name ?? "",
      npwp_number: row.npwp_number ?? "",
      business_type: row.business_type ?? "",
      is_pep: row.is_pep,
      pep_notes: row.pep_notes ?? "",
      risk_rating: row.risk_rating,
      kyc_status: row.kyc_status,
      kyc_notes: row.kyc_notes ?? "",
      is_blacklisted: row.is_blacklisted,
      blacklist_reason: row.blacklist_reason ?? "",
      branch_id: row.branch_id ?? "",
    });
    setOpen(true);
  }

  async function save() {
    const parsed = customerSchema.safeParse(form);
    if (!parsed.success) {
      toast.error("Data tidak valid", {
        description: parsed.error.issues[0]?.message,
      });
      return;
    }
    const d = parsed.data;
    setSaving(true);
    const now = new Date().toISOString();
    const wasVerified = editing?.kyc_status === "verified";
    const nowVerified = d.kyc_status === "verified";
    const payload: Record<string, unknown> = {
      customer_type: d.customer_type,
      full_name: upReq(d.full_name),
      id_type: d.id_type,
      id_number: upReq(d.id_number),
      id_expiry_date: d.id_expiry_date || null,
      date_of_birth: d.date_of_birth || null,
      place_of_birth: up(d.place_of_birth),
      nationality: d.nationality || null,
      gender: d.gender || null,
      address: up(d.address),
      city: up(d.city),
      province: up(d.province),
      postal_code: d.postal_code || null,
      phone: d.phone || null,
      email: d.email || null,
      occupation: up(d.occupation),
      employer: up(d.employer),
      source_of_funds: up(d.source_of_funds),
      purpose_of_transaction: up(d.purpose_of_transaction),
      monthly_income_range: d.monthly_income_range || null,
      company_name: up(d.company_name),
      npwp_number: up(d.npwp_number),
      business_type: up(d.business_type),
      is_pep: d.is_pep,
      pep_notes: up(d.pep_notes),
      risk_rating: d.risk_rating,
      kyc_status: d.kyc_status,
      kyc_notes: up(d.kyc_notes),
      is_blacklisted: d.is_blacklisted,
      blacklist_reason: up(d.blacklist_reason),
      branch_id: d.branch_id || null,
    };

    // Real-time screening against DTTOT list (Pencegahan Mutlak)
    const screening = await screenAgainstDttot(d.full_name, d.id_number);
    if (screening.isMatch) {
      setSaving(false);
      const m = screening.matchedEntry;
      toast.error("PENDAFTARAN DITOLAK: TERMASUK DAFTAR DTTOT!", {
        description: `Nasabah DITOLAK karena teridentifikasi dalam DTTOT Bank Indonesia (${m?.full_name} - ${m?.reference_code || "DTTOT"}). ${screening.reason}. Sesuai regulasi BI, data nasabah DTTOT dilarang disimpan!`,
        duration: 10000,
      });
      return; // STOP! JANGAN SIMPAN KE DATABASE!
    }

    if (!editing) {
      payload.created_by = user?.id ?? null;
    }
    if (nowVerified && !wasVerified) {
      payload.kyc_verified_at = now;
      payload.kyc_verified_by = user?.id ?? null;
    }
    const { error } = editing
      ? await supabase.from("customers").update(payload).eq("id", editing.id)
      : await supabase.from("customers").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Gagal menyimpan", { description: error.message });
      return;
    }
    toast.success(editing ? "Nasabah diperbarui" : "Nasabah ditambahkan");
    setOpen(false);
    load();
  }

  async function remove() {
    if (!deleting) return;
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", deleting.id);
    setDeleting(null);
    if (error) {
      toast.error("Gagal menghapus", { description: error.message });
      return;
    }
    toast.success("Nasabah dihapus");
    load();
  }

  const isCorporate = form.customer_type === "corporate";

  return (
    <div className="flex flex-col gap-6 p-6">
      <MasterPageHeader
        title="Nasabah & KYC"
        description="Kelola data nasabah, verifikasi KYC/CDD, dan penilaian risiko sesuai peraturan Bank Indonesia."
        onAdd={openCreate}
        addLabel="Tambah Nasabah"
        canWrite={canWrite}
      />

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Nasabah"
            value={stats.total}
            icon={<Users className="h-4 w-4" />}
          />
          <StatCard
            label="KYC Terverifikasi"
            value={stats.verified}
            icon={<ShieldCheck className="h-4 w-4 text-primary" />}
          />
          <StatCard
            label="KYC Menunggu"
            value={stats.pending}
            icon={<ShieldAlert className="h-4 w-4 text-amber-500" />}
          />
          <StatCard
            label="Risiko Tinggi"
            value={stats.high}
            icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          />
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, kode, no. identitas, telepon, email…"
                className="pl-9"
              />
            </div>
            <Select value={filterKyc} onValueChange={setFilterKyc}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Status KYC" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status KYC</SelectItem>
                <SelectItem value="pending">Menunggu</SelectItem>
                <SelectItem value="verified">Terverifikasi</SelectItem>
                <SelectItem value="rejected">Ditolak</SelectItem>
                <SelectItem value="expired">Kadaluarsa</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRisk} onValueChange={setFilterRisk}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Risiko" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Risiko</SelectItem>
                <SelectItem value="low">Rendah</SelectItem>
                <SelectItem value="medium">Menengah</SelectItem>
                <SelectItem value="high">Tinggi</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Identitas</TableHead>
                <TableHead>Telepon</TableHead>
                <TableHead>KYC</TableHead>
                <TableHead>Risiko</TableHead>
                <TableHead>Flag</TableHead>
                <TableHead className="w-32 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered === null ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {rows && rows.length > 0
                        ? "Tidak ada nasabah yang cocok dengan filter."
                        : "Belum ada nasabah. Tambahkan nasabah pertama Anda."}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows?.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {row.customer_code}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{row.full_name}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {row.customer_type === "individual"
                          ? "Perorangan"
                          : "Badan Usaha"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <span className="font-medium">
                          {ID_TYPE_LABEL[row.id_type]}
                        </span>{" "}
                        <span className="font-mono">{row.id_number}</span>
                      </div>
                    </TableCell>
                    <TableCell>{row.phone ?? "—"}</TableCell>
                    <TableCell>
                      <KycBadge status={row.kyc_status} />
                    </TableCell>
                    <TableCell>
                      <RiskBadge risk={row.risk_rating} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {row.is_pep && (
                          <Badge variant="outline" className="text-xs">
                            PEP
                          </Badge>
                        )}
                        {row.is_blacklisted && (
                          <Badge variant="destructive" className="text-xs">
                            DTTOT
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDocsCustomer(row)}
                          title="Dokumen KYC"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                        {canWrite && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleting(row)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {filtered && (
            <DataTablePagination
              currentPage={currentPage}
              pageSize={pageSize}
              totalRecords={filtered.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setCurrentPage(1);
              }}
              entityLabel="nasabah"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={`max-w-3xl max-h-[90vh] overflow-y-auto ${UPPERCASE_FORM}`}>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit Nasabah — ${editing.customer_code}` : "Tambah Nasabah"}
            </DialogTitle>
            <DialogDescription>
              Lengkapi data KYC/CDD sesuai ketentuan Bank Indonesia untuk KUPVA BB.
            </DialogDescription>
          </DialogHeader>

          {dttotWarning && (
            <div className="rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-destructive flex items-start gap-2.5 text-xs font-medium animate-in fade-in-50">
              <ShieldAlert className="h-5 w-5 flex-shrink-0 text-destructive mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-sm block tracking-wide">
                  ⛔ PENDAFTARAN DITOLAK: TERMASUK DAFTAR DTTOT
                </span>
                <p className="leading-relaxed text-destructive/90">{dttotWarning}</p>
              </div>
            </div>
          )}

          <Tabs defaultValue="identity" className="w-full">
            <div className="-mx-1 overflow-x-auto sm:mx-0">
              <TabsList className="inline-flex w-max min-w-full gap-1 sm:grid sm:w-full sm:grid-cols-4 sm:gap-0">
                <TabsTrigger value="identity" className="whitespace-nowrap text-xs sm:text-sm">Identitas</TabsTrigger>
                <TabsTrigger value="contact" className="whitespace-nowrap text-xs sm:text-sm">Alamat & Kontak</TabsTrigger>
                <TabsTrigger value="profile" className="whitespace-nowrap text-xs sm:text-sm">Profil Ekonomi</TabsTrigger>
                <TabsTrigger value="kyc" className="whitespace-nowrap text-xs sm:text-sm">KYC & Risiko</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="identity" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Jenis Nasabah *">
                  <Select
                    value={form.customer_type}
                    onValueChange={(v: CustomerType) =>
                      setForm({ ...form, customer_type: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="individual">Perorangan</SelectItem>
                      <SelectItem value="corporate">Badan Usaha</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Cabang">
                  <Select
                    value={form.branch_id || "none"}
                    onValueChange={(v) =>
                      setForm({ ...form, branch_id: v === "none" ? "" : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih cabang" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Tidak ditentukan —</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.code} — {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Nama Lengkap *" className="col-span-2">
                  <Input
                    value={form.full_name}
                    onChange={(e) =>
                      setForm({ ...form, full_name: e.target.value })
                    }
                    maxLength={150}
                  />
                </Field>
                <Field label="Jenis Identitas *">
                  <Select
                    value={form.id_type}
                    onValueChange={(v: IdType) =>
                      setForm({ ...form, id_type: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ID_TYPE_LABEL) as IdType[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {ID_TYPE_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Nomor Identitas *">
                  <Input
                    value={form.id_number}
                    onChange={(e) =>
                      setForm({ ...form, id_number: e.target.value })
                    }
                    maxLength={50}
                    className="font-mono"
                  />
                </Field>
                <Field label="Tanggal Berlaku">
                  <Input
                    type="date"
                    value={form.id_expiry_date ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, id_expiry_date: e.target.value })
                    }
                  />
                </Field>
                <Field label="Kewarganegaraan">
                  <Select
                    value={form.nationality || "ID"}
                    onValueChange={(v) =>
                      setForm({ ...form, nationality: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih negara" />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {!isCorporate && (
                  <>
                    <Field label="Tanggal Lahir">
                      <Input
                        type="date"
                        value={form.date_of_birth ?? ""}
                        onChange={(e) =>
                          setForm({ ...form, date_of_birth: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Tempat Lahir">
                      <Input
                        value={form.place_of_birth ?? ""}
                        onChange={(e) =>
                          setForm({ ...form, place_of_birth: e.target.value })
                        }
                        maxLength={100}
                      />
                    </Field>
                    <Field label="Jenis Kelamin">
                      <Select
                        value={form.gender || "unset"}
                        onValueChange={(v) =>
                          setForm({ ...form, gender: v === "unset" ? "" : v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unset">—</SelectItem>
                          <SelectItem value="L">Laki-laki</SelectItem>
                          <SelectItem value="P">Perempuan</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </>
                )}
                {isCorporate && (
                  <>
                    <Field label="Nama Perusahaan" className="col-span-2">
                      <Input
                        value={form.company_name ?? ""}
                        onChange={(e) =>
                          setForm({ ...form, company_name: e.target.value })
                        }
                        maxLength={150}
                      />
                    </Field>
                    <Field label="NPWP">
                      <Input
                        value={form.npwp_number ?? ""}
                        onChange={(e) =>
                          setForm({ ...form, npwp_number: e.target.value })
                        }
                        maxLength={30}
                      />
                    </Field>
                    <Field label="Jenis Usaha">
                      <Input
                        value={form.business_type ?? ""}
                        onChange={(e) =>
                          setForm({ ...form, business_type: e.target.value })
                        }
                        maxLength={100}
                      />
                    </Field>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="contact" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Alamat" className="col-span-2">
                  <Textarea
                    value={form.address ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, address: e.target.value })
                    }
                    maxLength={255}
                    rows={2}
                  />
                </Field>
                <Field label="Kota">
                  <Input
                    value={form.city ?? ""}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    maxLength={100}
                  />
                </Field>
                <Field label="Provinsi">
                  <Input
                    value={form.province ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, province: e.target.value })
                    }
                    maxLength={100}
                  />
                </Field>
                <Field label="Kode Pos">
                  <Input
                    value={form.postal_code ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, postal_code: e.target.value })
                    }
                    maxLength={10}
                  />
                </Field>
                <Field label="Telepon">
                  <Input
                    value={form.phone ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                    maxLength={30}
                  />
                </Field>
                <Field label="Email" className="col-span-2">
                  <Input
                    type="email"
                    value={form.email ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    maxLength={150}
                  />
                </Field>
              </div>
            </TabsContent>

            <TabsContent value="profile" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Pekerjaan">
                  <Input
                    value={form.occupation ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, occupation: e.target.value })
                    }
                    maxLength={100}
                  />
                </Field>
                <Field label="Perusahaan / Tempat Bekerja">
                  <Input
                    value={form.employer ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, employer: e.target.value })
                    }
                    maxLength={150}
                  />
                </Field>
                <Field label="Sumber Dana">
                  <Select
                    value={form.source_of_funds || "unset"}
                    onValueChange={(v) =>
                      setForm({ ...form, source_of_funds: v === "unset" ? "" : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih sumber dana" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">—</SelectItem>
                      {SOURCE_OF_FUNDS_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Tujuan Transaksi">
                  <Select
                    value={form.purpose_of_transaction || "unset"}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        purpose_of_transaction: v === "unset" ? "" : v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih tujuan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">—</SelectItem>
                      {PURPOSE_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Kisaran Penghasilan Bulanan" className="col-span-2">
                  <Select
                    value={form.monthly_income_range || "unset"}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        monthly_income_range: v === "unset" ? "" : v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih kisaran" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">—</SelectItem>
                      {INCOME_RANGES.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </TabsContent>

            <TabsContent value="kyc" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Status KYC *">
                  <Select
                    value={form.kyc_status}
                    onValueChange={(v: KycStatus) =>
                      setForm({ ...form, kyc_status: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(KYC_LABEL) as KycStatus[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {KYC_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Rating Risiko *">
                  <Select
                    value={form.risk_rating}
                    onValueChange={(v: RiskRating) =>
                      setForm({ ...form, risk_rating: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(RISK_LABEL) as RiskRating[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {RISK_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Catatan KYC" className="col-span-2">
                  <Textarea
                    value={form.kyc_notes ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, kyc_notes: e.target.value })
                    }
                    rows={2}
                    maxLength={1000}
                    placeholder="Ringkasan hasil verifikasi, dokumen pendukung, dsb."
                  />
                </Field>

                <div className="col-span-2 rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="font-medium">Politically Exposed Person (PEP)</Label>
                      <p className="text-xs text-muted-foreground">
                        Tandai bila nasabah / keluarganya menjabat posisi publik.
                      </p>
                    </div>
                    <Switch
                      checked={form.is_pep}
                      onCheckedChange={(v) => setForm({ ...form, is_pep: v })}
                    />
                  </div>
                  {form.is_pep && (
                    <Textarea
                      value={form.pep_notes ?? ""}
                      onChange={(e) =>
                        setForm({ ...form, pep_notes: e.target.value })
                      }
                      rows={2}
                      maxLength={500}
                      placeholder="Jabatan / hubungan PEP…"
                    />
                  )}
                </div>

                <div className="col-span-2 rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="font-medium text-destructive">DTTOT (Daftar Terduga Teroris)</Label>
                      <p className="text-xs text-muted-foreground">
                        Transaksi akan ditolak untuk nasabah yang masuk DTTOT.
                      </p>
                    </div>
                    <Switch
                      checked={form.is_blacklisted}
                      onCheckedChange={(v) =>
                        setForm({ ...form, is_blacklisted: v })
                      }
                    />
                  </div>
                  {form.is_blacklisted && (
                    <Textarea
                      value={form.blacklist_reason ?? ""}
                      onChange={(e) =>
                        setForm({ ...form, blacklist_reason: e.target.value })
                      }
                      rows={2}
                      maxLength={500}
                      placeholder="Alasan pemblokiran…"
                    />
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={save}
              disabled={saving || Boolean(dttotWarning)}
              variant={dttotWarning ? "destructive" : "default"}
              className={dttotWarning ? "bg-destructive text-destructive-foreground cursor-not-allowed" : ""}
            >
              {saving
                ? "Menyimpan..."
                : dttotWarning
                ? "⛔ Ditolak (DTTOT)"
                : editing
                ? "Simpan Perubahan"
                : "Simpan"}
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
            <AlertDialogTitle>Hapus nasabah?</AlertDialogTitle>
            <AlertDialogDescription>
              Nasabah <strong>{deleting?.full_name}</strong> ({deleting?.customer_code})
              akan dihapus permanen. Aksi ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {docsCustomer && (
        <CustomerDocumentsDialog
          open={!!docsCustomer}
          onOpenChange={(o) => !o && setDocsCustomer(null)}
          customerId={docsCustomer.id}
          customerName={docsCustomer.full_name}
          customerCode={docsCustomer.customer_code}
        />
      )}
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="text-2xl font-bold mt-2">{value}</div>
      </CardContent>
    </Card>
  );
}

function KycBadge({ status }: { status: KycStatus }) {
  const variants: Record<KycStatus, { cls: string; label: string }> = {
    verified: {
      cls: "bg-primary/10 text-primary border-primary/20",
      label: "Terverifikasi",
    },
    pending: {
      cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
      label: "Menunggu",
    },
    rejected: {
      cls: "bg-destructive/10 text-destructive border-destructive/20",
      label: "Ditolak",
    },
    expired: {
      cls: "bg-muted text-muted-foreground border-border",
      label: "Kadaluarsa",
    },
  };
  const v = variants[status];
  return (
    <Badge variant="outline" className={v.cls}>
      {v.label}
    </Badge>
  );
}

function RiskBadge({ risk }: { risk: RiskRating }) {
  const variants: Record<RiskRating, { cls: string; label: string }> = {
    low: {
      cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
      label: "Rendah",
    },
    medium: {
      cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
      label: "Menengah",
    },
    high: {
      cls: "bg-destructive/10 text-destructive border-destructive/20",
      label: "Tinggi",
    },
  };
  const v = variants[risk];
  return (
    <Badge variant="outline" className={v.cls}>
      {v.label}
    </Badge>
  );
}