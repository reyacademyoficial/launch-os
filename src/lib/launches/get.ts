import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { LaunchRow } from "./types";

/**
 * Returns a single launch by id, or null if the caller can't read it.
 * RLS filters before we see anything; a non-accessible id behaves identically
 * to a missing one (both return null).
 */
export async function getLaunch(launchId: string): Promise<LaunchRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("launches")
    .select("*")
    .eq("id", launchId)
    .maybeSingle();

  return (data as LaunchRow | null) ?? null;
}
