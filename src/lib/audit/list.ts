import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface AuditLogEntry {
  id: string;
  ts: string;
  action: string;
  detail: unknown;
  user_id: string | null;
  user_name: string | null;
}

export interface AuditLogPage {
  rows: readonly AuditLogEntry[];
  total: number;
}

interface RawRow {
  id: string;
  ts: string;
  action: string;
  detail: unknown;
  user_id: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
}

/**
 * Returns a page of audit_log entries for the given project, newest first.
 * RLS filters by project access; if the caller can't see the project, the
 * result is just empty (never an error).
 *
 * user_name is resolved via a follow-up profiles query — audit_log's user_id
 * column FKs to auth.users (no PostgREST embedding) so we join client-side.
 */
export async function listAuditLog(
  projectId: string,
  page: number,
  pageSize: number,
): Promise<AuditLogPage> {
  const supabase = await createClient();
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, count } = await supabase
    .from("audit_log")
    .select("id, ts, action, detail, user_id", { count: "exact" })
    .eq("project_id", projectId)
    .order("ts", { ascending: false })
    .range(from, to);

  const rows = (data ?? []) as RawRow[];
  const userIds = Array.from(
    new Set(rows.map((r) => r.user_id).filter((id): id is string => id !== null)),
  );

  let nameByUser: Record<string, string | null> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    nameByUser = Object.fromEntries(
      ((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p.full_name]),
    );
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      action: r.action,
      detail: r.detail,
      user_id: r.user_id,
      user_name: r.user_id ? (nameByUser[r.user_id] ?? null) : null,
    })),
    total: count ?? 0,
  };
}
