import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, CheckCircle, XCircle, Clock, Building2, Eye, Ban, ArrowUpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { MasterPageHeader } from "@/components/master-data/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/approvals")({
  component: ApprovalsPage,
});

interface Transfer {
  id: string;
  branch_id: string;
  target_branch_id: string | null;
  currency_id: string;
  amount: number;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  notes: string | null;
  shift_id?: string | null;
  branch?: { name: string; code: string } | null;
  target_branch?: { name: string; code: string } | null;
  currency?: { code: string; name: string } | null;
}

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function ApprovalsPage() {
  const { roles, profile } = useCurrentUser();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  
  // Dialog Tolak
  const [rejectDialog, setRejectDialog] = useState<Transfer | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  
  // Dialog Persetujuan Permintaan Modal dengan Input Nominal
  const [approveDialog, setApproveDialog] = useState<Transfer | null>(null);
  const [approvedAmount, setApprovedAmount] = useState<string>("");
  const [approveNotes, setApproveNotes] = useState<string>("");

  const [branchInfo, setBranchInfo] = useState<{ is_head_office: boolean } | null>(null);

  const canApprove = hasAnyRole(roles, ["super_admin", "owner", "branch_manager", "teller"]) && (hasAnyRole(roles, ["super_admin"]) || branchInfo?.is_head_office);

  useEffect(() => {
    if (profile?.branch_id) {
      supabase.from("branches").select("is_head_office").eq("id", profile.branch_id).single().then(({ data }) => {
        setBranchInfo(data);
      });
    }
  }, [profile?.branch_id]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("branch_transfers")
      .select(`
        *, 
        branch:branches!branch_transfers_branch_id_fkey(name, code),
        target_branch:branches!branch_transfers_target_branch_id_fkey(name, code),
        currency:currencies(code, name)
      `)
      .order("created_at", { ascending: false });
    
    if (error) {
      toast.error("Gagal memuat data transfer: " + error.message);
    } else {
      setTransfers((data as unknown as Transfer[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function handleOpenApprove(transfer: Transfer) {
    const isCapitalReq = Boolean(transfer.notes?.toLowerCase().includes("modal"));
    if (isCapitalReq) {
      setApproveDialog(transfer);
      setApprovedAmount(String(transfer.amount));
      setApproveNotes("");
    } else {
      handleAction(transfer, "accepted");
    }
  }

  async function submitApproveModal() {
    if (!approveDialog) return;
    const finalAmount = Number(approvedAmount.replace(/[^\d]/g, "")) || 0;
    if (finalAmount <= 0) {
      toast.error("Nominal yang disetujui harus lebih dari 0");
      return;
    }

    setProcessing(approveDialog.id);

    // Update nominal jika diubah oleh Super Admin
    if (finalAmount !== approveDialog.amount) {
      const { error: updErr } = await supabase
        .from("branch_transfers")
        .update({ amount: finalAmount })
        .eq("id", approveDialog.id);

      if (updErr) {
        toast.error("Gagal memperbarui nominal: " + updErr.message);
        setProcessing(null);
        return;
      }
      approveDialog.amount = finalAmount;
    }

    const { error } = await supabase.rpc("process_branch_transfer", {
      transfer_id: approveDialog.id,
      p_status: "accepted",
      p_notes: approveNotes ? `Disetujui: ${approveNotes}` : ""
    });

    if (error) {
      toast.error("Gagal memproses persetujuan: " + error.message);
    } else {
      const isCapitalReq =
        Boolean(approveDialog.notes?.toLowerCase().includes("modal")) &&
        !approveDialog.notes?.toLowerCase().includes("setoran") &&
        !approveDialog.notes?.toLowerCase().includes("tutup shif") &&
        approveDialog.currency?.code === "IDR";

      if (approveDialog.shift_id && isCapitalReq) {
        await supabase
          .from("shifts")
          .update({ opening_capital: finalAmount })
          .eq("id", approveDialog.shift_id);
      }

      toast.success("Permintaan Modal Diterima", {
        description: `Nominal Rp ${fmt(finalAmount)} disetujui. Saldo Kantor Pusat otomatis dikurangi.`,
      });
      load();
    }

    setProcessing(null);
    setApproveDialog(null);
    setApprovedAmount("");
    setApproveNotes("");
  }

  async function handleAction(transfer: Transfer, status: "accepted" | "rejected", notes?: string) {
    setProcessing(transfer.id);
    const { error } = await supabase.rpc("process_branch_transfer", {
      transfer_id: transfer.id,
      p_status: status,
      p_notes: notes || ""
    });

    if (error) {
      toast.error("Gagal memproses transfer: " + error.message);
    } else {
      const isCapitalReq =
        Boolean(transfer.notes?.toLowerCase().includes("modal")) &&
        !transfer.notes?.toLowerCase().includes("setoran") &&
        !transfer.notes?.toLowerCase().includes("tutup shif") &&
        transfer.currency?.code === "IDR";

      if (status === "accepted" && transfer.shift_id && isCapitalReq) {
        await supabase
          .from("shifts")
          .update({ opening_capital: transfer.amount })
          .eq("id", transfer.shift_id);
      }

      toast.success(status === "accepted" ? "Transfer Diterima" : "Transfer Ditolak");
      load();
    }
    setProcessing(null);
    setRejectDialog(null);
    setRejectReason("");
  }

  return (
    <div className="space-y-6 p-6">
      <MasterPageHeader
        title="Persetujuan Transfer & Modal"
        description="Kelola persetujuan permohonan modal cabang dan setoran kas/valas ke Kantor Pusat."
        canWrite={false}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Daftar Transfer & Permintaan Modal</CardTitle>
          <CardDescription>
            Tinjau permintaan modal kerja cabang dan mutasi transfer antar cabang.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu & Jenis</TableHead>
                <TableHead>Asal</TableHead>
                <TableHead>Tujuan</TableHead>
                <TableHead>Valuta</TableHead>
                <TableHead className="text-right">Nominal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">Memuat...</TableCell></TableRow>
              ) : transfers.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">Tidak ada data transfer</TableCell></TableRow>
              ) : transfers.map((t) => {
                const isCapitalReq = t.notes?.toLowerCase().includes("modal");
                return (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      <div>{new Date(t.created_at).toLocaleString("id-ID")}</div>
                      <div className="mt-1">
                        {isCapitalReq ? (
                          <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                            Permintaan Modal
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                            Setoran Shif
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{t.branch?.name}</div>
                      <div className="text-xs text-muted-foreground">{t.branch?.code}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-emerald-700">{t.target_branch?.name || "-"}</div>
                      <div className="text-xs text-muted-foreground">{t.target_branch?.code}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono font-bold">{t.currency?.code}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono font-semibold">
                        {t.amount.toLocaleString("id-ID")}
                      </div>
                      {t.notes && (
                        <div className="text-[11px] text-muted-foreground max-w-[200px] truncate" title={t.notes}>
                          {t.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === "pending" ? "outline" : t.status === "accepted" ? "default" : "destructive"}>
                        {t.status === "pending" ? "Menunggu" : t.status === "accepted" ? "Diterima" : "Ditolak"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {t.status === "pending" && canApprove && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 border-emerald-500 text-emerald-600 hover:bg-emerald-50"
                            onClick={() => handleOpenApprove(t)}
                            disabled={!!processing}
                          >
                            <CheckCircle className="mr-1 h-3.5 w-3.5" /> Terima
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 border-destructive text-destructive hover:bg-destructive/5"
                            onClick={() => setRejectDialog(t)}
                            disabled={!!processing}
                          >
                            <Ban className="mr-1 h-3.5 w-3.5" /> Tolak
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog Penolakan Transfer */}
      <Dialog open={!!rejectDialog} onOpenChange={(o) => !o && setRejectDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Permintaan / Transfer</DialogTitle>
            <DialogDescription>
              Berikan alasan penolakan untuk transfer dari/ke cabang {rejectDialog?.branch?.name || rejectDialog?.target_branch?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Contoh: Saldo kas pusat tidak mencukupi, harap koordinasikan kembali..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>Batal</Button>
            <Button
              variant="destructive"
              onClick={() => rejectDialog && handleAction(rejectDialog, "rejected", rejectReason)}
              disabled={!!processing}
            >
              Tolak Permintaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Persetujuan Permintaan Modal dengan Input Nominal Disetujui */}
      <Dialog open={!!approveDialog} onOpenChange={(o) => !o && setApproveDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" /> Persetujuan Permintaan Modal
            </DialogTitle>
            <DialogDescription>
              Tentukan nominal modal kas Rupiah (IDR) yang disetujui untuk dikirim ke cabang pemohon.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cabang Pemohon:</span>
                <span className="font-semibold text-foreground">
                  {approveDialog?.target_branch?.name ?? "Cabang"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nominal Diajukan:</span>
                <span className="font-semibold font-mono text-foreground">
                  Rp {approveDialog ? fmt(approveDialog.amount) : "0"}
                </span>
              </div>
              {approveDialog?.notes && (
                <div className="pt-1.5 border-t text-muted-foreground">
                  Catatan: {approveDialog.notes}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Nominal Disetujui (IDR) <span className="text-destructive">*</span></Label>
              <Input
                type="text"
                inputMode="numeric"
                value={
                  approvedAmount
                    ? fmt(Number(approvedAmount.replace(/[^\d]/g, "")))
                    : ""
                }
                onChange={(e) => {
                  const val = e.target.value.replace(/[^\d]/g, "");
                  setApprovedAmount(val);
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Saldo kas Kantor Pusat akan otomatis berkurang sejumlah nominal yang disetujui ini.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Catatan Persetujuan (opsional)</Label>
              <Textarea
                rows={2}
                placeholder="Catatan dari Super Admin..."
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveDialog(null)}
              disabled={!!processing}
            >
              Batal
            </Button>
            <Button
              onClick={submitApproveModal}
              disabled={!!processing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {processing ? "Memproses..." : "Setujui & Kirim Modal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
