import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Pencil, Trash2, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { MasterPageHeader } from "@/components/master-data/page-header";
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

export const Route = createFileRoute("/_authenticated/branches")({
  component: BranchesPage,
});

interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  license_no: string | null;
  is_active: boolean;
  is_head_office?: boolean;
  created_at: string;
}

const branchSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(150),
  address: z.string().trim().max(255).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  license_no: z.string().trim().max(80).optional().or(z.literal("")),
  is_active: z.boolean(),
  is_head_office: z.boolean().default(false),
});

type BranchForm = z.infer<typeof branchSchema>;

const empty: BranchForm = {
  code: "",
  name: "",
  address: "",
  city: "",
  phone: "",
  license_no: "",
  is_active: true,
  is_head_office: false,
};

function BranchesPage() {
  const { roles } = useCurrentUser();
  const canWrite = hasAnyRole(roles, ["super_admin", "owner"]);

  const [rows, setRows] = useState<Branch[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("branches")
      .select("*")
      .order("is_head_office", { ascending: false })
      .order("code");
    if (error) {
      toast.error("Gagal memuat cabang", { description: error.message });
      return;
    }
    setRows((data as Branch[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }

  function openEdit(row: Branch) {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name,
      address: row.address ?? "",
      city: row.city ?? "",
      phone: row.phone ?? "",
      license_no: row.license_no ?? "",
      is_active: row.is_active,
      is_head_office: !!row.is_head_office,
    });
    setOpen(true);
  }

  async function save() {
    const parsed = branchSchema.safeParse(form);
    if (!parsed.success) {
      toast.error("Data tidak valid", {
        description: parsed.error.issues[0]?.message,
      });
      return;
    }
    setSaving(true);

    // Jika cabang ini dijadikan Kantor Pusat, lepas status Kantor Pusat dari cabang lain
    if (parsed.data.is_head_office) {
      if (editing) {
        await supabase.from("branches").update({ is_head_office: false } as any).neq("id", editing.id);
      } else {
        await supabase.from("branches").update({ is_head_office: false } as any);
      }
    }

    const payload = {
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      address: parsed.data.address || null,
      city: parsed.data.city || null,
      phone: parsed.data.phone || null,
      license_no: parsed.data.license_no || null,
      is_active: parsed.data.is_active,
      is_head_office: parsed.data.is_head_office,
    };
    const { error } = editing
      ? await supabase.from("branches").update(payload).eq("id", editing.id)
      : await supabase.from("branches").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Gagal menyimpan", { description: error.message });
      return;
    }
    toast.success(editing ? "Cabang diperbarui" : "Cabang ditambahkan");
    setOpen(false);
    load();
  }

  async function remove() {
    if (!deleting) return;
    const { error } = await supabase
      .from("branches")
      .delete()
      .eq("id", deleting.id);
    setDeleting(null);
    if (error) {
      toast.error("Gagal menghapus", { description: error.message });
      return;
    }
    toast.success("Cabang dihapus");
    load();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <MasterPageHeader
        title="Cabang"
        description="Kelola daftar cabang / outlet KUPVA BB Anda."
        onAdd={openCreate}
        addLabel="Tambah Cabang"
        canWrite={canWrite}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Kota</TableHead>
                <TableHead>Telepon</TableHead>
                <TableHead>No. Izin</TableHead>
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
                    <Building2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Belum ada cabang. Tambahkan cabang pertama Anda.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono font-medium">
                      {row.code}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{row.name}</span>
                        {row.is_head_office && (
                          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] py-0 px-2 h-5">
                            Kantor Pusat
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{row.city ?? "—"}</TableCell>
                    <TableCell>{row.phone ?? "—"}</TableCell>
                    <TableCell>{row.license_no ?? "—"}</TableCell>
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
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Cabang" : "Tambah Cabang"}
            </DialogTitle>
            <DialogDescription>
              Isi data cabang. Kode akan diubah menjadi huruf kapital.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kode *</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="HQ-01"
                maxLength={20}
              />
            </div>
            <div className="space-y-2 col-span-1">
              <Label>No. Izin</Label>
              <Input
                value={form.license_no ?? ""}
                onChange={(e) =>
                  setForm({ ...form, license_no: e.target.value })
                }
                maxLength={80}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Nama *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={150}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Alamat</Label>
              <Input
                value={form.address ?? ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label>Kota</Label>
              <Input
                value={form.city ?? ""}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label>Telepon</Label>
              <Input
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                maxLength={30}
              />
            </div>
            <div className="flex items-center justify-between col-span-2 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <Label htmlFor="branch-hq" className="text-sm font-semibold cursor-pointer">
                    Jadikan Kantor Pusat (Head Office)
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Menetapkan cabang ini sebagai pusat penerima sisa kas dan pusat jual valas.
                </p>
              </div>
              <Switch
                checked={form.is_head_office}
                onCheckedChange={(v) => setForm({ ...form, is_head_office: v })}
                id="branch-hq"
              />
            </div>

            <div className="flex items-center gap-3 col-span-2 pt-1">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                id="branch-active"
              />
              <Label htmlFor="branch-active" className="cursor-pointer">
                Cabang aktif
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
            <AlertDialogTitle>Hapus cabang?</AlertDialogTitle>
            <AlertDialogDescription>
              Cabang <strong>{deleting?.name}</strong> akan dihapus permanen
              beserta seluruh kurs yang terkait.
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