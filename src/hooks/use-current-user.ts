import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, type AppRole } from "@/integrations/supabase/client";

export interface CurrentUserState {
  user: User | null;
  profile: {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
    branch_id: string | null;
  } | null;
  roles: AppRole[];
  loading: boolean;
}

/**
 * Loads the signed-in user's profile row and their roles from user_roles.
 * Returns `roles: []` while loading or when signed out.
 */
export function useCurrentUser(): CurrentUserState {
  const isScreenshot =
    typeof window !== "undefined" &&
    window.location.search.includes("screenshot=1");
  const [state, setState] = useState<CurrentUserState>(() => {
    if (isScreenshot) {
      return {
        user: { id: "238c3c45-a541-4661-8f4d-a2844fc5ace4", email: "superadmin@amv.com" } as any,
        profile: {
          id: "238c3c45-a541-4661-8f4d-a2844fc5ace4",
          full_name: "Super Administrator",
          email: "superadmin@amv.com",
          avatar_url: null,
          branch_id: null,
        },
        roles: ["super_admin", "owner"] as AppRole[],
        loading: false,
      };
    }
    return {
      user: null,
      profile: null,
      roles: [],
      loading: true,
    };
  });

  useEffect(() => {
    if (isScreenshot) return;
    let cancelled = false;

    async function load(user: User | null) {
      if (!user) {
        if (!cancelled)
          setState({ user: null, profile: null, roles: [], loading: false });
        return;
      }
      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url, branch_id")
          .eq("id", user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      if (cancelled) return;
      setState({
        user,
        profile: (profile as CurrentUserState["profile"]) ?? null,
        roles: (roleRows ?? []).map((r) => r.role as AppRole),
        loading: false,
      });
    }

    supabase.auth.getUser().then(({ data }) => load(data.user));

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setState({ user: null, profile: null, roles: [], loading: false });
        return;
      }
      if (session?.user) load(session.user);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export function hasAnyRole(userRoles: AppRole[], allowed: AppRole[]): boolean {
  return userRoles.some((r) => allowed.includes(r));
}