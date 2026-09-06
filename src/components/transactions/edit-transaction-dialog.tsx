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
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CustomerForm } from "@/components/customers/customer-form";
import { Card, CardContent } from "@/components/ui/card";

export interface EditCurrencyItem {
  id: string;
  currency_id: string;
  foreign_amount: number;
  rate: number;
  foreignInput: string;
  rateInput: string;
}

const fmtNum = (n: number, maxDec = 5) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDec,
  }).format(n);

const fmtIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

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
  const [items, setItems] = useState<EditCurrencyItem[]>([]);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
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
      setNotes(transaction.notes || "");
      setCustomerId(transaction.customer_id);
      setPreviewTxNo(transaction.transaction_no || "");
      setShowAddCustomer(false);
      
      const tzoffset = (new Date()).getTimezoneOffset() * 60000;
      const localISOTime = (new Date(new Date(transaction.transaction_date).getTime() - tzoffset)).toISOString().slice(0, -1);
      setDate(localISOTime.slice(0, 16));

      // Populate currency items
      if (transaction.transaction_items && transaction.transaction_items.length > 0) {
        setItems(
          transaction.transaction_items.map((it: any) => ({
            id: it.id || Math.random().toString(36).substring(2, 9),
            currency_id: it.currency_id,
            foreign_amount: Number(it.foreign_amount),
            rate: Number(it.rate),
            foreignInput: it.foreign_amount ? fmtNum(Number(it.foreign_amount)) : "",
            rateInput: it.rate ? fmtNum(Number(it.rate), 2) : "",
          }))
        );
      } else {
        setItems([
          {
            id: Math.random().toString(36).substring(2, 9),
            currency_id: transaction.currency_id || "",
            foreign_amount: Number(transaction.foreign_amount) || 0,
            rate: Number(transaction.rate) || 0,
            foreignInput: transaction.foreign_amount ? fmtNum(Number(transaction.foreign_amount)) : "",
            rateInput: transaction.rate ? fmtNum(Number(transaction.rate), 2) : "",
          },
        ]);
      }
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

  const getSuggestedRate = (currId: string) => {
    if (!currId || !rates || rates.length === 0) return 0;
    const branchId = transaction.branch_id;
    const match =
      rates.find((r: any) => r.currency_id === currId && r.branch_id === branchId) ||
      rates.find((r: any) => r.currency_id === currId && r.branch_id === null);
    if (!match) return 0;
    return transaction.transaction_type === "buy" ? Number(match.buy_rate) : Number(match.sell_rate);
  };

  const handleItemCurrencyChange = (index: number, newCurrencyId: string) => {
    setItems((prev) => {
      const next = [...prev];
      const suggested = getSuggestedRate(newCurrencyId);
      next[index] = {
        ...next[index],
        currency_id: newCurrencyId,
        rate: suggested,
        rateInput: suggested > 0 ? fmtNum(suggested, 2) : "",
      };
      return next;
    });
  };

  const handleItemForeignChange = (index: number, val: string) => {
    const clean = val.replace(/[^\d,\.]/g, "");
    const normalized = clean.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(normalized) || 0;
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        foreignInput: clean,
        foreign_amount: num,
      };
      return next;
    });
  };

  const handleItemForeignBlur = (index: number) => {
    setItems((prev) => {
      const next = [...prev];
      const it = next[index];
      if (it && it.foreign_amount > 0) {
        next[index] = {
          ...it,
          foreignInput: fmtNum(it.foreign_amount),
        };
      }
      return next;
    });
  };

  const handleItemRateChange = (index: number, val: string) => {
    const clean = val.replace(/[^\d,\.]/g, "");
    const normalized = clean.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(normalized) || 0;
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        rateInput: clean,
        rate: num,
      };
      return next;
    });
  };

  const handleItemRateBlur = (index: number) => {
    setItems((prev) => {
      const next = [...prev];
      const it = next[index];
      if (it && it.rate > 0) {
        next[index] = {
          ...it,
          rateInput: fmtNum(it.rate, 2),
        };
      }
      return next;
    });
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        currency_id: "",
        foreign_amount: 0,
        rate: 0,
        foreignInput: "",
        rateInput: "",
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const totalIdr = items.reduce(
    (acc, it) => acc + Math.round((it.foreign_amount || 0) * (it.rate || 0)),
    0
  );

  const handleSave = async () => {
    if (items.length === 0) {
      toast.error("Minimal harus ada 1 mata uang");
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.currency_id) {
        toast.error(`Baris ke-${i + 1}: Pilih mata uang terlebih dahulu`);
        return;
      }
      if (!it.foreign_amount || it.foreign_amount <= 0) {
        toast.error(`Baris ke-${i + 1}: Nominal valas harus lebih besar dari 0`);
        return;
      }
      if (!it.rate || it.rate <= 0) {
        toast.error(`Baris ke-${i + 1}: Kurs harus lebih besar dari 0`);
        return;
      }
    }

    try {
      setBusy(true);
      const payloadItems = items.map((it) => ({
        currency_id: it.currency_id,
        foreign_amount: it.foreign_amount,
        rate: it.rate,
        idr_amount: Number((it.foreign_amount * it.rate).toFixed(2)),
      }));

      const { data: newTxNo, error } = await (supabase.rpc as any)("admin_edit_transaction", {
        p_tx_id: transaction.id,
        p_foreign_amount: payloadItems[0].foreign_amount,
        p_idr_amount: totalIdr,
        p_rate: payloadItems[0].rate,
        p_customer_id: customerId,
        p_notes: notes,
        p_date: new Date(date).toISOString(),
        p_currency_id: payloadItems[0].currency_id,
        p_items: payloadItems,
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

          {/* Multiple Currency Items Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h4 className="text-sm font-semibold">Rincian Mata Uang ({items.length})</h4>
                <p className="text-xs text-muted-foreground">
                  Kelola mata uang yang ditransaksikan. Anda dapat menambah atau mengurangi valas.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItem}
                className="gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Mata Uang
              </Button>
            </div>

            <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
              {items.map((item, index) => {
                const subtotal = Number((item.rate * item.foreign_amount).toFixed(2));
                const selectedCurr = activeCurrencies.find((c) => c.id === item.currency_id);
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border bg-card p-3 shadow-xs space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted">
                        Baris #{index + 1}
                      </span>
                      {items.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemoveItem(index)}
                          title="Hapus baris ini"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Mata Uang *</Label>
                        <Select
                          value={item.currency_id}
                          onValueChange={(v) => handleItemCurrencyChange(index, v)}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Pilih valas" />
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

                      <div className="space-y-1">
                        <Label className="text-xs">
                          Nominal Valas {selectedCurr ? `(${selectedCurr.code})` : ""} *
                        </Label>
                        <Input
                          type="text"
                          className="h-9 font-mono"
                          placeholder="0"
                          value={item.foreignInput}
                          onChange={(e) => handleItemForeignChange(index, e.target.value)}
                          onBlur={() => handleItemForeignBlur(index)}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Kurs (IDR) *</Label>
                        <Input
                          type="text"
                          className="h-9 font-mono"
                          placeholder="0,00"
                          value={item.rateInput}
                          onChange={(e) => handleItemRateChange(index, e.target.value)}
                          onBlur={() => handleItemRateBlur(index)}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-xs pt-1 border-t border-dashed">
                      <span className="text-muted-foreground">Subtotal IDR:</span>
                      <span className="font-mono font-semibold text-foreground">
                        {fmtIDR(subtotal)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total IDR Summary Card */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex justify-between items-center">
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider block font-medium">
                  Total Akhir Transaksi (IDR)
                </span>
                <span className="text-lg font-bold font-mono text-primary">
                  {fmtIDR(totalIdr)}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {items.length} jenis mata uang
              </span>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Catatan</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
