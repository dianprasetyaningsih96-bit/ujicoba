export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  primaryHex: string;
  dotBg: string;
  variables: Record<string, string>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "ocean",
    name: "Ocean Sapphire",
    description: "Biru laut & navy profesional khas PT Arista Marta Valuta (Default)",
    primaryHex: "#0284c7",
    dotBg: "bg-sky-600",
    variables: {
      "--primary": "oklch(0.58 0.09 215)",
      "--primary-foreground": "oklch(0.99 0.008 235)",
      "--primary-deep": "oklch(0.24 0.07 250)",
      "--primary-glow": "oklch(0.78 0.08 195)",
      "--ring": "oklch(0.58 0.09 215)",
      "--sidebar": "oklch(0.24 0.07 250)",
      "--sidebar-primary": "oklch(0.75 0.08 195)",
      "--sidebar-accent": "oklch(0.36 0.08 245)",
      "--sidebar-border": "oklch(0.36 0.08 245)",
    },
  },
  {
    id: "emerald",
    name: "Emerald Prosperity",
    description: "Nuansa hijau zamrud perbankan & kemakmuran finansial",
    primaryHex: "#059669",
    dotBg: "bg-emerald-600",
    variables: {
      "--primary": "oklch(0.58 0.15 155)",
      "--primary-foreground": "oklch(0.99 0.01 155)",
      "--primary-deep": "oklch(0.22 0.07 165)",
      "--primary-glow": "oklch(0.78 0.12 150)",
      "--ring": "oklch(0.58 0.15 155)",
      "--sidebar": "oklch(0.20 0.06 165)",
      "--sidebar-primary": "oklch(0.75 0.14 150)",
      "--sidebar-accent": "oklch(0.30 0.08 160)",
      "--sidebar-border": "oklch(0.30 0.08 160)",
    },
  },
  {
    id: "indigo",
    name: "Royal Indigo",
    description: "Nuansa indigo modern, fintech premium & elegan",
    primaryHex: "#4f46e5",
    dotBg: "bg-indigo-600",
    variables: {
      "--primary": "oklch(0.55 0.18 275)",
      "--primary-foreground": "oklch(0.99 0.01 275)",
      "--primary-deep": "oklch(0.22 0.08 280)",
      "--primary-glow": "oklch(0.76 0.14 270)",
      "--ring": "oklch(0.55 0.18 275)",
      "--sidebar": "oklch(0.20 0.07 280)",
      "--sidebar-primary": "oklch(0.76 0.14 270)",
      "--sidebar-accent": "oklch(0.32 0.08 275)",
      "--sidebar-border": "oklch(0.32 0.08 275)",
    },
  },
  {
    id: "amber",
    name: "Gold Valuta",
    description: "Nuansa emas dan logam mulia mewah eksklusif",
    primaryHex: "#d97706",
    dotBg: "bg-amber-600",
    variables: {
      "--primary": "oklch(0.66 0.17 65)",
      "--primary-foreground": "oklch(0.99 0.01 65)",
      "--primary-deep": "oklch(0.24 0.06 50)",
      "--primary-glow": "oklch(0.82 0.15 75)",
      "--ring": "oklch(0.66 0.17 65)",
      "--sidebar": "oklch(0.20 0.04 50)",
      "--sidebar-primary": "oklch(0.80 0.16 70)",
      "--sidebar-accent": "oklch(0.32 0.06 60)",
      "--sidebar-border": "oklch(0.32 0.06 60)",
    },
  },
  {
    id: "crimson",
    name: "Crimson Ruby",
    description: "Merah marun tegas, dinamis & berwibawa",
    primaryHex: "#dc2626",
    dotBg: "bg-rose-600",
    variables: {
      "--primary": "oklch(0.55 0.20 25)",
      "--primary-foreground": "oklch(0.99 0.01 25)",
      "--primary-deep": "oklch(0.22 0.07 20)",
      "--primary-glow": "oklch(0.74 0.17 28)",
      "--ring": "oklch(0.55 0.20 25)",
      "--sidebar": "oklch(0.20 0.04 20)",
      "--sidebar-primary": "oklch(0.74 0.17 28)",
      "--sidebar-accent": "oklch(0.30 0.06 25)",
      "--sidebar-border": "oklch(0.30 0.06 25)",
    },
  },
  {
    id: "teal",
    name: "Teal Horizon",
    description: "Nuansa toska segar, jernih & kontemporer",
    primaryHex: "#0d9488",
    dotBg: "bg-teal-600",
    variables: {
      "--primary": "oklch(0.60 0.14 190)",
      "--primary-foreground": "oklch(0.99 0.01 190)",
      "--primary-deep": "oklch(0.22 0.07 200)",
      "--primary-glow": "oklch(0.78 0.10 185)",
      "--ring": "oklch(0.60 0.14 190)",
      "--sidebar": "oklch(0.20 0.05 205)",
      "--sidebar-primary": "oklch(0.75 0.11 185)",
      "--sidebar-accent": "oklch(0.30 0.07 195)",
      "--sidebar-border": "oklch(0.30 0.07 195)",
    },
  },
  {
    id: "slate",
    name: "Titanium Slate",
    description: "Nuansa abu-abu netral elegan, fokus & bersih",
    primaryHex: "#475569",
    dotBg: "bg-slate-600",
    variables: {
      "--primary": "oklch(0.48 0.04 250)",
      "--primary-foreground": "oklch(0.99 0.01 250)",
      "--primary-deep": "oklch(0.20 0.02 250)",
      "--primary-glow": "oklch(0.72 0.03 250)",
      "--ring": "oklch(0.48 0.04 250)",
      "--sidebar": "oklch(0.18 0.02 250)",
      "--sidebar-primary": "oklch(0.72 0.03 250)",
      "--sidebar-accent": "oklch(0.28 0.02 250)",
      "--sidebar-border": "oklch(0.28 0.02 250)",
    },
  },
];

