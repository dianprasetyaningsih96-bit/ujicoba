import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function EditTransactionDialog({ 
  transaction, 
  open, 
  onOpenChange,
  onSaved
}: {
  transaction: any;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [foreign, setForeign] = useState("");
  const [rate, setRate] = useState("");
  const [idr, setIdr] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    if (transaction && open) {
      setForeign(transaction.foreign_amount.toString());
      setRate(transaction.rate.toString());
      setIdr(transaction.idr_amount.toString());
      setNotes(transaction.notes || "");
      // Format datetime-local requires YYYY-MM-DDThh:mm
      // ISO string is usually in UTC, so we should convert it carefully
      const tzoffset = (new Date()).getTimezoneOffset() * 60000;
      const localISOTime = (new Date(new Date(transaction.transaction_date).getTime() - tzoffset)).toISOString().slice(0, -1);
      setDate(localISOTime.slice(0, 16));
    }
  }, [transaction, open]);

  // Sync idr when foreign or rate changes
  useEffect(() => {
    if (!open) return;
    const f = parseFloat(foreign);
    const r = parseFloat(rate);
    if (!isNaN(f) && !isNaN(r)) {
      setIdr(Math.round(f * r).toString());
    }
  }, [foreign, rate]);

  const handleSave = async () => {
    try {
      setBusy(true);
      const { error } = await supabase.rpc("admin_edit_transaction", {
        p_tx_id: transaction.id,
        p_foreign_amount: parseFloat(foreign),
        p_idr_amount: parseFloat(idr),
        p_rate: parseFloat(rate),
        p_customer_id: transaction.customer_id,
        p_notes: notes,
        p_date: new Date(date).toISOString()
      });
      if (error) throw error;
      toast.success("Transaksi berhasil diubah.");
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Gagal mengubah transaksi");
    } finally {
      setBusy(false);
    }
  };

  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Transaksi {transaction.transaction_no}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Waktu Transaksi</Label>
            <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Nominal Valas ({transaction.currencies?.code})</Label>
              <Input type="number" value={foreign} onChange={(e) => setForeign(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Kurs</Label>
              <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Total IDR</Label>
            <Input type="number" value={idr} readOnly className="bg-muted" />
          </div>
          <div className="grid gap-2">
            <Label>Catatan</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={handleSave} disabled={busy}>Simpan Perubahan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
