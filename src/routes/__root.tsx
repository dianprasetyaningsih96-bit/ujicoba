import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { useAppSettings } from "@/hooks/use-app-settings";
import { getSavedTheme, applyTheme } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <pre className="mt-4 max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-left text-[11px] leading-snug text-muted-foreground whitespace-pre-wrap break-words">
          {String(error?.message ?? error)}
          {error?.stack ? "\n\n" + error.stack : ""}
        </pre>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "PT ARISTA MARTA VALUTA" },
      {
        name: "description",
        content:
          "Sistem Informasi Money Changer PT ARISTA MARTA VALUTA: KYC/CDD, transaksi valas, manajemen kas, dan pelaporan sesuai regulasi Bank Indonesia.",
      },
      { name: "author", content: "PT ARISTA MARTA VALUTA" },
      { property: "og:title", content: "PT ARISTA MARTA VALUTA" },
      {
        property: "og:description",
        content: "Sistem informasi money changer terintegrasi untuk PT ARISTA MARTA VALUTA berlisensi Bank Indonesia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "shortcut icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "alternate icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              try {
                var t = (localStorage.getItem('valuta_app_theme') || 'ocean').trim();
                var presets = {
                  ocean: {"--primary":"oklch(0.58 0.09 215)","--primary-foreground":"oklch(0.99 0.008 235)","--primary-deep":"oklch(0.24 0.07 250)","--primary-glow":"oklch(0.78 0.08 195)","--ring":"oklch(0.58 0.09 215)","--sidebar":"oklch(0.24 0.07 250)","--sidebar-primary":"oklch(0.75 0.08 195)","--sidebar-accent":"oklch(0.36 0.08 245)","--sidebar-border":"oklch(0.36 0.08 245)"},
                  emerald: {"--primary":"oklch(0.58 0.15 155)","--primary-foreground":"oklch(0.99 0.01 155)","--primary-deep":"oklch(0.22 0.07 165)","--primary-glow":"oklch(0.78 0.12 150)","--ring":"oklch(0.58 0.15 155)","--sidebar":"oklch(0.20 0.06 165)","--sidebar-primary":"oklch(0.75 0.14 150)","--sidebar-accent":"oklch(0.30 0.08 160)","--sidebar-border":"oklch(0.30 0.08 160)"},
                  indigo: {"--primary":"oklch(0.55 0.18 275)","--primary-foreground":"oklch(0.99 0.01 275)","--primary-deep":"oklch(0.22 0.08 280)","--primary-glow":"oklch(0.76 0.14 270)","--ring":"oklch(0.55 0.18 275)","--sidebar":"oklch(0.20 0.07 280)","--sidebar-primary":"oklch(0.76 0.14 270)","--sidebar-accent":"oklch(0.32 0.08 275)","--sidebar-border":"oklch(0.32 0.08 275)"},
                  amber: {"--primary":"oklch(0.66 0.17 65)","--primary-foreground":"oklch(0.99 0.01 65)","--primary-deep":"oklch(0.24 0.06 50)","--primary-glow":"oklch(0.82 0.15 75)","--ring":"oklch(0.66 0.17 65)","--sidebar":"oklch(0.20 0.04 50)","--sidebar-primary":"oklch(0.80 0.16 70)","--sidebar-accent":"oklch(0.32 0.06 60)","--sidebar-border":"oklch(0.32 0.06 60)"},
                  crimson: {"--primary":"oklch(0.55 0.20 25)","--primary-foreground":"oklch(0.99 0.01 25)","--primary-deep":"oklch(0.22 0.07 20)","--primary-glow":"oklch(0.74 0.17 28)","--ring":"oklch(0.55 0.20 25)","--sidebar":"oklch(0.20 0.04 20)","--sidebar-primary":"oklch(0.74 0.17 28)","--sidebar-accent":"oklch(0.30 0.06 25)","--sidebar-border":"oklch(0.30 0.06 25)"},
                  teal: {"--primary":"oklch(0.60 0.14 190)","--primary-foreground":"oklch(0.99 0.01 190)","--primary-deep":"oklch(0.22 0.07 200)","--primary-glow":"oklch(0.78 0.10 185)","--ring":"oklch(0.60 0.14 190)","--sidebar":"oklch(0.20 0.05 205)","--sidebar-primary":"oklch(0.75 0.11 185)","--sidebar-accent":"oklch(0.30 0.07 195)","--sidebar-border":"oklch(0.30 0.07 195)"},
                  slate: {"--primary":"oklch(0.48 0.04 250)","--primary-foreground":"oklch(0.99 0.01 250)","--primary-deep":"oklch(0.20 0.02 250)","--primary-glow":"oklch(0.72 0.03 250)","--ring":"oklch(0.48 0.04 250)","--sidebar":"oklch(0.18 0.02 250)","--sidebar-primary":"oklch(0.72 0.03 250)","--sidebar-accent":"oklch(0.28 0.02 250)","--sidebar-border":"oklch(0.28 0.02 250)"}
                };
                var root = document.documentElement;
                if (presets[t]) {
                  var v = presets[t];
                  for (var k in v) { root.style.setProperty(k, v[k]); }
                }
              } catch(e) {}
            })()`
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function BrandSync() {
  const { settings } = useAppSettings();

  useEffect(() => {
    // Apply saved theme safely without forcefully overriding localStorage
    const themeToApply = settings.theme_color || getSavedTheme();
    applyTheme(themeToApply, false);
  }, [settings.theme_color]);

  useEffect(() => {
    if (settings.company_name) {
      document.title = settings.company_name;
    }
  }, [settings.company_name]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <BrandSync />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster richColors position="top-right" expand={true} visibleToasts={6} gap={8} />
    </QueryClientProvider>
  );
}