export const THEME_STORAGE_KEY = "valuta_app_theme";

/**
 * Helper to convert HEX to HSL values
 */
function hexToHsl(hex: string): { h: number; s: number; l: number; isLight: boolean } {
  let c = hex.replace("#", "").trim();
  if (c.length === 3) {
    c = c.split("").map((x) => x + x).join("");
  }
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h = Math.round(h * 60);
  }

  // Calculate perceived luminance
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return {
    h,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
    isLight: luminance > 0.65,
  };
}

/**
 * Generate CSS custom property map for a custom hex color
 */
export function generateCustomThemeVariables(hex: string): Record<string, string> {
  const { h, s, l, isLight } = hexToHsl(hex);
  
  const primaryHsl = `hsl(${h} ${s}% ${l}%)`;
  const primaryDeep = `hsl(${h} ${Math.min(s, 50)}% ${Math.max(16, Math.round(l * 0.45))}%)`;
  const primaryGlow = `hsl(${h} ${s}% ${Math.min(88, Math.round(l * 1.3))}%)`;
  const primaryForeground = isLight ? "oklch(0.18 0.05 250)" : "oklch(0.99 0.008 235)";
  
  const sidebarHsl = `hsl(${h} ${Math.min(s, 35)}% 17%)`;
  const sidebarAccent = `hsl(${h} ${Math.min(s, 35)}% 25%)`;
  const sidebarPrimary = `hsl(${h} ${s}% ${Math.min(80, Math.round(l * 1.25))}%)`;
  const sidebarBorder = `hsl(${h} ${Math.min(s, 30)}% 25%)`;

  return {
    "--primary": primaryHsl,
    "--primary-foreground": primaryForeground,
    "--primary-deep": primaryDeep,
    "--primary-glow": primaryGlow,
    "--ring": primaryHsl,
    "--sidebar": sidebarHsl,
    "--sidebar-primary": sidebarPrimary,
    "--sidebar-accent": sidebarAccent,
    "--sidebar-border": sidebarBorder,
  };
}

/**
 * Apply theme to document.documentElement
 */
export function applyTheme(themeKeyOrHex: string | null | undefined): void {
  if (typeof document === "undefined") return;

  const key = (themeKeyOrHex || "ocean").trim();
  const root = document.documentElement;

  // 1. Check if it matches a preset
  const preset = THEME_PRESETS.find((p) => p.id.toLowerCase() === key.toLowerCase());
  if (preset) {
    Object.entries(preset.variables).forEach(([prop, val]) => {
      root.style.setProperty(prop, val);
    });
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preset.id);
    } catch {
      // ignore
    }
    return;
  }

  // 2. If it's a HEX color code (e.g. #059669)
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(key)) {
    const vars = generateCustomThemeVariables(key);
    Object.entries(vars).forEach(([prop, val]) => {
      root.style.setProperty(prop, val);
    });
    try {
      localStorage.setItem(THEME_STORAGE_KEY, key);
    } catch {
      // ignore
    }
    return;
  }

  // 3. Fallback to ocean default
  const defaultPreset = THEME_PRESETS[0];
  Object.entries(defaultPreset.variables).forEach(([prop, val]) => {
    root.style.setProperty(prop, val);
  });
}

/**
 * Get active theme key from localStorage or fallback
 */
export function getSavedTheme(): string {
  if (typeof window === "undefined") return "ocean";
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || "ocean";
  } catch {
    return "ocean";
  }
}