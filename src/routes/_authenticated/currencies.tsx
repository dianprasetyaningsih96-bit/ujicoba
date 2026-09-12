import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Pencil, Trash2, Coins } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/currencies")({
  component: CurrenciesPage,
});

interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  decimals: number;
  country: string | null;
  is_active: boolean;
}

const schema = z.object({
  code: z
    .string()
    .trim()
    .length(3, "Kode ISO harus 3 huruf")
    .regex(/^[A-Za-z]{3}$/, "Hanya huruf"),
  name: z.string().trim().min(2).max(100),
  symbol: z.string().trim().max(10).optional().or(z.literal("")),
  decimals: z.coerce.number().int().min(0).max(6),
  country: z.string().trim().max(80).optional().or(z.literal("")),
  is_active: z.boolean(),
});

type Form = z.infer<typeof schema>;

const empty: Form = {
  code: "",
  name: "",
  symbol: "",
  decimals: 2,
  country: "",
  is_active: true,
};

function CurrenciesPage() {
  const { roles } = useCurrentUser();
  const canWrite = hasAnyRole(roles, ["super_admin", "owner"]);
  const [rows, setRows] = useState<Currency[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Currency | null>(null);
  const [deleting, setDeleting] = useState<Currency | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);

  // Pagination Mata Uang
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const paginatedRows = useMemo(() => {
    if (!rows) return null;
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize]);

  async function load() {
    const { data, error } = await supabase
      .from("currencies")
      .select("*")
      .order("code");
    if (error) {
      toast.error("Gagal memuat mata uang", { description: error.message });
      return;
    }
    setRows((data as Currency[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }

  function openEdit(row: Currency) {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name,
      symbol: row.symbol ?? "",
      decimals: row.decimals,
      country: row.country ?? "",
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
    const payload = {
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      symbol: parsed.data.symbol || null,
      decimals: parsed.data.decimals,
      country: parsed.data.country || null,
      is_active: parsed.data.is_active,
    };
    const { error } = editing
      ? await supabase.from("currencies").update(payload).eq("id", editing.id)
      : await supabase.from("currencies").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Gagal menyimpan", { description: error.message });
      return;
    }
    toast.success(editing ? "Mata uang diperbarui" : "Mata uang ditambahkan");
    setOpen(false);
    load();
  }

  async function remove() {
    if (!deleting) return;
    const { error } = await supabase
      .from("currencies")
      .delete()
      .eq("id", deleting.id);
    setDeleting(null);
    if (error) {
      toast.error("Gagal menghapus", { description: error.message });
      return;
    }
    toast.success("Mata uang dihapus");
    load();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <MasterPageHeader
        title="Mata Uang"
        description="Daftar mata uang asing yang didukung sistem (ISO 4217)."
        onAdd={openCreate}
        addLabel="Tambah Mata Uang"
        canWrite={canWrite}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Simbol</TableHead>
                <TableHead>Desimal</TableHead>
                <TableHead>Negara</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <Coins className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Belum ada mata uang.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows?.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono font-semibold">
                      {row.code}
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="font-mono">
                      {row.symbol ?? "—"}
                    </TableCell>
                    <TableCell>{row.decimals}</TableCell>
                    <TableCell>{row.country ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? "default" : "secondary"}>
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

          {rows && rows.length > 0 && (
            <DataTablePagination
              currentPage={currentPage}
              pageSize={pageSize}
              totalRecords={rows.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setCurrentPage(1);
              }}
              entityLabel="mata uang"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Mata Uang" : "Tambah Mata Uang"}
            </DialogTitle>
            <DialogDescription>
              Gunakan kode ISO 4217 3 huruf (mis. USD, EUR, SGD).
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kode ISO *</Label>
              <Input
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder="USD"
                maxLength={3}
                disabled={!!editing}
              />
            </div>
            <div className="space-y-2">
              <Label>Simbol</Label>
              <Input
                value={form.symbol ?? ""}
                onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                placeholder="$"
                maxLength={10}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Nama *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="US Dollar"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label>Desimal</Label>
              <Input
                type="number"
                min={0}
                max={6}
                value={form.decimals}
                onChange={(e) =>
                  setForm({ ...form, decimals: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Negara</Label>
              <Input
                value={form.country ?? ""}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                maxLength={80}
              />
            </div>
            <div className="flex items-center gap-3 col-span-2 pt-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                id="cur-active"
              />
              <Label htmlFor="cur-active" className="cursor-pointer">
                Aktif digunakan
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
            <AlertDialogTitle>Hapus mata uang?</AlertDialogTitle>
            <AlertDialogDescription>
              Mata uang <strong>{deleting?.code}</strong> akan dihapus beserta
              seluruh kurs terkait.
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