import { NextResponse } from "next/server";

import {
  buildSettlementsWorkbook,
  type SettlementExportRow,
} from "@/lib/finance/xlsx-export";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  LaunchSettlementStatus,
  SettlementRuleSnapshot,
} from "@/lib/settlements/types";

/**
 * GET /api/financiero/liquidaciones/export
 *
 * Sin filtros — el dashboard filtra client-side. Exportamos TODO lo que el
 * usuario puede ver. Match del gate de la page: superadmin.
 */

interface SettlementDbRow {
  readonly id: string;
  readonly launch_id: string;
  readonly project_id: string;
  readonly collected_total: number;
  readonly kingrow_retained: number;
  readonly owed_to_client: number;
  readonly status: LaunchSettlementStatus;
  readonly closed_at: string | null;
  readonly created_at: string;
  readonly settlement_rule_snapshot: SettlementRuleSnapshot;
}
interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: "propia" | "externa";
}
interface LaunchRow {
  readonly id: string;
  readonly name: string | null;
}

export async function GET() {
  await requireRole("superadmin");

  const supabase = await createClient();
  const settlementsRes = await supabase
    .from("launch_settlements")
    .select(
      "id, launch_id, project_id, collected_total, kingrow_retained, owed_to_client, status, closed_at, created_at, settlement_rule_snapshot",
    )
    .order("created_at", { ascending: false });

  if (settlementsRes.error) {
    return NextResponse.json(
      { error: settlementsRes.error.message },
      { status: 500 },
    );
  }
  const settlements = (settlementsRes.data ?? []) as unknown as SettlementDbRow[];

  const projectIds = Array.from(new Set(settlements.map((s) => s.project_id)));
  const launchIds = Array.from(new Set(settlements.map((s) => s.launch_id)));

  const [projectsRes, launchesRes] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from("projects")
          .select("id, name, ownership")
          .in("id", projectIds)
      : Promise.resolve({ data: [] as ProjectRow[] }),
    launchIds.length > 0
      ? supabase.from("launches").select("id, name").in("id", launchIds)
      : Promise.resolve({ data: [] as LaunchRow[] }),
  ]);
  const projectById = new Map<string, ProjectRow>(
    ((projectsRes.data ?? []) as ProjectRow[]).map((p) => [p.id, p]),
  );
  const launchNameById = new Map<string, string>(
    ((launchesRes.data ?? []) as LaunchRow[]).map((l) => [
      l.id,
      l.name ?? `Lanzamiento ${l.id.slice(0, 6)}`,
    ]),
  );

  const rows: SettlementExportRow[] = settlements.map((s) => {
    const project = projectById.get(s.project_id);
    return {
      projectName: project?.name ?? "—",
      launchName: launchNameById.get(s.launch_id) ?? "—",
      ownership: project?.ownership ?? "propia",
      status: s.status,
      collectedTotal: Number(s.collected_total),
      kingrowRetained: Number(s.kingrow_retained),
      owedToClient: Number(s.owed_to_client),
      ruleName: s.settlement_rule_snapshot.name,
      createdAt: s.created_at,
      closedAt: s.closed_at,
    };
  });

  const buffer = await buildSettlementsWorkbook(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="liquidaciones-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
