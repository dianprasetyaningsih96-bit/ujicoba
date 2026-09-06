import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CustomerForm } from "@/components/customers/customer-form";
import { Card, CardContent } from "@/components/ui/card";

export function EditTransactionDialog({ 
  transaction, 
  customers,
  currencies = [],
  rates = [],
  open, 
  onOpenChange,
  onSaved,
  onReloadCustomers
}: {
  transaction: any;
  customers: any[];
  currencies?: any[];
  rates?: any[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
  onReloadCustomers?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [foreign, setForeign] = useState("");
  const [rate, setRate] = useState("");
  const [idr, setIdr] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [currencyId, setCurrencyId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [previewTxNo, setPreviewTxNo] = useState<string>("");
  const [activeCurrencies, setActiveCurrencies] = useState<any[]>(currencies);

  useEffect(() => {
    if (currencies && currencies.length > 0) {
      setActiveCurrencies(currencies);
    } else if (open) {
      supabase
        .from("currencies")
        .select("id, code, name")
        .eq("is_active", true)
        .order("code")
        .then(({ data }) => {
          if (data) setActiveCurrencies(data);
        });
    }
  }, [currencies, open]);

  useEffect(() => {
    if (transaction && open) {
      setForeign(transaction.foreign_amount?.toString() || "");
      setRate(transaction.rate?.toString() || "");
      setIdr(transaction.idr_amount?.toString() || "");
      setNotes(transaction.notes || "");
      setCurrencyId(transaction.currency_id || "");
      setCustomerId(transaction.customer_id);
      setPreviewTxNo(transaction.transaction_no || "");
      setShowAddCustomer(false);
      
      const tzoffset = (new Date()).getTimezoneOffset() * 60000;
      const localISOTime = (new Date(new Date(transaction.transaction_date).getTime() - tzoffset)).toISOString().slice(0, -1);
      setDate(localISOTime.slice(0, 16));
    }
  }, [transaction, open]);

  // Real-time automatic adjustment of transaction number when date changes
  useEffect(() => {
    if (!transaction || !open || !date) return;
    const d = new Date(date);
    if (isNaN(d.getTime())) return;

    // Instant local optimistic preview
    const yyyy = d.getFullYear().toString();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}${mm}${dd}`;

    const parts = (transaction.transaction_no || "").split("-");
    if (parts.length >= 3) {
      const prefixBase = parts[0];
      setPreviewTxNo(`${prefixBase}-${dateStr}-${parts[2]}`);
    }

    // Call authoritative RPC for exact chronological sequence
    let isMounted = true;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("get_preview_transaction_no", {
          p_tx_id: transaction.id,
          p_date: d.toISOString(),
        });
        if (!error && data && isMounted) {
          setPreviewTxNo(data);
        }
      } catch (err) {
        console.error("Error previewing transaction number:", err);
      }
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [date, transaction?.id, open]);

  // Sync idr when foreign or rate changes
  useEffect(() => {
    if (!open) return;
    const f = parseFloat(foreign);
    const r = parseFloat(rate);
    if (!isNaN(f) && !isNaN(r)) {
      setIdr(Math.round(f * r).toString());
    }
  }, [foreign, rate, open]);

  const handleCurrencyChange = (newCurrId: string) => {
    setCurrencyId(newCurrId);
    if (rates && rates.length > 0) {
      const branchId = transaction.branch_id;
      const match =
        rates.find((r: any) => r.currency_id === newCurrId && r.branch_id === branchId) ||
        rates.find((r: any) => r.currency_id === newCurrId && r.branch_id === null);
      if (match) {
        const suggested =
          transaction.transaction_type === "buy"
            ? Number(match.buy_rate)
            : Number(match.sell_rate);
        if (suggested > 0) {
          setRate(suggested.toString());
        }
      }
    }
  };

  const handleSave = async () => {
    try {
      setBusy(true);
      const { data: newTxNo, error } = await supabase.rpc("admin_edit_transaction", {
        p_tx_id: transaction.id,
        p_foreign_amount: parseFloat(foreign),
        p_idr_amount: parseFloat(idr),
        p_rate: parseFloat(rate),
        p_customer_id: customerId,
        p_notes: notes,
        p_date: new Date(date).toISOString(),
        p_currency_id: currencyId || transaction.currency_id,
      });
      if (error) throw error;
      toast.success(`Transaksi ${newTxNo || previewTxNo} berhasil diperbarui.`);
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Gagal mengubah transaksi");
    } finally {
      setBusy(false);
    }
  };

  if (!transaction) return null;

  const currentCurrency = activeCurrencies.find((c) => c.id === currencyId) || transaction.currencies;
  const currencyCode = currentCurrency?.code || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Transaksi {previewTxNo || transaction.transaction_no}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Waktu Transaksi</Label>
            <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Nasabah</Label>
              <Button 
                type="button"
                variant="ghost" 
                size="sm" 
                className="h-7 gap-1 text-xs" 
                onClick={() => setShowAddCustomer(!showAddCustomer)}
              >
                <Plus className="h-3 w-3" />
                {showAddCustomer ? "Batal" : "Tambah Nasabah Baru"}
              </Button>
            </div>

            {showAddCustomer ? (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4">
                  <CustomerForm 
                    onSuccess={(id) => {
                      onReloadCustomers?.();
                      setCustomerId(id);
                      setShowAddCustomer(false);
                    }}
                    onCancel={() => setShowAddCustomer(false)}
                    initialBranchId={transaction.branch_id || undefined}
                  />
                </CardContent>
              </Card>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className={cn(
                      "w-full justify-between font-normal",
                      !customerId && "text-muted-foreground"
                    )}
                  >
                    {!customerId
                      ? "Walk-in (tanpa nasabah terdaftar)"
                      : customers.find((c) => c.id === customerId)
                        ? `${customers.find((c) => c.id === customerId)?.customer_code} - ${customers.find((c) => c.id === customerId)?.full_name}`
                        : "Pilih nasabah"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                  <Command>
                    <CommandInput placeholder="Cari nasabah..." />
                    <CommandList>
                      <CommandEmpty>Nasabah tidak ditemukan.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="walk-in"
                          onSelect={() => setCustomerId(null)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              !customerId ? "opacity-100" : "opacity-0"
                            )}
                          />
                          Walk-in (tanpa nasabah terdaftar)
                        </CommandItem>
                        {customers.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.customer_code} ${c.full_name}`}
                            onSelect={() => setCustomerId(c.id)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                customerId === c.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {c.customer_code} - {c.full_name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label>Mata Uang</Label>
              <Select value={currencyId} onValueChange={handleCurrencyChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih mata uang" />
                </SelectTrigger>
                <SelectContent className="max-h-56 overflow-y-auto">
                  {activeCurrencies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} - {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Nominal Valas {currencyCode ? `(${currencyCode})` : ""}</Label>
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
