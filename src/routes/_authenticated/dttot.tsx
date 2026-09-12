import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import * as XLSX from "xlsx";
import {
  Pencil,
  Trash2,
  ShieldAlert,
  Search,
  Upload,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
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

export const Route = createFileRoute("/_authenticated/dttot")({
  head: () => ({
    meta: [
      { title: "DTTOT — Daftar Terduga Teroris" },
      {
        name: "description",
        content:
          "Kelola Daftar Terduga Teroris dan Organisasi Teroris (DTTOT) untuk screening nasabah.",
      },
    ],
  }),
  component: DttotPage,
});

type EntityType = "individual" | "organization";

interface DttotRow {
  id: string;
  reference_code: string | null;
  entity_type: EntityType;
  full_name: string;
  aliases: string | null;
  identity_number: string | null;
  place_of_birth: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  address: string | null;
  source: string | null;
  listed_at: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

const schema = z.object({
  reference_code: z.string().trim().max(100).optional().or(z.literal("")),
  entity_type: z.enum(["individual", "organization"]),
  full_name: z.string().trim().min(2, "Nama minimal 2 karakter").max(500),
  aliases: z.string().trim().max(5000).optional().or(z.literal("")),
  identity_number: z.string().trim().max(1000).optional().or(z.literal("")),
  place_of_birth: z.string().trim().max(300).optional().or(z.literal("")),
  date_of_birth: z.string().optional().or(z.literal("")),
  nationality: z.string().trim().max(300).optional().or(z.literal("")),
  address: z.string().trim().max(3000).optional().or(z.literal("")),
  source: z.string().trim().max(300).optional().or(z.literal("")),
  listed_at: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(10000).optional().or(z.literal("")),
  is_active: z.boolean(),
});

type FormShape = z.infer<typeof schema>;

const empty: FormShape = {
  reference_code: "",
  entity_type: "individual",
  full_name: "",
  aliases: "",
  identity_number: "",
  place_of_birth: "",
  date_of_birth: "",
  nationality: "",
  address: "",
  source: "",
  listed_at: "",
  notes: "",
  is_active: true,
};

function DttotPage() {
  const { roles } = useCurrentUser();
  const canWrite = hasAnyRole(roles, ["super_admin", "owner", "auditor"]);

  const [rows, setRows] = useState<DttotRow[] | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | EntityType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "all",
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DttotRow | null>(null);
  const [deleting, setDeleting] = useState<DttotRow | null>(null);
  const [form, setForm] = useState<FormShape>(empty);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("dttot_list")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) {
      toast.error("Gagal memuat DTTOT", { description: error.message });
      return;
    }
    setRows((data as DttotRow[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [q, typeFilter, statusFilter]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.entity_type !== typeFilter) return false;
      if (statusFilter === "active" && !r.is_active) return false;
      if (statusFilter === "inactive" && r.is_active) return false;
      if (!needle) return true;
      return (
        r.full_name.toLowerCase().includes(needle) ||
        (r.aliases ?? "").toLowerCase().includes(needle) ||
        (r.identity_number ?? "").toLowerCase().includes(needle) ||
        (r.reference_code ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, typeFilter, statusFilter]);

  const paginatedRows = useMemo(() => {
    if (!filtered) return null;
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }

  function openEdit(row: DttotRow) {
    setEditing(row);
    setForm({
      reference_code: row.reference_code ?? "",
      entity_type: row.entity_type,
      full_name: row.full_name,
      aliases: row.aliases ?? "",
      identity_number: row.identity_number ?? "",
      place_of_birth: row.place_of_birth ?? "",
      date_of_birth: row.date_of_birth ?? "",
      nationality: row.nationality ?? "",
      address: row.address ?? "",
      source: row.source ?? "",
      listed_at: row.listed_at ?? "",
      notes: row.notes ?? "",
      is_active: row.is_active,
    });
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
    setSaving(true);
    const d = parsed.data;
    const payload = {
      reference_code: d.reference_code || null,
      entity_type: d.entity_type,
      full_name: d.full_name,
      aliases: d.aliases || null,
      identity_number: d.identity_number || null,
      place_of_birth: d.place_of_birth || null,
      date_of_birth: d.date_of_birth || null,
      nationality: d.nationality || null,
      address: d.address || null,
      source: d.source || null,
      listed_at: d.listed_at || null,
      notes: d.notes || null,
      is_active: d.is_active,
    };
    const { error } = editing
      ? await supabase.from("dttot_list").update(payload).eq("id", editing.id)
      : await supabase.from("dttot_list").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Gagal menyimpan", { description: error.message });
      return;
    }
    toast.success(editing ? "Entri DTTOT diperbarui" : "Entri DTTOT ditambahkan");
    setOpen(false);
    load();
  }

  async function remove() {
    if (!deleting) return;
    const { error } = await supabase
      .from("dttot_list")
      .delete()
      .eq("id", deleting.id);
    setDeleting(null);
    if (error) {
      toast.error("Gagal menghapus", { description: error.message });
      return;
    }
    toast.success("Entri DTTOT dihapus");
    load();
  }

  const activeCount = rows?.filter((r) => r.is_active).length ?? 0;

  // Helper to parse CSV lines handling semicolon/comma and multi-line quotes
  function parseCsvText(text: string): Record<string, string>[] {
    // Detect delimiter (semicolon or comma)
    const firstLine = text.split(/\r?\n/)[0] || "";
    const delimiter = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";

    const lines: string[][] = [];
    let currentRow: string[] = [];
    let currentField = "";
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === delimiter && !insideQuotes) {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if ((char === "\r" || char === "\n") && !insideQuotes) {
        if (char === "\r" && nextChar === "\n") i++;
        currentRow.push(currentField.trim());
        if (currentRow.some((c) => c.length > 0)) {
          lines.push(currentRow);
        }
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some((c) => c.length > 0)) {
        lines.push(currentRow);
      }
    }

    if (lines.length <= 1) return [];
    const headers = lines[0].map((h) =>
      h.replace(/^["']+|["']+$/g, "").trim().toLowerCase()
    );
    const results: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      const obj: Record<string, string> = {};
      headers.forEach((h, colIdx) => {
        obj[h] = row[colIdx] ?? "";
      });
      results.push(obj);
    }
    return results;
  }

  // Normalizer for Bank Indonesia and generic DTTOT records
  function normalizeDttotRecord(r: Record<string, unknown>, idx: number) {
    const getVal = (...keys: string[]): string => {
      for (const key of keys) {
        for (const [k, v] of Object.entries(r)) {
          const normK = k
            .replace(/^\uFEFF/, "")
            .replace(/[^a-zA-Z0-9]/g, "")
            .toLowerCase()
            .trim();
          const normTarget = key
            .replace(/[^a-zA-Z0-9]/g, "")
            .toLowerCase()
            .trim();
          if (normK === normTarget && v !== undefined && v !== null) {
            return String(v).trim();
          }
        }
      }
      return "";
    };

    let rawName = getVal("nama", "full_name", "name", "nama lengkap", "organisasi");
    const rawDesc = getVal("deskripsi", "description", "notes", "keterangan", "catatan");
    const rawTerduga = getVal("terduga", "entity_type", "tipe", "type", "jenis");
    const rawKode = getVal("kode densus", "kode", "kode_densus", "reference_code", "ref_code");
    const rawTempatLahir = getVal("tempat lahir", "tempat_lahir", "place_of_birth", "pob");
    const rawTglLahir = getVal("tanggal lahir", "tanggal_lahir", "date_of_birth", "dob");
    const rawWn = getVal("wn/asal negara", "wn", "kewarganegaraan", "nationality", "negara", "asal negara");
    const rawAlamat = getVal("alamat", "address", "domisili", "lokasi");

    // Fallback name if column name was not found
    if (!rawName || rawName.length < 2) {
      // Find first string value in object
      for (const [k, v] of Object.entries(r)) {
        if (v && String(v).trim().length >= 2) {
          rawName = String(v).trim();
          break;
        }
      }
      if (!rawName || rawName.length < 2) {
        rawName = rawKode ? `DTTOT ${rawKode}` : `Entri DTTOT #${idx + 1}`;
      }
    }

    // 1. Split full name & aliases
    let fullName = rawName;
    let aliases = getVal("aliases", "alias", "nama_alias");
    if (/(\s+alias\s+|\s+ALIAS\s+|\s+Alias\s+)/i.test(fullName)) {
      const parts = fullName.split(/\s+alias\s+|\s+ALIAS\s+|\s+Alias\s+/i);
      fullName = parts[0].replace(/^["']+|["']+$/g, "").trim();
      const extractedAliases = parts
        .slice(1)
        .map((p) => p.replace(/^["']+|["']+$/g, "").trim())
        .filter(Boolean);
      aliases = aliases
        ? `${aliases}, ${extractedAliases.join(", ")}`
        : extractedAliases.join(", ");
    }

    // 2. Extract NIK & Paspor numbers
    const extractedIds: string[] = [];
    const rawIdentity = getVal("identity_number", "nik", "paspor", "passport", "no_identitas");
    if (rawIdentity) extractedIds.push(rawIdentity);

    if (rawDesc || rawName) {
      const textToScan = `${rawName}\n${rawDesc}`;
      // 15/16-digit NIK
      const nik16 = textToScan.match(/\b\d{15,16}\b/g);
      if (nik16) nik16.forEach((n) => extractedIds.push(n));

      // NIK alphanumeric patterns (e.g. 64020U205820003, 33.7413.140383.0001)
      const nikAlpha = textToScan.match(/(?:NIK|KTP|No\.?\s*KTP)[^\n\r]*?([0-9A-Za-z\.\-]{8,25})/gi);
      if (nikAlpha) {
        nikAlpha.forEach((m) => {
          const clean = m.replace(/^(?:NIK|KTP|No\.?\s*KTP|nomor|no|an\.?|[\s:;,-])+/gi, "").trim();
          if (clean.length >= 7) extractedIds.push(clean);
        });
      }

      // Kartu Identitas Nasional / National ID (e.g. Kartu identitas nasional Prancis 070275Q007873)
      const idCardRegex = /(?:identitas|identifikasi|national\s*id|id\s*card|identity)[^\n\r]*?([0-9A-Za-z\.\-]{7,25})/gi;
      let idMatch;
      while ((idMatch = idCardRegex.exec(textToScan)) !== null) {
        if (idMatch[1]) {
          const clean = idMatch[1].replace(/^(?:nomor|no|an\.?|[\s:;,-])+/gi, "").trim();
          if (clean.length >= 7 && !/^(prancis|indonesia|malaysia|singapura|amerika)$/i.test(clean)) {
            extractedIds.push(clean);
          }
        }
      }

      // Format ID khusus alfanumerik (misal: 070275Q007873)
      const mixedAlnumRegex = /\b([0-9]{4,8}[A-Za-z][0-9A-Za-z]{4,10})\b/g;
      let mMatch;
      while ((mMatch = mixedAlnumRegex.exec(textToScan)) !== null) {
        if (mMatch[1] && mMatch[1].length >= 7) {
          extractedIds.push(mMatch[1].trim());
        }
      }

      // Paspor matches (e.g. A00044599, A6889028, S835649, PA2564100)
      const pasporRegex = /(?:paspor|passport)[^\n\r]*?([A-Za-z][0-9]{6,8}|[A-Za-z0-9]{7,10})/gi;
      let pMatch;
      while ((pMatch = pasporRegex.exec(textToScan)) !== null) {
        if (pMatch[1] && !pMatch[1].toLowerCase().includes("paspor")) {
          extractedIds.push(pMatch[1].trim());
        }
      }
    }

    const identityNumber = Array.from(
      new Set(extractedIds.map((i) => i.trim()).filter(Boolean))
    ).join(", ");

    // 3. Entity Type mapping
    const entityType: "individual" | "organization" =
      rawTerduga.toLowerCase().includes("korporasi") ||
      rawTerduga.toLowerCase().includes("organisasi") ||
      rawTerduga.toLowerCase().includes("organization")
        ? "organization"
        : "individual";

    return {
      reference_code: rawKode || null,
      entity_type: entityType,
      full_name: fullName,
      aliases: aliases || null,
      identity_number: identityNumber || null,
      place_of_birth: rawTempatLahir || null,
      date_of_birth: rawTglLahir || null,
      nationality: rawWn || null,
      address: rawAlamat || null,
      source: "Bank Indonesia (DTTOT)",
      listed_at: new Date().toISOString().slice(0, 10),
      notes: rawDesc || null,
      is_active: true,
    };
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      let rawRows: Record<string, unknown>[] = [];
      const buf = await file.arrayBuffer();
      
      // XLSX handles both CSV (semicolon/comma) and Excel XLSX/XLS files robustly
      const wb = XLSX.read(buf, { type: "array", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
      });

      // Fallback to text parser if XLSX yielded fewer rows
      if (rawRows.length <= 1) {
        const text = await file.text();
        const csvRows = parseCsvText(text);
        if (csvRows.length > rawRows.length) {
          rawRows = csvRows;
        }
      }

      if (rawRows.length === 0) {
        toast.error("File kosong atau format tidak dapat dibaca");
        setImporting(false);
        return;
      }

      const payloads: Array<Record<string, unknown>> = [];
      const errors: string[] = [];

      rawRows.forEach((r, idx) => {
        const normalized = normalizeDttotRecord(r, idx);
        if (normalized.full_name) {
          payloads.push(normalized);
        }
      });

      if (payloads.length === 0) {
        toast.error("Tidak ada baris DTTOT valid untuk diimpor");
        setImporting(false);
        return;
      }

      // Chunked insert / upsert into Supabase dttot_list
      const chunkSize = 50;
      let insertedCount = 0;
      for (let i = 0; i < payloads.length; i += chunkSize) {
        const chunk = payloads.slice(i, i + chunkSize);
        
        // Use upsert on reference_code when present, or insert
        const { error: insertErr } = await supabase
          .from("dttot_list")
          .upsert(chunk, { onConflict: "reference_code", ignoreDuplicates: false });

        if (insertErr) {
          console.error("Chunk upsert error, trying standard insert:", insertErr);
          // Fallback to standard insert if upsert constraint differs
          const { error: fallbackErr } = await supabase.from("dttot_list").insert(chunk);
          if (fallbackErr) {
            console.error("Insert error:", fallbackErr);
            toast.error("Gagal mengimpor sebagian data", { description: fallbackErr.message });
            break;
          }
        }
        insertedCount += chunk.length;
      }

      // Automatically sync customer database against DTTOT list
      try {
        const { data: activeDttot } = await supabase
          .from("dttot_list")
          .select("full_name, identity_number, reference_code")
          .eq("is_active", true);

        const { data: customerList } = await supabase
          .from("customers")
          .select("id, full_name, id_number, is_blacklisted");

        if (activeDttot && customerList) {
          for (const cust of customerList) {
            const custName = (cust.full_name || "").toLowerCase().trim();
            const custId = (cust.id_number || "").toLowerCase().replace(/[^0-9a-z]/g, "");

            const match = activeDttot.find((d) => {
              const dName = (d.full_name || "").toLowerCase().trim();
              const dId = (d.identity_number || "").toLowerCase();
              if (custName && dName && (custName === dName || dName.includes(custName))) return true;
              if (custId && dId && dId.includes(custId)) return true;
              return false;
            });

            if (match && !cust.is_blacklisted) {
              await supabase
                .from("customers")
                .update({
                  is_blacklisted: true,
                  blacklist_reason: `Teridentifikasi DTTOT Bank Indonesia (Kode: ${match.reference_code || "DTTOT"})`,
                })
                .eq("id", cust.id);
            }
          }
        }
      } catch (syncErr) {
        console.warn("Auto customer sync error:", syncErr);
      }

      toast.success(`Berhasil mengimpor ${insertedCount} data DTTOT Bank Indonesia`, {
        description:
          errors.length > 0
            ? `${errors.length} baris dilewati karena format tidak sesuai`
            : "Data siap digunakan untuk screening & pemblokiran transaksi otomatis.",
      });

      load();
    } catch (err) {
      toast.error("Gagal membaca file", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
    setImporting(false);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <MasterPageHeader
        title="DTTOT"
        description="Daftar Terduga Teroris dan Organisasi Teroris — digunakan untuk screening nasabah pada proses CDD/EDD."
        onAdd={openCreate}
        addLabel="Tambah Entri"
        canWrite={canWrite}
        extra={
          <>
            {canWrite && (
              <Button
                variant="outline"
                size="sm"
                asChild
                disabled={importing}
                className="gap-2"
              >
                <label className="cursor-pointer">
                  <Upload className="h-4 w-4" />
                  {importing ? "Mengimpor..." : "Import Excel"}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleImport}
                    disabled={importing}
                  />
                </label>
              </Button>
            )}
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama, alias, NIK/paspor, kode referensi…"
              className="pl-9"
            />
          </div>
          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Tipe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua tipe</SelectItem>
              <SelectItem value="individual">Perorangan</SelectItem>
              <SelectItem value="organization">Organisasi</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="inactive">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground shrink-0">
            <span className="font-medium text-foreground">{activeCount}</span>{" "}
            aktif · {rows?.length ?? 0} total
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama / Organisasi</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Identitas</TableHead>
                <TableHead>Kebangsaan</TableHead>
                <TableHead>Sumber</TableHead>
                <TableHead>Tgl Daftar</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered === null ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center">
                    <ShieldAlert className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Belum ada entri DTTOT yang sesuai filter.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows?.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {row.reference_code ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{row.full_name}</div>
                      {row.aliases && (
                        <div className="text-xs text-muted-foreground">
                          alias: {row.aliases}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {row.entity_type === "individual"
                          ? "Perorangan"
                          : "Organisasi"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.identity_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.nationality ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{row.source ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {row.listed_at ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.is_active ? "destructive" : "secondary"}
                      >
                        {row.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && (
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
                ))
              )}
            </TableBody>
          </Table>

          {filtered && (
            <DataTablePagination
              currentPage={page}
              pageSize={pageSize}
              totalRecords={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setPage(1);
              }}
              entityLabel="data DTTOT"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Entri DTTOT" : "Tambah Entri DTTOT"}
            </DialogTitle>
            <DialogDescription>
              Data ini digunakan untuk screening nasabah. Pastikan sumber
              informasi resmi (mis. Perpol / DK-PBB / PPATK).
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kode Referensi</Label>
              <Input
                value={form.reference_code ?? ""}
                onChange={(e) =>
                  setForm({ ...form, reference_code: e.target.value })
                }
                placeholder="mis. IDN-001"
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipe *</Label>
              <Select
                value={form.entity_type}
                onValueChange={(v) =>
                  setForm({ ...form, entity_type: v as EntityType })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Perorangan</SelectItem>
                  <SelectItem value="organization">Organisasi</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Nama Lengkap / Organisasi *</Label>
              <Input
                value={form.full_name}
                onChange={(e) =>
                  setForm({ ...form, full_name: e.target.value })
                }
                maxLength={200}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Alias</Label>
              <Input
                value={form.aliases ?? ""}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                placeholder="Pisahkan dengan koma"
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label>No. Identitas (NIK/Paspor)</Label>
              <Input
                value={form.identity_number ?? ""}
                onChange={(e) =>
                  setForm({ ...form, identity_number: e.target.value })
                }
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label>Kebangsaan</Label>
              <Input
                value={form.nationality ?? ""}
                onChange={(e) =>
                  setForm({ ...form, nationality: e.target.value })
                }
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label>Tempat Lahir</Label>
              <Input
                value={form.place_of_birth ?? ""}
                onChange={(e) =>
                  setForm({ ...form, place_of_birth: e.target.value })
                }
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label>Tanggal Lahir</Label>
              <Input
                type="date"
                value={form.date_of_birth ?? ""}
                onChange={(e) =>
                  setForm({ ...form, date_of_birth: e.target.value })
                }
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Alamat</Label>
              <Textarea
                value={form.address ?? ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                rows={2}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label>Sumber</Label>
              <Input
                value={form.source ?? ""}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                placeholder="Perpol / DK-PBB / PPATK"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label>Tanggal Masuk Daftar</Label>
              <Input
                type="date"
                value={form.listed_at ?? ""}
                onChange={(e) =>
                  setForm({ ...form, listed_at: e.target.value })
                }
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Catatan</Label>
              <Textarea
                value={form.notes ?? ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                maxLength={1000}
              />
            </div>
            <div className="flex items-center gap-3 col-span-2 pt-2">
              <Switch
                id="dttot-active"
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              <Label htmlFor="dttot-active" className="cursor-pointer">
                Entri aktif (digunakan untuk screening)
              </Label>
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
            <AlertDialogTitle>Hapus entri DTTOT?</AlertDialogTitle>
            <AlertDialogDescription>
              Entri <strong>{deleting?.full_name}</strong> akan dihapus permanen.
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