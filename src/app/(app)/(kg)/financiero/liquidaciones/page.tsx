import type { Metadata } from "next";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  LaunchSettlementStatus,
  SettlementRuleSnapshot,
} from "@/lib/settlements/types";

import {
  LiquidacionesDashboard,
  type LaunchRow,
  type SettlementRow,
} from "./dashboard";

export const metadata: Metadata = { title: "Liquidaciones" };

// ═══════════════════════════════════════════════════════════════════════════
// Shapes de rows crudas — mismo estilo que /financiero: cast al borde
// porque `launch_settlements` y `settlement_rules` no están en el Database
// generado (0053/0055 se agregaron después del último gen).
// ═══════════════════════════════════════════════════════════════════════════

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly ownership: "propia" | "externa";
  readonly organization_id: string;
}

interface LaunchDbRow {
  readonly id: string;
  readonly name: string | null;
  readonly project_id: string;
  readonly date_end: string | null;
  readonly closed_at: string | null;
}

interface SettlementDbRow {
  readonly id: string;
  readonly launch_id: string;
  readonly project_id: string;
  readonly organization_id: string;
  readonly collected_total: number;
  readonly kingrow_retained: number;
  readonly owed_to_client: number;
  readonly status: LaunchSettlementStatus;
  readonly closed_at: string | null;
  readonly created_at: string;
  readonly settlement_rule_snapshot: SettlementRuleSnapshot;
}

interface ActiveRuleDbRow {
  readonly project_id: string;
  readonly launch_id: string | null;
  readonly active: boolean;
}

export default async function LiquidacionesPage() {
  // Gate duro: mismo criterio que /organizacion/reglas-split. Un cliente ni
  // llega a este layout (el filtro está en `(app)/layout.tsx`); un operador
  // o coordinador se cae al home. RLS es el último guard — si esto se saltea,
  // las policies org-scope devuelven arrays vacíos igual.
  await requireRole("superadmin");

  const supabase = await createClient();

  // Fetch en paralelo: projects para nombre/ownership/org, launches para el
  // universo del listado, settlements para el estado actual, y las reglas
  // activas SOLO para saber si un launch se puede liquidar o no (banner
  // "sin regla" en la UI antes de que el usuario intente y coma el error).
  const [projectsRes, launchesRes, settlementsRes, activeRulesRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, ownership, organization_id")
        .order("name", { ascending: true }),
      supabase
        .from("launches")
        .select("id, name, project_id, date_end, closed_at")
        .order("date_end", { ascending: false, nullsFirst: false }),
      supabase
        .from("launch_settlements")
        .select(
          "id, launch_id, project_id, organization_id, collected_total, kingrow_retained, owed_to_client, status, closed_at, created_at, settlement_rule_snapshot",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("settlement_rules")
        .select("project_id, launch_id, active")
        .eq("active", true),
    ]);

  const projects = (projectsRes.data ?? []) as ProjectRow[];
  const launches = (launchesRes.data ?? []) as LaunchDbRow[];
  const settlements = (settlementsRes.data ?? []) as SettlementDbRow[];
  const activeRules = (activeRulesRes.data ?? []) as ActiveRuleDbRow[];

  // ─── Resoluciones auxiliares ────────────────────────────────────────────
  const projectById = new Map<string, ProjectRow>(
    projects.map((p) => [p.id, p]),
  );

  // Resolución de "el proyecto tiene alguna regla vigente para este launch":
  // (a) override específico (launch_id = X, active=true), O
  // (b) default del proyecto (launch_id IS NULL, active=true).
  // Es la misma lógica que `resolveActiveRule` — la duplicamos acá SOLO
  // como pre-check informativo. El único cálculo con autoridad sigue siendo
  // el orquestador, que lo re-verifica al crear.
  const projectHasDefault = new Set<string>();
  const overrideByLaunch = new Set<string>();
  for (const r of activeRules) {
    if (r.launch_id != null) overrideByLaunch.add(r.launch_id);
    else projectHasDefault.add(r.project_id);
  }
  function launchCanBeSettled(launchId: string, projectId: string): boolean {
    return (
      overrideByLaunch.has(launchId) || projectHasDefault.has(projectId)
    );
  }

  // Agrupar settlements por launch. Un launch puede tener varios (la
  // migración 0055 lo permite explícitamente para re-liquidaciones futuras);
  // hoy solo va a haber uno cerrado + eventualmente uno abierto en paralelo.
  const settlementsByLaunch = new Map<string, SettlementDbRow[]>();
  for (const s of settlements) {
    const list = settlementsByLaunch.get(s.launch_id) ?? [];
    list.push(s);
    settlementsByLaunch.set(s.launch_id, list);
  }

  // ─── Serializar al shape del cliente ────────────────────────────────────
  const rows: LaunchRow[] = launches
    .map((l): LaunchRow | null => {
      const project = projectById.get(l.project_id);
      if (!project) return null; // launch huérfano (RLS o borrado) — omitido
      const launchSettlements: SettlementRow[] = (
        settlementsByLaunch.get(l.id) ?? []
      )
        .slice()
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .map((s) => ({
          id: s.id,
          status: s.status,
          collectedTotal: Number(s.collected_total),
          kingrowRetained: Number(s.kingrow_retained),
          owedToClient: Number(s.owed_to_client),
          closedAt: s.closed_at,
          createdAt: s.created_at,
          ruleName: s.settlement_rule_snapshot.name,
        }));
      return {
        launchId: l.id,
        launchName: l.name ?? `Lanzamiento ${l.id.slice(0, 6)}`,
        projectId: project.id,
        projectName: project.name,
        ownership: project.ownership,
        organizationId: project.organization_id,
        dateEnd: l.date_end,
        launchClosedAt: l.closed_at,
        canBeSettled: launchCanBeSettled(l.id, project.id),
        settlements: launchSettlements,
      };
    })
    .filter((r): r is LaunchRow => r !== null);

  return <LiquidacionesDashboard rows={rows} />;
}
