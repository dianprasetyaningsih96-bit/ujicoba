import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";

export function useCangguExclusion() {
  const { profile } = useCurrentUser();
  const isExcluded = Boolean(profile?.email?.toLowerCase().includes("nocanggu"));
  const [cangguId, setCangguId] = useState<string | null>(null);

  useEffect(() => {
    if (isExcluded) {
      supabase
        .from("branches")
        .select("id")
        .ilike("name", "%Canggu%")
        .limit(1)
        .single()
        .then(
          ({ data }) => {
            if (data) setCangguId(data.id);
          },
          (err) => console.error(err)
        );
    }
  }, [isExcluded]);

  function filterBranches<T extends { id: string; name?: string }>(branches: T[]): T[] {
    if (!isExcluded) return branches;
    // Fallback name check if cangguId is not yet loaded
    return branches.filter((b) => b.id !== cangguId && !(b.name?.toLowerCase().includes("canggu")));
  }

  function filterData<T extends { branch_id?: string | null }>(data: T[]): T[] {
    if (!isExcluded || !cangguId) return data;
    return data.filter((d) => d.branch_id !== cangguId);
  }

  return { isExcluded, cangguId, filterBranches, filterData };
}
