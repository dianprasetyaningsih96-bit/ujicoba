import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import {
  Settings as SettingsIcon,
  Save,
  PlugZap,
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  UploadCloud,
  Image as ImageIcon,
  Trash2,
  Building2,
  MapPin,
  Phone,
  User,
  Hash,
  FileText,
  Palette,
  Check,
  RotateCcw,
  Sparkles,
  Clock,
  Coins,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_PROJECT_ID, SUPABASE_URL } from "@/integrations/supabase/config";
import { useCurrentUser, hasAnyRole } from "@/hooks/use-current-user";
import { useAppSettings } from "@/hooks/use-app-settings";
import {
  THEME_PRESETS,
  applyTheme,
  getSavedTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

interface BranchSetting {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  is_head_office: boolean;
  branch_letter: string;
}

function SettingsPage() {
  const navigate = useNavigate();
  const { roles, loading: userLoading } = useCurrentUser();
  const canEdit = hasAnyRole(roles, ["super_admin", "owner"]);
  const { settings, refresh, loading } = useAppSettings();
  const [companyName, setCompanyName] = useState(settings.company_name);
  const [companyAddress, setCompanyAddress] = useState(settings.company_address);
  const [companyPhone, setCompanyPhone] = useState(settings.company_phone);
  const [licensePva, setLicensePva] = useState(settings.license_pva);
  const [npwpNumber, setNpwpNumber] = useState(settings.npwp_number);
  const [logoUrl, setLogoUrl] = useState(settings.logo_url || "");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [branches, setBranches] = useState<BranchSetting[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [pagiStart, setPagiStart] = useState(settings.shift_pagi_start);
  const [pagiEnd, setPagiEnd] = useState(settings.shift_pagi_end);
  const [siangStart, setSiangStart] = useState(settings.shift_siang_start);
  const [siangEnd, setSiangEnd] = useState(settings.shift_siang_end);
  const [preventOversell, setPreventOversell] = useState(settings.prevent_oversell);
  const [thresholdUsd, setThresholdUsd] = useState(settings.transaction_threshold_usd);
  const [indivBuyEnabled, setIndivBuyEnabled] = useState(settings.threshold_individual_buy_enabled);
  const [indivBuyUsd, setIndivBuyUsd] = useState(settings.threshold_individual_buy_usd);
  const [indivSellEnabled, setIndivSellEnabled] = useState(settings.threshold_individual_sell_enabled);
  const [indivSellUsd, setIndivSellUsd] = useState(settings.threshold_individual_sell_usd);
  const [corpBuyEnabled, setCorpBuyEnabled] = useState(settings.threshold_corporate_buy_enabled);
  const [corpBuyUsd, setCorpBuyUsd] = useState(settings.threshold_corporate_buy_usd);
  const [corpSellEnabled, setCorpSellEnabled] = useState(settings.threshold_corporate_sell_enabled);
  const [corpSellUsd, setCorpSellUsd] = useState(settings.threshold_corporate_sell_usd);
  const [txPrefixCompany, setTxPrefixCompany] = useState(settings.tx_prefix_company || "AMV");
  const [txPrefixBuy, setTxPrefixBuy] = useState(settings.tx_prefix_buy || "1");
  const [txPrefixSell, setTxPrefixSell] = useState(settings.tx_prefix_sell || "2");
  const [selectedTheme, setSelectedTheme] = useState(settings.theme_color || getSavedTheme());
  const [customHex, setCustomHex] = useState(
    (settings.theme_color || getSavedTheme()).startsWith("#")
      ? (settings.theme_color || getSavedTheme())
      : "#0284c7"
  );
  const [savingTheme, setSavingTheme] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("identitas");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadBranches() {
    setBranchesLoading(true);
    const { data } = await supabase
      .from("branches")
      .select("id, code, name, address, city, phone, is_head_office, branch_letter" as any)
      .order("is_head_office", { ascending: false })
      .order("code");
    setBranchesLoading(false);
    if (data) {
      setBranches(
        (data as any[]).map((b) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          address: b.address || "",
          city: b.city || "",
          phone: b.phone || "",
          is_head_office: !!b.is_head_office,
          branch_letter: b.branch_letter || (b.is_head_office ? "J" : (b.code?.includes("03") ? "L" : b.name[0]?.toUpperCase() || "J")),
        })),
      );
    }
  }

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    setCompanyName(settings.company_name);
    setCompanyAddress(settings.company_address);
    setCompanyPhone(settings.company_phone);
    setLicensePva(settings.license_pva);
    setNpwpNumber(settings.npwp_number);
    setLogoUrl(settings.logo_url || "");
    setPagiStart(settings.shift_pagi_start);
    setPagiEnd(settings.shift_pagi_end);
    setSiangStart(settings.shift_siang_start);
    setSiangEnd(settings.shift_siang_end);
    setPreventOversell(settings.prevent_oversell);
    setThresholdUsd(settings.transaction_threshold_usd);
    setIndivBuyEnabled(settings.threshold_individual_buy_enabled);
    setIndivBuyUsd(settings.threshold_individual_buy_usd);
    setIndivSellEnabled(settings.threshold_individual_sell_enabled);
    setIndivSellUsd(settings.threshold_individual_sell_usd);
    setCorpBuyEnabled(settings.threshold_corporate_buy_enabled);
    setCorpBuyUsd(settings.threshold_corporate_buy_usd);
    setCorpSellEnabled(settings.threshold_corporate_sell_enabled);
    setCorpSellUsd(settings.threshold_corporate_sell_usd);
    setTxPrefixCompany(settings.tx_prefix_company || "AMV");
    setTxPrefixBuy(settings.tx_prefix_buy || "1");
    setTxPrefixSell(settings.tx_prefix_sell || "2");
    const effectiveTheme = settings.theme_color || getSavedTheme();
    if (effectiveTheme) {
      setSelectedTheme(effectiveTheme);
      if (effectiveTheme.startsWith("#")) {
        setCustomHex(effectiveTheme);
      }
    }
  }, [settings]);

  useEffect(() => {
    if (!userLoading && !canEdit) {
      toast.error("Anda tidak memiliki akses ke Pengaturan");
      navigate({ to: "/dashboard" });
    }
  }, [userLoading, canEdit, navigate]);

  const handleSelectTheme = (themeId: string) => {
    setSelectedTheme(themeId);
    applyTheme(themeId, true);
  };

  const handleApplyCustomHex = (hexValue: string) => {
    let clean = hexValue.trim();
    if (!clean.startsWith("#")) {
      clean = "#" + clean;
    }
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(clean)) {
      setCustomHex(clean);
      setSelectedTheme(clean);
      applyTheme(clean, true);
      toast.success("Warna kustom diterapkan");
    } else {
      toast.error("Format warna HEX tidak valid (contoh: #0ea5e9)");
    }
  };

  const handleSaveTheme = async () => {
    setSavingTheme(true);
    try {
      // 1. Immediately apply & persist in localStorage
      applyTheme(selectedTheme, true);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);
      } catch {}

      // 2. Persist to Supabase app_settings
      const { data: userRes } = await supabase.auth.getUser();
      const { error: dbError } = await (supabase
        .from("app_settings")
        .update({
          theme_color: selectedTheme,
          updated_at: new Date().toISOString(),
          updated_by: userRes.user?.id ?? null,
        } as any)
        .eq("id", true) as any);

      if (dbError) {
        console.warn("Notice: Database theme update:", dbError.message);
        toast.success(
          "Warna tema tersimpan aman di browser! Agar sinkron ke seluruh komputer cabang, jalankan skrip SQL di Supabase SQL Editor.",
          { duration: 6000 }
        );
      } else {
        toast.success("Warna tampilan berhasil disimpan dan disinkronkan ke seluruh sistem!");
      }

      await refresh();
    } catch (err: any) {
      console.error("Error saving theme:", err);
      toast.success("Warna tampilan berhasil disimpan di browser ini!");
    } finally {
      setSavingTheme(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Ukuran file terlalu besar. Maksimal 5 MB.");
      return;
    }

    // Check type
    if (!file.type.startsWith("image/")) {
      toast.error("Format file harus berupa gambar (PNG, JPG, SVG, WebP).");
      return;
    }

    setUploadingLogo(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `logo-${Date.now()}.${fileExt}`;
      const filePath = `logos/${fileName}`;

      // 1. Try uploading to Supabase Storage bucket
      const { error: uploadError } = await supabase.storage
        .from("company_assets")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage
          .from("company_assets")
          .getPublicUrl(filePath);

        setLogoUrl(publicUrlData.publicUrl);
        toast.success("Logo berhasil diunggah ke storage");
      } else {
        // 2. Fallback: encode as base64 data URI directly into database
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          setLogoUrl(base64);
          toast.success("Logo berhasil dimuat");
        };
        reader.readAsDataURL(file);
      }
    } catch (err: any) {
      console.error("Gagal mengunggah logo:", err);
      // Fallback to base64
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setLogoUrl(base64);
        toast.success("Logo berhasil dimuat");
      };
      reader.readAsDataURL(file);
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveLogo = () => {
    setLogoUrl("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    toast.info("Logo dihapus. Klik Simpan untuk memperbarui database.");
  };

  async function handleSave() {
    const name = companyName.trim();
    if (!name) {
      toast.error("Nama money changer tidak boleh kosong");
      return;
    }
    setSaving(true);
    const { data: userRes } = await supabase.auth.getUser();

    // Determine primary/head office address and phone for global fallbacks
    const headOffice = branches.find((b) => b.is_head_office) || branches[0];
    const primaryAddress = headOffice?.address || companyAddress;
    const primaryPhone = headOffice?.phone || companyPhone;

    const payload: Record<string, any> = {
      company_name: name,
      company_address: primaryAddress.trim(),
      company_phone: primaryPhone.trim(),
      license_pva: licensePva.trim(),
      npwp_number: npwpNumber.trim(),
      logo_url: logoUrl.trim() || null,
      shift_pagi_start: pagiStart,
      shift_pagi_end: pagiEnd,
      shift_siang_start: siangStart,
      shift_siang_end: siangEnd,
      prevent_oversell: preventOversell,
      transaction_threshold_usd: thresholdUsd,
      threshold_individual_buy_enabled: indivBuyEnabled,
      threshold_individual_buy_usd: indivBuyUsd,
      threshold_individual_sell_enabled: indivSellEnabled,
      threshold_individual_sell_usd: indivSellUsd,
      threshold_corporate_buy_enabled: corpBuyEnabled,
      threshold_corporate_buy_usd: corpBuyUsd,
      threshold_corporate_sell_enabled: corpSellEnabled,
      threshold_corporate_sell_usd: corpSellUsd,
      tx_prefix_company: txPrefixCompany.trim().toUpperCase() || "AMV",
      tx_prefix_buy: txPrefixBuy.trim().toUpperCase() || "1",
      tx_prefix_sell: txPrefixSell.trim().toUpperCase() || "2",
      theme_color: selectedTheme,
      updated_at: new Date().toISOString(),
      updated_by: userRes.user?.id ?? null,
    };

    let { error: settingsError } = await supabase
      .from("app_settings")
      .update(payload as any)
      .eq("id", true);

    if (settingsError && settingsError.message?.includes("theme_color")) {
      delete payload.theme_color;
      const retryRes = await supabase
        .from("app_settings")
        .update(payload as any)
        .eq("id", true);
      settingsError = retryRes.error;
    }

    // Always ensure local theme is applied and saved
    applyTheme(selectedTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);
    } catch {}

    if (settingsError) {
      setSaving(false);
      toast.error("Gagal menyimpan: " + settingsError.message);
      return;
    }

    // Save each branch's name, address, city, phone, branch_letter, and is_head_office to branches table
    for (const b of branches) {
      const { error: branchError } = await (supabase
        .from("branches")
        .update({
          name: b.name.trim(),
          address: b.address.trim() || null,
          city: b.city.trim() || null,
          phone: b.phone.trim() || null,
          branch_letter: b.branch_letter ? b.branch_letter.trim().toUpperCase() : null,
          is_head_office: !!b.is_head_office,
        } as any)
        .eq("id", b.id) as any);

      if (branchError) {
        console.error("Gagal memperbarui cabang:", b.code, branchError);
      }
    }

    setSaving(false);
    await refresh();
    await loadBranches();
    toast.success("Pengaturan & Alamat Cabang berhasil disimpan");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <SettingsIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pengaturan</h1>
          <p className="text-sm text-muted-foreground">
            Konfigurasi identitas money changer, logo, dan alamat per cabang
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="h-auto p-1.5 bg-muted/80 border border-border/60 flex flex-wrap gap-1 rounded-xl shadow-xs">
          <TabsTrigger value="identitas" className="gap-2 py-2 px-3.5 text-xs sm:text-sm font-medium">
            <Building2 className="h-4 w-4 text-primary" />
            <span>Identitas & Cabang</span>
          </TabsTrigger>
          <TabsTrigger value="tema" className="gap-2 py-2 px-3.5 text-xs sm:text-sm font-medium">
            <Palette className="h-4 w-4 text-primary" />
            <span>Tema & Warna</span>
          </TabsTrigger>
          <TabsTrigger value="shif" className="gap-2 py-2 px-3.5 text-xs sm:text-sm font-medium">
            <Clock className="h-4 w-4 text-primary" />
            <span>Jam Shif Kerja</span>
          </TabsTrigger>
          <TabsTrigger value="transaksi" className="gap-2 py-2 px-3.5 text-xs sm:text-sm font-medium">
            <Coins className="h-4 w-4 text-primary" />
            <span>Transaksi & Format</span>
          </TabsTrigger>
          {hasAnyRole(roles, ["super_admin"]) && (
            <TabsTrigger value="database" className="gap-2 py-2 px-3.5 text-xs sm:text-sm font-medium">
              <PlugZap className="h-4 w-4 text-primary" />
              <span>Database & Koneksi</span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="identitas" className="space-y-6 focus-visible:outline-none">
          <Card className="w-full">
        <CardHeader>
          <CardTitle>Identitas Money Changer</CardTitle>
          <CardDescription>
            Informasi, logo, dan alamat cabang ini akan ditampilkan pada sidebar, header, papan kurs TV, kwitansi, dan laporan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Logo Upload Section */}
          <div className="space-y-2.5">
            <Label className="text-sm font-medium">Logo Money Changer</Label>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {/* Preview Box */}
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20 p-2 overflow-hidden shadow-inner relative group">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Logo Preview"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-muted-foreground text-center">
                    <ImageIcon className="h-8 w-8 opacity-40 mb-1" />
                    <span className="text-[10px]">Belum ada logo</span>
                  </div>
                )}
                {uploadingLogo && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-xs">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
              </div>

              {/* Action Buttons & Info */}
              <div className="flex flex-1 flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                  disabled={loading || saving || uploadingLogo}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading || saving || uploadingLogo}
                  >
                    {uploadingLogo ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UploadCloud className="h-4 w-4" />
                    )}
                    {logoUrl ? "Ganti Logo" : "Unggah Logo"}
                  </Button>
                  {logoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={handleRemoveLogo}
                      disabled={loading || saving || uploadingLogo}
                    >
                      <Trash2 className="h-4 w-4" />
                      Hapus
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Format yang didukung: PNG, JPG, SVG, WebP (Maksimal 5 MB). Disarankan logo berlatar belakang transparan.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-name">Nama Money Changer</Label>
            <Input
              id="company-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Contoh: PT Sinar Valuta Nusantara"
              disabled={loading || saving}
              maxLength={80}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="license-pva">Izin PVA</Label>
              <Input
                id="license-pva"
                value={licensePva}
                onChange={(e) => setLicensePva(e.target.value)}
                placeholder="23/34/KEP.GBI/Dpr/2021"
                disabled={loading || saving}
                maxLength={60}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="npwp-number">NPWP</Label>
              <Input
                id="npwp-number"
                value={npwpNumber}
                onChange={(e) => setNpwpNumber(e.target.value)}
                placeholder="01.446.521.5-904.000"
                disabled={loading || saving}
                maxLength={40}
              />
            </div>
          </div>

          {/* Section Alamat & Kontak per Cabang */}
          <div className="space-y-4 pt-3 border-t">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                <MapPin className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Alamat & Kontak Setiap Cabang</h3>
                <p className="text-xs text-muted-foreground">
                  Alamat dan no. telepon ini akan otomatis dicetak pada struk dan laporan sesuai cabang masing-masing.
                </p>
              </div>
            </div>

            {branchesLoading && branches.length === 0 ? (
              <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Memuat data cabang…
              </div>
            ) : branches.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground border rounded-lg bg-muted/10">
                Belum ada data cabang terdaftar.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Selector Dropdown Kantor Pusat Utama */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <Label className="text-sm font-semibold text-foreground">
                          Pilih Cabang Sebagai Kantor Pusat (Head Office)
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Cabang yang dipilih menjadi pusat penerima transfer sisa kas harian & pusat transaksi jual valas.
                      </p>
                    </div>
                    <div className="w-full sm:w-[260px]">
                      <Select
                        value={branches.find((b) => b.is_head_office)?.id || ""}
                        onValueChange={(val) => {
                          setBranches(
                            branches.map((b) => ({
                              ...b,
                              is_head_office: b.id === val,
                            }))
                          );
                        }}
                        disabled={loading || saving}
                      >
                        <SelectTrigger className="bg-background font-medium">
                          <SelectValue placeholder="Pilih Kantor Pusat..." />
                        </SelectTrigger>
                        <SelectContent>
                          {branches.map((b) => (
                            <SelectItem key={b.id} value={b.id} className="font-medium">
                              {b.name} ({b.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="space-y-3.5">
                {branches.map((b, idx) => (
                  <div
                    key={b.id}
                    className={`rounded-xl border p-4 space-y-3 transition-colors shadow-xs ${
                      b.is_head_office
                        ? "bg-emerald-500/5 border-emerald-500/30 dark:bg-emerald-950/15"
                        : "bg-muted/15 border-border hover:bg-muted/25"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                          {b.code}
                        </span>
                        <span className="font-semibold text-sm">{b.name}</span>
                      </div>
                      {b.is_head_office ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] gap-1 py-1 px-2.5">
                          <CheckCircle2 className="h-3 w-3" /> Kantor Pusat Aktif
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setBranches(
                              branches.map((item) => ({
                                ...item,
                                is_head_office: item.id === b.id,
                              }))
                            );
                          }}
                          disabled={loading || saving}
                          className="h-7 text-xs border-dashed text-muted-foreground hover:text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 gap-1.5 transition-colors"
                        >
                          <Building2 className="h-3 w-3" />
                          Jadikan Kantor Pusat
                        </Button>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`branch-name-${b.id}`} className="text-xs font-medium">
                          Nama Cabang
                        </Label>
                        <Input
                          id={`branch-name-${b.id}`}
                          value={b.name}
                          onChange={(e) => {
                            const updated = [...branches];
                            updated[idx] = { ...b, name: e.target.value };
                            setBranches(updated);
                          }}
                          placeholder="Nama Cabang"
                          disabled={loading || saving}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`branch-addr-${b.id}`} className="text-xs font-medium">
                          Alamat Lengkap Cabang
                        </Label>
                        <Input
                          id={`branch-addr-${b.id}`}
                        value={b.address}
                        onChange={(e) => {
                          const updated = [...branches];
                          updated[idx] = { ...b, address: e.target.value };
                          setBranches(updated);
                        }}
                        placeholder="Contoh: Jl. Raya Uluwatu I No. 66 Jimbaran, Badung, Bali"
                        disabled={loading || saving}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`branch-city-${b.id}`} className="text-xs font-medium">
                          Kota / Kabupaten
                        </Label>
                        <Input
                          id={`branch-city-${b.id}`}
                          value={b.city}
                          onChange={(e) => {
                            const updated = [...branches];
                            updated[idx] = { ...b, city: e.target.value };
                            setBranches(updated);
                          }}
                          placeholder="Contoh: Badung"
                          disabled={loading || saving}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`branch-phone-${b.id}`} className="text-xs font-medium">
                          No. Telp / WhatsApp Cabang
                        </Label>
                        <Input
                          id={`branch-phone-${b.id}`}
                          value={b.phone}
                          onChange={(e) => {
                            const updated = [...branches];
                            updated[idx] = { ...b, phone: e.target.value };
                            setBranches(updated);
                          }}
                          placeholder="Contoh: +62 812-4668-468"
                          disabled={loading || saving}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`branch-letter-${b.id}`} className="text-xs font-medium">
                          Inisial No. Transaksi
                        </Label>
                        <Input
                          id={`branch-letter-${b.id}`}
                          value={b.branch_letter}
                          onChange={(e) => {
                            const updated = [...branches];
                            updated[idx] = { ...b, branch_letter: e.target.value.toUpperCase() };
                            setBranches(updated);
                          }}
                          placeholder="J / L / C"
                          disabled={loading || saving}
                          maxLength={3}
                          className="font-mono uppercase text-center font-bold"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving || loading || uploadingLogo} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Menyimpan…" : "Simpan Pengaturan"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </TabsContent>

    <TabsContent value="tema" className="space-y-6 focus-visible:outline-none">
      {/* Kartu Pengaturan Tema & Warna Tampilan (Super Admin & Owner) */}
      <Card className="w-full border-primary/20 shadow-sm">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <Palette className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Tema & Warna Tampilan</CardTitle>
                <CardDescription>
                  Pilih warna tampilan aplikasi sesuai identitas money changer. Seluruh tombol, badge, kartu, dan sidebar akan langsung beradaptasi.
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="self-start sm:self-auto border-primary/30 text-primary bg-primary/5 text-xs font-semibold">
              Super Admin & Owner
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Preset Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Palet Warna Siap Pakai</Label>
              <span className="text-xs text-muted-foreground">Klik untuk langsung pratinjau</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {THEME_PRESETS.map((preset) => {
                const isSelected = selectedTheme.toLowerCase() === preset.id.toLowerCase();
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectTheme(preset.id)}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs"
                        : "border-border hover:border-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    <div
                      className="h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-white shadow-xs"
                      style={{ backgroundColor: preset.primaryHex }}
                    >
                      {isSelected && <Check className="h-4 w-4 drop-shadow-xs" strokeWidth={3} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                        {preset.name}
                        {preset.id === "ocean" && (
                          <span className="text-[10px] bg-muted px-1.5 py-0.2 rounded font-normal text-muted-foreground">
                            Default
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {preset.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Color Picker */}
          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Warna Kustom (Pilih Bebas)
              </Label>
              {selectedTheme.startsWith("#") && (
                <Badge variant="secondary" className="text-[10px] font-mono">
                  Kustom Aktif: {selectedTheme}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customHex}
                  onChange={(e) => {
                    setCustomHex(e.target.value);
                    handleApplyCustomHex(e.target.value);
                  }}
                  className="h-9 w-9 rounded-lg border border-input cursor-pointer bg-background p-0.5"
                  title="Pilih warna bebas"
                />
                <Input
                  value={customHex}
                  onChange={(e) => setCustomHex(e.target.value)}
                  placeholder="#0284c7"
                  maxLength={7}
                  className="w-28 font-mono uppercase text-sm h-9"
                />
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => handleApplyCustomHex(customHex)}
              >
                Terapkan Warna
              </Button>

              {selectedTheme !== "ocean" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => handleSelectTheme("ocean")}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset ke Default
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Masukkan kode HEX warna identitas perusahaan (contoh: <code>#0D9488</code>, <code>#2563EB</code>, <code>#E11D48</code>). Sistem akan otomatis menghitung warna gradien, bayangan, dan kontrasnya.
            </p>
          </div>

          {/* Live Preview Demonstration */}
          <div className="rounded-xl border bg-background p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pratinjau Langsung Komponen (Live Preview)
              </span>
              <Badge className="text-[10px]">Real-time</Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              {/* Button & Badge previews */}
              <div className="space-y-2.5">
                <div className="text-xs font-medium text-muted-foreground">Tombol & Aksen:</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1.5 shadow-xs">
                    <Save className="h-3.5 w-3.5" />
                    Tombol Utama
                  </Button>
                  <Button size="sm" variant="outline">
                    Tombol Garis
                  </Button>
                  <Badge className="py-1">Badge Primer</Badge>
                  <Badge variant="outline">Badge Outline</Badge>
                </div>
              </div>

              {/* Mini Card Preview */}
              <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-primary">Simulasi Kartu Info</span>
                  <span className="text-[10px] font-mono text-muted-foreground">USD / IDR</span>
                </div>
                <div className="text-lg font-bold text-foreground">
                  Rp 16.450 <span className="text-xs font-normal text-muted-foreground">/ USD</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Gradien dan aksen kartu beradaptasi otomatis dengan tema ini.
                </div>
              </div>
            </div>
          </div>

          {/* Save Theme Button */}
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={handleSaveTheme}
              disabled={savingTheme || loading}
              className="gap-2 shadow-xs"
            >
              {savingTheme ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {savingTheme ? "Menyimpan Tema…" : "Simpan Warna Tampilan"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </TabsContent>

    <TabsContent value="shif" className="space-y-6 focus-visible:outline-none">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Jam Shif Operasional (WITA)</CardTitle>
          <CardDescription>
            Default jam buka/tutup shif. Bersifat informatif — teller tetap bisa
            buka shif di luar jam ini bila diperlukan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Shif Pagi — Mulai</Label>
              <Input
                type="time"
                value={pagiStart}
                onChange={(e) => setPagiStart(e.target.value)}
                disabled={loading || saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Shif Pagi — Selesai</Label>
              <Input
                type="time"
                value={pagiEnd}
                onChange={(e) => setPagiEnd(e.target.value)}
                disabled={loading || saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Shif Siang — Mulai</Label>
              <Input
                type="time"
                value={siangStart}
                onChange={(e) => setSiangStart(e.target.value)}
                disabled={loading || saving}
              />
            </div>
            <div className="space-y-2">
              <Label>Shif Siang — Selesai</Label>
              <Input
                type="time"
                value={siangEnd}
                onChange={(e) => setSiangEnd(e.target.value)}
                disabled={loading || saving}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving || loading} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Menyimpan…" : "Simpan Jam Shif"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </TabsContent>

    <TabsContent value="transaksi" className="space-y-6 focus-visible:outline-none">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            Keamanan & Validasi Transaksi
          </CardTitle>
          <CardDescription>
            Atur batasan dan validasi untuk operasional transaksi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="prevent-oversell" className="text-base font-medium">Cegah Penjualan Melebihi Saldo</Label>
              <p className="text-sm text-muted-foreground">
                Jika aktif, teller tidak bisa menjual valas jika saldo kas untuk mata uang tersebut tidak mencukupi.
              </p>
            </div>
            <Switch
              id="prevent-oversell"
              checked={preventOversell}
              onCheckedChange={setPreventOversell}
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-4 border-t pt-4">
            <div>
              <Label className="text-base font-medium">
                Ambang Batas Transaksi Bulanan Nasabah (USD)
              </Label>
              <p className="text-sm text-muted-foreground mt-0.5">
                Atur batasan akumulasi transaksi bulanan per nasabah dalam ekuivalen USD secara terpisah untuk Perseorangan dan Badan Usaha (Jual & Beli). Jika toggle dinonaktifkan, transaksi tidak akan dibatasi ambang batas.
              </p>
            </div>

            {/* Kategori 1: Perseorangan */}
            <div className="rounded-lg border bg-card/60 p-4 space-y-4">
              <div className="flex items-center justify-between border-b pb-2.5">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <User className="h-4 w-4 text-primary" />
                  <span>Nasabah Perseorangan (Individual)</span>
                </div>
                <Badge variant="outline" className="text-xs">Perseorangan</Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Beli Valas */}
                <div className="rounded-md border bg-background p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Label htmlFor="indiv-buy-toggle" className="text-sm font-semibold cursor-pointer">
                        Beli Valas
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        KUPVA beli dari nasabah
                      </p>
                    </div>
                    <Switch
                      id="indiv-buy-toggle"
                      checked={indivBuyEnabled}
                      onCheckedChange={setIndivBuyEnabled}
                      disabled={loading || saving}
                    />
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Batas Maksimal Bulanan</span>
                      <span className={indivBuyEnabled ? "text-primary font-medium" : "text-muted-foreground"}>
                        {indivBuyEnabled ? "Aktif" : "Nonaktif"}
                      </span>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs font-semibold text-muted-foreground">USD</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={indivBuyUsd ? new Intl.NumberFormat("id-ID").format(indivBuyUsd) : ""}
                        onChange={(e) => setIndivBuyUsd(Number(e.target.value.replace(/[^\d]/g, "")))}
                        placeholder="10.000"
                        disabled={!indivBuyEnabled || loading || saving}
                        className="pl-12"
                      />
                    </div>
                  </div>
                </div>

                {/* Jual Valas */}
                <div className="rounded-md border bg-background p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Label htmlFor="indiv-sell-toggle" className="text-sm font-semibold cursor-pointer">
                        Jual Valas
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        KUPVA jual ke nasabah
                      </p>
                    </div>
                    <Switch
                      id="indiv-sell-toggle"
                      checked={indivSellEnabled}
                      onCheckedChange={setIndivSellEnabled}
                      disabled={loading || saving}
                    />
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Batas Maksimal Bulanan</span>
                      <span className={indivSellEnabled ? "text-primary font-medium" : "text-muted-foreground"}>
                        {indivSellEnabled ? "Aktif" : "Nonaktif"}
                      </span>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs font-semibold text-muted-foreground">USD</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={indivSellUsd ? new Intl.NumberFormat("id-ID").format(indivSellUsd) : ""}
                        onChange={(e) => setIndivSellUsd(Number(e.target.value.replace(/[^\d]/g, "")))}
                        placeholder="10.000"
                        disabled={!indivSellEnabled || loading || saving}
                        className="pl-12"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Kategori 2: Badan Usaha */}
            <div className="rounded-lg border bg-card/60 p-4 space-y-4">
              <div className="flex items-center justify-between border-b pb-2.5">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Building2 className="h-4 w-4 text-primary" />
                  <span>Nasabah Badan Usaha (Corporate)</span>
                </div>
                <Badge variant="outline" className="text-xs">Badan Usaha</Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Beli Valas */}
                <div className="rounded-md border bg-background p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Label htmlFor="corp-buy-toggle" className="text-sm font-semibold cursor-pointer">
                        Beli Valas
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        KUPVA beli dari badan usaha
                      </p>
                    </div>
                    <Switch
                      id="corp-buy-toggle"
                      checked={corpBuyEnabled}
                      onCheckedChange={setCorpBuyEnabled}
                      disabled={loading || saving}
                    />
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Batas Maksimal Bulanan</span>
                      <span className={corpBuyEnabled ? "text-primary font-medium" : "text-muted-foreground"}>
                        {corpBuyEnabled ? "Aktif" : "Nonaktif"}
                      </span>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs font-semibold text-muted-foreground">USD</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={corpBuyUsd ? new Intl.NumberFormat("id-ID").format(corpBuyUsd) : ""}
                        onChange={(e) => setCorpBuyUsd(Number(e.target.value.replace(/[^\d]/g, "")))}
                        placeholder="10.000"
                        disabled={!corpBuyEnabled || loading || saving}
                        className="pl-12"
                      />
                    </div>
                  </div>
                </div>

                {/* Jual Valas */}
                <div className="rounded-md border bg-background p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Label htmlFor="corp-sell-toggle" className="text-sm font-semibold cursor-pointer">
                        Jual Valas
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        KUPVA jual ke badan usaha
                      </p>
                    </div>
                    <Switch
                      id="corp-sell-toggle"
                      checked={corpSellEnabled}
                      onCheckedChange={setCorpSellEnabled}
                      disabled={loading || saving}
                    />
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Batas Maksimal Bulanan</span>
                      <span className={corpSellEnabled ? "text-primary font-medium" : "text-muted-foreground"}>
                        {corpSellEnabled ? "Aktif" : "Nonaktif"}
                      </span>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs font-semibold text-muted-foreground">USD</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={corpSellUsd ? new Intl.NumberFormat("id-ID").format(corpSellUsd) : ""}
                        onChange={(e) => setCorpSellUsd(Number(e.target.value.replace(/[^\d]/g, "")))}
                        placeholder="10.000"
                        disabled={!corpSellEnabled || loading || saving}
                        className="pl-12"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving || loading} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Menyimpan…" : "Simpan Pengaturan Keamanan"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {hasAnyRole(roles, ["super_admin", "owner"]) && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5 text-primary" />
              Prefix & Format Nomor Transaksi
            </CardTitle>
            <CardDescription>
              Atur format prefix nomor transaksi untuk operasional Beli dan Jual di seluruh cabang (Khusus Super Admin).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="tx-prefix-company" className="font-semibold">
                Awalan Kode Perusahaan (Company Prefix)
              </Label>
              <Input
                id="tx-prefix-company"
                value={txPrefixCompany}
                onChange={(e) => setTxPrefixCompany(e.target.value.toUpperCase())}
                placeholder="Contoh: AMV"
                disabled={loading || saving}
                maxLength={10}
                className="max-w-[200px] font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">
                Singkatan nama money changer pada awalan nomor transaksi (Default: AMV).
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t">
              {/* Prefix Beli */}
              <div className="rounded-lg border bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="tx-prefix-buy" className="text-sm font-semibold">
                    Prefix / Kode Transaksi Beli
                  </Label>
                  <Badge variant="outline" className="text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300">
                    Beli Valas
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  <Input
                    id="tx-prefix-buy"
                    value={txPrefixBuy}
                    onChange={(e) => setTxPrefixBuy(e.target.value.toUpperCase())}
                    placeholder="Contoh: 1"
                    disabled={loading || saving}
                    maxLength={6}
                    className="font-mono uppercase text-base"
                  />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Kode pembeda untuk transaksi Beli Valas dari nasabah (Default: <strong>1</strong>).
                  </p>
                </div>
              </div>

              {/* Prefix Jual */}
              <div className="rounded-lg border bg-rose-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="tx-prefix-sell" className="text-sm font-semibold">
                    Prefix / Kode Transaksi Jual
                  </Label>
                  <Badge variant="outline" className="text-xs bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-300">
                    Jual Valas
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  <Input
                    id="tx-prefix-sell"
                    value={txPrefixSell}
                    onChange={(e) => setTxPrefixSell(e.target.value.toUpperCase())}
                    placeholder="Contoh: 2"
                    disabled={loading || saving}
                    maxLength={6}
                    className="font-mono uppercase text-base"
                  />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Kode pembeda untuk transaksi Jual Valas ke nasabah (Default: <strong>2</strong>).
                  </p>
                </div>
              </div>
            </div>

            {/* Live Interactive Preview */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Pratinjau Nomor Transaksi (Live Preview)
                </span>
                <Badge variant="secondary" className="text-[10px]">Real-time</Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-xs">
                {branches.map((b) => {
                  const bLetter = b.branch_letter || (b.is_head_office ? "J" : (b.code?.includes("03") ? "L" : b.name[0]?.toUpperCase() || "J"));
                  const buyExample = `${txPrefixCompany.trim() || "AMV"}${bLetter}${txPrefixBuy.trim() || "1"}-20260911-001`;
                  const sellExample = `${txPrefixCompany.trim() || "AMV"}${bLetter}${txPrefixSell.trim() || "2"}-20260911-001`;

                  return (
                    <div key={b.id} className="p-2.5 rounded-md border bg-background space-y-2">
                      <div className="font-semibold text-foreground flex items-center justify-between">
                        <span>{b.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">Inisial: {bLetter}</span>
                      </div>
                      <div className="space-y-1 font-mono">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-[11px]">Beli:</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">{buyExample}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-[11px]">Jual:</span>
                          <span className="font-bold text-rose-600 dark:text-rose-400">{sellExample}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                Format: <code className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">[Awalan Perusahaan][Inisial Cabang][Kode Tipe]-[YYYYMMDD]-[No. Urut 3 Digit]</code>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving || loading} className="gap-2">
                <Save className="h-4 w-4" />
                {saving ? "Menyimpan…" : "Simpan Format Nomor Transaksi"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </TabsContent>

    {hasAnyRole(roles, ["super_admin"]) && (
      <TabsContent value="database" className="space-y-6 focus-visible:outline-none">
        <ConnectionCard />
      </TabsContent>
    )}
  </Tabs>
</div>
  );
}
function ConnectionCard() {
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState(localStorage.getItem("override_supabase_project_id") || SUPABASE_PROJECT_ID);
  const [url, setUrl] = useState(localStorage.getItem("override_supabase_url") || SUPABASE_URL);
  const [anonKey, setAnonKey] = useState(localStorage.getItem("override_supabase_anon_key") || "");
  const [isUpdating, setIsUpdating] = useState(false);

  async function check() {
    setStatus("checking");
    setMessage("");
    try {
      const { error } = await supabase.from("branches").select("id").limit(1);
      if (error) {
        setStatus("error");
        setMessage(error.message);
      } else {
        setStatus("ok");
        setMessage("Koneksi ke database berhasil.");
      }
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Gagal menghubungkan ke database");
    }
  }

  useEffect(() => {
    void check();
  }, []);

  function handleSwitchProject() {
    if (!projectId || !url || !anonKey) {
      toast.error("Mohon isi Project ID, URL, dan Publishable Key");
      return;
    }

    setIsUpdating(true);
    try {
      localStorage.setItem("override_supabase_project_id", projectId);
      localStorage.setItem("override_supabase_url", url);
      localStorage.setItem("override_supabase_anon_key", anonKey);
      
      toast.success("Konfigurasi disimpan. Halaman akan dimuat ulang...");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      toast.error("Gagal menyimpan konfigurasi");
      setIsUpdating(false);
    }
  }

  function handleReset() {
    localStorage.removeItem("override_supabase_project_id");
    localStorage.removeItem("override_supabase_url");
    localStorage.removeItem("override_supabase_anon_key");
    toast.success("Konfigurasi direset ke default. Memuat ulang...");
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }

  return (
    <Card className="w-full border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugZap className="h-5 w-5 text-primary" />
          Konfigurasi & Koneksi Database
        </CardTitle>
        <CardDescription>
          Atur project database yang digunakan oleh aplikasi ini. (Role: Super Admin Only)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="project-id">Project ID</Label>
            <Input
              id="project-id"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Misal: abcdefghijklmno"
              className="font-mono bg-background"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-url">Project URL</Label>
            <Input
              id="project-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://abcdefghijklmno.supabase.co"
              className="font-mono bg-background"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="anon-key">Publishable (Anon) Key</Label>
            <Input
              id="anon-key"
              type="password"
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              placeholder="sb_publishable_..."
              className="font-mono bg-background"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSwitchProject} disabled={isUpdating} className="flex-1">
            {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Simpan & Hubungkan
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={isUpdating}>
            Reset Default
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4">
          <div className="flex items-center gap-2 text-sm">
            {status === "checking" && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Memeriksa koneksi ke {url}...</span>
              </>
            )}
            {status === "ok" && (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="font-medium text-emerald-700">{message}</span>
              </>
            )}
            {status === "error" && (
              <>
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="break-all font-medium text-destructive">{message}</span>
              </>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={check} disabled={status === "checking"}>
            Uji Ulang
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
