import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSavedTheme, applyTheme } from "@/lib/theme";

export interface AppSettings {
  company_name: string;
  company_address: string;
  company_phone: string;
  license_pva: string;
  npwp_number: string;
  logo_url: string;
  shift_pagi_start: string;
  shift_pagi_end: string;
  shift_siang_start: string;
  shift_siang_end: string;
  prevent_oversell: boolean;
  transaction_threshold_usd: number;
  threshold_individual_buy_enabled: boolean;
  threshold_individual_buy_usd: number;
  threshold_individual_sell_enabled: boolean;
  threshold_individual_sell_usd: number;
  threshold_corporate_buy_enabled: boolean;
  threshold_corporate_buy_usd: number;
  threshold_corporate_sell_enabled: boolean;
  threshold_corporate_sell_usd: number;
  tx_prefix_company: string;
  tx_prefix_buy: string;
  tx_prefix_sell: string;
  theme_color: string;
}

const DEFAULT: AppSettings = {
  company_name: "PT ARISTA MARTA VALUTA",
  company_address: "",
  company_phone: "",
  license_pva: "",
  npwp_number: "",
  logo_url: "",
  shift_pagi_start: "08:00",
  shift_pagi_end: "15:00",
  shift_siang_start: "15:00",
  shift_siang_end: "22:00",
  prevent_oversell: false,
  transaction_threshold_usd: 10000,
  threshold_individual_buy_enabled: true,
  threshold_individual_buy_usd: 10000,
  threshold_individual_sell_enabled: true,
  threshold_individual_sell_usd: 10000,
  threshold_corporate_buy_enabled: true,
  threshold_corporate_buy_usd: 10000,
  threshold_corporate_sell_enabled: true,
  threshold_corporate_sell_usd: 10000,
  tx_prefix_company: "AMV",
  tx_prefix_buy: "1",
  tx_prefix_sell: "2",
  theme_color: "ocean",
};

let cache: AppSettings | null = null;
const listeners = new Set<(s: AppSettings) => void>();

async function fetchSettings(): Promise<AppSettings> {
  const { data } = await (supabase
    .from("app_settings")
    .select("*" as any)
    .eq("id", true)
    .maybeSingle() as any);
  const trim = (v: unknown) =>
    typeof v === "string" ? v.slice(0, 5) : undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  };
  const bool = (v: unknown, fallback: boolean) =>
    v === undefined || v === null ? fallback : !!v;

  const savedTheme = getSavedTheme();
  const themeColor = str((data as Record<string, unknown> | null)?.theme_color) || savedTheme || DEFAULT.theme_color;

  const next: AppSettings = {
    company_name: (data?.company_name as string) || DEFAULT.company_name,
    company_address: str((data as Record<string, unknown> | null)?.company_address),
    company_phone: str((data as Record<string, unknown> | null)?.company_phone),
    license_pva: str((data as Record<string, unknown> | null)?.license_pva),
    npwp_number: str((data as Record<string, unknown> | null)?.npwp_number),
    logo_url: str((data as Record<string, unknown> | null)?.logo_url),
    shift_pagi_start: trim(data?.shift_pagi_start) || DEFAULT.shift_pagi_start,
    shift_pagi_end: trim(data?.shift_pagi_end) || DEFAULT.shift_pagi_end,
    shift_siang_start:
      trim(data?.shift_siang_start) || DEFAULT.shift_siang_start,
    shift_siang_end: trim(data?.shift_siang_end) || DEFAULT.shift_siang_end,
    prevent_oversell: !!data?.prevent_oversell,
    transaction_threshold_usd: Number(data?.transaction_threshold_usd) || DEFAULT.transaction_threshold_usd,
    threshold_individual_buy_enabled: bool(data?.threshold_individual_buy_enabled, DEFAULT.threshold_individual_buy_enabled),
    threshold_individual_buy_usd: num(data?.threshold_individual_buy_usd, DEFAULT.threshold_individual_buy_usd),
    threshold_individual_sell_enabled: bool(data?.threshold_individual_sell_enabled, DEFAULT.threshold_individual_sell_enabled),
    threshold_individual_sell_usd: num(data?.threshold_individual_sell_usd, DEFAULT.threshold_individual_sell_usd),
    threshold_corporate_buy_enabled: bool(data?.threshold_corporate_buy_enabled, DEFAULT.threshold_corporate_buy_enabled),
    threshold_corporate_buy_usd: num(data?.threshold_corporate_buy_usd, DEFAULT.threshold_corporate_buy_usd),
    threshold_corporate_sell_enabled: bool(data?.threshold_corporate_sell_enabled, DEFAULT.threshold_corporate_sell_enabled),
    threshold_corporate_sell_usd: num(data?.threshold_corporate_sell_usd, DEFAULT.threshold_corporate_sell_usd),
    tx_prefix_company: str(data?.tx_prefix_company) || DEFAULT.tx_prefix_company,
    tx_prefix_buy: str(data?.tx_prefix_buy) || DEFAULT.tx_prefix_buy,
    tx_prefix_sell: str(data?.tx_prefix_sell) || DEFAULT.tx_prefix_sell,
    theme_color: themeColor,
  };
  cache = next;
  applyTheme(themeColor);
  listeners.forEach((l) => l(next));
  return next;
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(cache ?? DEFAULT);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    listeners.add(setSettings);
    if (cache === null) {
      fetchSettings().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }

    // Subscribe to real-time changes on app_settings
    const channel = supabase
      .channel(`app-settings-realtime-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        () => {
          fetchSettings();
        },
      )
      .subscribe();

    return () => {
      listeners.delete(setSettings);
      supabase.removeChannel(channel);
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchSettings();
    setLoading(false);
  }, []);

  return { settings, loading, refresh };
}
