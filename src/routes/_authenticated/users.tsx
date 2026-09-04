import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Users, Search, Shield, UserCog, UserPlus } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import {
  supabase,
  ROLE_LABELS,
  type AppRole,
} from "@/integrations/supabase/client";
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} from "@/integrations/supabase/config";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { MasterPageHeader } from "@/components/master-data/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersPage,
});

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface RoleRow {
  user_id: string;
  role: AppRole;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

const ALL_ROLES: AppRole[] = [
  "super_admin",
  "branch_manager",
  "teller",
  "auditor",
  "owner",
];

const ROLE_STYLES: Record<AppRole, string> = {
  super_admin: "bg-red-500/15 text-red-700 border-red-500/30",
  owner: "bg-purple-500/15 text-purple-700 border-purple-500/30",
  branch_manager: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  teller: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  auditor: "bg-amber-500/15 text-amber-700 border-amber-500/30",
};

function UsersPage() {
  const { user, roles: myRoles, loading: userLoading } = useCurrentUser();
  const canManage = hasAnyRole(myRoles, ["super_admin", "owner"]);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Set<AppRole>>(new Set());
  const [branchId, setBranchId] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Create-user dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newBranchId, setNewBranchId] = useState("");
  const [newRoles, setNewRoles] = useState<Set<AppRole>>(new Set(["teller"]));
  const [creating, setCreating] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passTarget, setPassTarget] = useState<Profile | null>(null);
  const [targetPassword, setTargetPassword] = useState("");
  const [changingPass, setChangingPass] = useState(false);

  function resetCreateForm() {
    setNewEmail("");
    setNewPassword("");
    setNewFullName("");
    setNewPhone("");
    setNewBranchId("");
    setNewRoles(new Set(["teller"]));
  }

  function toggleNewRole(role: AppRole) {
    setNewRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  async function createUser() {
    if (!user) return;
    const email = newEmail.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      toast.error("Email tidak valid");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password minimal 8 karakter");
      return;
    }
    if (!newFullName.trim()) {
      toast.error("Nama lengkap wajib diisi");
      return;
    }
    if (newRoles.size === 0) {
      toast.error("Pilih minimal satu peran");
      return;
    }
    setCreating(true);

    // Use an isolated Supabase client (no session persistence) so the
    // signUp call does NOT overwrite the current admin's session.
    const tempClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await tempClient.auth.signUp({
      email,
      password: newPassword,
      options: {
        data: { full_name: newFullName.trim() },
      },
    });
    if (error || !data.user) {
      setCreating(false);
      toast.error("Gagal membuat user", {
        description: error?.message ?? "Coba lagi",
      });
      return;
    }
    const newUserId = data.user.id;

    // Tandai email terkonfirmasi otomatis (RPC SECURITY DEFINER — cek role
    // super_admin/owner di server), agar user baru langsung bisa login
    // tanpa perlu verifikasi email.
    const { error: cErr } = await supabase.rpc("admin_confirm_user", {
      _user_id: newUserId,
    });
    if (cErr) {
      toast.error("User dibuat, tapi gagal auto-konfirmasi email", {
        description: cErr.message,
      });
    }

    // Trigger handle_new_user() sudah membuat profile + default role 'teller'.
    // Perbarui profile (nama, telepon, cabang) — pakai koneksi admin saat ini.
    const { error: pErr } = await supabase
      .from("profiles")
      .update({
        full_name: newFullName.trim(),
        phone: newPhone.trim() || null,
        branch_id: newBranchId || null,
      })
      .eq("id", newUserId);
    if (pErr) {
      toast.error("User dibuat, tapi gagal simpan profil", {
        description: pErr.message,
      });
    }

    // Selaraskan role: hapus default yang tidak dipilih, tambah role lain.
    const desired = new Set(newRoles);
    if (!desired.has("teller")) {
      await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", newUserId)
        .eq("role", "teller");
    }
    const extra = [...desired].filter((r) => r !== "teller");
    if (extra.length > 0) {
      const { error: rErr } = await supabase.from("user_roles").insert(
        extra.map((role) => ({
          user_id: newUserId,
          role,
          assigned_by: user.id,
        })),
      );
      if (rErr) {
        toast.error("User dibuat, tapi gagal menambah role", {
          description: rErr.message,
        });
      }
    }

    setCreating(false);
    toast.success("User baru berhasil dibuat", {
      description:
        "Email otomatis terkonfirmasi — bagikan email & password ke pengguna, langsung bisa login.",
    });
    setCreateOpen(false);
    resetCreateForm();
    load();
  }

  async function load() {
    setLoading(true);
    const [{ data: p, error: pe }, { data: r, error: re }, { data: b }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone, branch_id, is_active, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("branches").select("id, name, code").order("name"),
      ]);
    if (pe) toast.error("Gagal memuat user", { description: pe.message });
    if (re) toast.error("Gagal memuat role", { description: re.message });
    setProfiles((p as Profile[]) ?? []);
    setRoles((r as RoleRow[]) ?? []);
    setBranches((b as Branch[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!userLoading) load();
  }, [userLoading]);

  const rolesByUser = useMemo(() => {
    const m = new Map<string, AppRole[]>();
    for (const r of roles) {
      const arr = m.get(r.user_id) ?? [];
      arr.push(r.role);
      m.set(r.user_id, arr);
    }
    return m;
  }, [roles]);

  const branchName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of branches) m.set(b.id, `${b.code} · ${b.name}`);
    return m;
  }, [branches]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        (p.full_name ?? "").toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").toLowerCase().includes(q),
    );
  }, [profiles, search]);

  function openEdit(p: Profile) {
    setEditTarget(p);
    setSelectedRoles(new Set(rolesByUser.get(p.id) ?? []));
    setBranchId(p.branch_id ?? "");
    setIsActive(p.is_active);
  }

  function toggleRole(role: AppRole) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  async function save() {
    if (!editTarget || !user) return;
    if (selectedRoles.size === 0) {
      toast.error("Minimal satu peran harus dipilih");
      return;
    }
    if (editTarget.id === user.id && !selectedRoles.has("super_admin") && myRoles.includes("super_admin")) {
      toast.error("Anda tidak boleh mencabut peran super_admin dari diri sendiri");
      return;
    }
    setSubmitting(true);

    // Update profile
    const { error: pErr } = await supabase
      .from("profiles")
      .update({
        branch_id: branchId || null,
        is_active: isActive,
      })
      .eq("id", editTarget.id);
    if (pErr) {
      setSubmitting(false);
      toast.error("Gagal simpan profile", { description: pErr.message });
      return;
    }

    const current = new Set(rolesByUser.get(editTarget.id) ?? []);
    const toAdd = [...selectedRoles].filter((r) => !current.has(r));
    const toRemove = [...current].filter((r) => !selectedRoles.has(r));

    if (toAdd.length > 0) {
      const { error } = await supabase.from("user_roles").insert(
        toAdd.map((role) => ({
          user_id: editTarget.id,
          role,
          assigned_by: user.id,
        })),
      );
      if (error) {
        setSubmitting(false);
        toast.error("Gagal menambah role", { description: error.message });
        return;
      }
    }
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", editTarget.id)
        .in("role", toRemove);
      if (error) {
        setSubmitting(false);
        toast.error("Gagal menghapus role", { description: error.message });
        return;
      }
    }

    setSubmitting(false);
    toast.success("User diperbarui");
    setEditTarget(null);
    load();
  }

  async function handlePasswordChange() {
    if (!passTarget) return;
    if (targetPassword.length < 8) {
      toast.error("Password minimal 8 karakter");
      return;
    }
    setChangingPass(true);
    const { error } = await supabase.rpc("admin_change_password", {
      _user_id: passTarget.id,
      _new_password: targetPassword,
    });
    setChangingPass(false);
    if (error) {
      toast.error("Gagal mengubah password", { description: error.message });
      return;
    }
    toast.success("Password berhasil diubah");
    setPasswordOpen(false);
    setTargetPassword("");
    setPassTarget(null);
  }

  if (!userLoading && !canManage) {
    return (
      <div className="space-y-6">
        <MasterPageHeader
          title="Manajemen User"
          description="Kelola profil dan peran pengguna sistem."
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Anda tidak memiliki akses. Hanya Super Admin dan Owner yang dapat
            mengelola user.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Manajemen User"
        description="Kelola profil, peran, cabang, dan status aktif pengguna sistem."
        canWrite={canManage && hasAnyRole(myRoles, ["super_admin"])}
        onAdd={() => {
          resetCreateForm();
          setCreateOpen(true);
        }}
        addLabel="Tambah User"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Total User"
          value={profiles.length}
          icon={<Users className="h-4 w-4 text-blue-600" />}
        />
        <StatCard
          label="Aktif"
          value={profiles.filter((p) => p.is_active).length}
          icon={<UserCog className="h-4 w-4 text-emerald-600" />}
        />
        <StatCard
          label="Super Admin"
          value={roles.filter((r) => r.role === "super_admin").length}
          icon={<Shield className="h-4 w-4 text-red-600" />}
        />
        <StatCard
          label="Teller"
          value={roles.filter((r) => r.role === "teller").length}
          icon={<Users className="h-4 w-4 text-emerald-600" />}
        />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="relative sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, email, telepon…"
              className="pl-9"
            />
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Peran</TableHead>
                  <TableHead>Cabang</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Tidak ada user.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((p) => {
                    const userRoles = rolesByUser.get(p.id) ?? [];
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">
                            {p.full_name ?? "—"}
                          </div>
                          {p.phone && (
                            <div className="text-xs text-muted-foreground">
                              {p.phone}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.email ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {userRoles.length === 0 ? (
                              <span className="text-xs text-muted-foreground">
                                belum ada
                              </span>
                            ) : (
                              userRoles.map((r) => (
                                <Badge
                                  key={r}
                                  variant="outline"
                                  className={ROLE_STYLES[r]}
                                >
                                  {ROLE_LABELS[r]}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.branch_id ? branchName.get(p.branch_id) : "—"}
                        </TableCell>
                        <TableCell>
                          {p.is_active ? (
                            <Badge
                              variant="outline"
                              className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
                            >
                              Aktif
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Nonaktif
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setPassTarget(p);
                                setTargetPassword("");
                                setPasswordOpen(true);
                              }}
                              title="Ubah Password"
                            >
                              <Shield className="h-4 w-4 text-amber-600" />
                            </Button>
                            <Button asChild size="icon" variant="ghost" title="Detail">
                              <Link
                                to="/users/$userId"
                                params={{ userId: p.id }}
                              >
                                <Users className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(p)}
                              title="Kelola"
                            >
                              <UserCog className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Super Admin dapat menambahkan user baru langsung dari tombol
            <b className="mx-1">Tambah User</b>. Pengguna juga dapat mendaftar
            sendiri melalui halaman <code className="mx-1">/auth</code>.
          </p>
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetCreateForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Tambah User Baru
            </DialogTitle>
            <DialogDescription>
              Buat akun karyawan lengkap dengan peran dan cabang. Password
              awal akan dibagikan langsung ke pengguna.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Nama Lengkap *</Label>
                <Input
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="Budi Santoso"
                />
              </div>
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="budi@kupvabb.co.id"
                />
              </div>
              <div className="space-y-2">
                <Label>Telepon</Label>
                <Input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="0812xxxxxxxx"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Password Awal * (min. 8 karakter)</Label>
                <Input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Password sementara"
                />
                <p className="text-xs text-muted-foreground">
                  Sarankan pengguna mengganti password setelah login pertama.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Cabang</Label>
                <select
                  value={newBranchId}
                  onChange={(e) => setNewBranchId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">— Tidak ditugaskan —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Peran (bisa lebih dari satu) *</Label>
              <div className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2">
                {ALL_ROLES.map((r) => (
                  <label
                    key={r}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={newRoles.has(r)}
                      onCheckedChange={() => toggleNewRole(r)}
                    />
                    <span>{ROLE_LABELS[r]}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Batal
            </Button>
            <Button onClick={createUser} disabled={creating}>
              {creating ? "Membuat…" : "Buat User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Kelola User</DialogTitle>
            <DialogDescription>
              {editTarget?.full_name ?? editTarget?.email}
            </DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Peran (bisa lebih dari satu)</Label>
                <div className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2">
                  {ALL_ROLES.map((r) => (
                    <label
                      key={r}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selectedRoles.has(r)}
                        onCheckedChange={() => toggleRole(r)}
                      />
                      <span>{ROLE_LABELS[r]}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Cabang</Label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">— Tidak ditugaskan —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Status Aktif</div>
                  <div className="text-xs text-muted-foreground">
                    User nonaktif tetap bisa login tetapi ditandai untuk audit.
                  </div>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditTarget(null)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={save} disabled={submitting}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Password Pengguna</DialogTitle>
            <DialogDescription>
              Mengubah password untuk {passTarget?.full_name} ({passTarget?.email}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Password Baru</Label>
              <Input
                type="password"
                value={targetPassword}
                onChange={(e) => setTargetPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>
              Batal
            </Button>
            <Button onClick={handlePasswordChange} disabled={changingPass}>
              {changingPass ? "Memproses..." : "Simpan Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-2xl font-bold">{value}</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}