/**
 * Orquestador de liquidaciones — primera pieza del módulo Liquidaciones (6c).
 *
 * Esta función es la única responsable de:
 *   1) resolver el launch y su organización/proyecto,
 *   2) resolver la regla de split vigente (launch-scope > project-default),
 *   3) verificar idempotencia (no re-liquidar lo ya cerrado),
 *   4) leer los agregados de sales/payments sin fan-out,
 *   5) correr `computeSettlement` (calc.ts) y armar el payload,
 *   6) insertarlo SOLO si `dryRun=false`.
 *
 * QUÉ ES Y QUÉ NO ES ESTA FUNCIÓN
 *
 *  - ES la base del futuro server action de 6b-write y del CLI de gate 6c-a.
 *  - ES el único lugar donde se decide "cómo se arma una liquidación".
 *  - NO cambia el status a `liquidada`. Ese salto lo hace otra pieza más
 *    adelante (6c): crear borrador → verificar contra payments → cerrar.
 *  - NO crea `client_transfers`.
 *  - NO decide qué fecha va en `closed_at`. Deja el campo NULL — es una
 *    // DECISIÓN PENDIENTE de 6c (ver bloque de comentario más abajo).
 *
 * REGLA DE ORO (heredada de calc.ts y del CHECK de 0055): `collectedTotal`
 * se lee UNA sola vez, acá, desde `payments`. Nunca se recalcula desde otra
 * fuente. `totalSold` y `salesCount` se sacan con una query INDEPENDIENTE
 * sobre `sales`, no mezclada con `payments` — un join sales × payments
 * multiplica cada venta por su cantidad de pagos y arruina totalSold.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { computeLaunchAggregates } from "./aggregates";
import { computeSettlement, type SettlementInputs } from "./calc";
import { resolveActiveRule } from "./rule-resolver";
import {
  toSettlementRuleSnapshot,
  type LaunchSettlementStatus,
  type SettlementRuleSnapshot,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Contrato público
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateSettlementInput {
  launchId: string;
  /** Default: true. Cambiarlo a false requiere paso explícito del caller. */
  dryRun?: boolean;
}

/**
 * Payload que se inserta en `launch_settlements`. Es el mismo shape que
 * consumen 6b-write y el CLI en modo dry-run — por eso lo devolvemos aparte
 * del resultado, para poder inspeccionarlo antes de decidir escribir.
 */
export interface LaunchSettlementInsert {
  organization_id: string;
  launch_id: string;
  project_id: string;
  settlement_rule_snapshot: SettlementRuleSnapshot;
  collected_total: number;
  kingrow_retained: number;
  owed_to_client: number;
  status: LaunchSettlementStatus;
  /**
   * closed_at queda null a propósito.
   *
   * DECISIÓN PENDIENTE (6c): closed_at puede ser
   *   (a) la fecha administrativa de la liquidación (hoy), o
   *   (b) la fecha económica del lanzamiento (launches.date / launch_end).
   * Determina en qué mes cae el ingreso en el dashboard financiero — un
   * lanzamiento cerrado en junio y liquidado hoy aparecería como facturación
   * de julio bajo criterio (a) y de junio bajo criterio (b).
   * Este orquestador NO decide. Deja closed_at=null y el paso de transición
   * `abierta → liquidada` (aún no escrito) lo setea con la política que se
   * elija.
   */
  closed_at: null;
}

export type CreateSettlementFailReason =
  | "launch-not-found"
  | "no-rule"
  | "already-settled"
  | "no-payments";

export type CreateSettlementResult =
  | {
      ok: true;
      dryRun: boolean;
      payload: LaunchSettlementInsert;
      /**
       * Cantidad de borradores (status='abierta') ya existentes para este
       * launch al momento de la llamada. No bloquean — solo se reportan.
       */
      draftsCount: number;
      /** Solo definido cuando dryRun=false y el insert fue exitoso. */
      settlementId?: string;
    }
  | {
      ok: false;
      reason: CreateSettlementFailReason;
      detail: string;
    };

// ═══════════════════════════════════════════════════════════════════════════
// Implementación
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estas queries usan tablas que hoy NO están tipadas en `Database` (el
 * snapshot de types generados por Supabase no las incluye — settlement_rules
 * y launch_settlements se agregaron en 0053/0055). Casteamos al borde,
 * mismo patrón documentado en la nota `feedback_supabase_never_inference`.
 */
type AnySupabase = SupabaseClient<any, any, any>;

const CLOSED_STATUSES: LaunchSettlementStatus[] = ["liquidada", "transferida"];

export async function createSettlement(
  supabase: AnySupabase,
  input: CreateSettlementInput,
): Promise<CreateSettlementResult> {
  const dryRun = input.dryRun ?? true;

  // ─── 1) Launch + organización ─────────────────────────────────────────
  const launchRes = await supabase
    .from("launches")
    .select("id, project_id, projects(organization_id)")
    .eq("id", input.launchId)
    .maybeSingle();

  if (launchRes.error) {
    return {
      ok: false,
      reason: "launch-not-found",
      detail: `error consultando launches: ${launchRes.error.message}`,
    };
  }

  const launchRow = launchRes.data as unknown as
    | {
        id: string;
        project_id: string;
        projects: { organization_id: string } | { organization_id: string }[] | null;
      }
    | null;

  if (!launchRow) {
    return {
      ok: false,
      reason: "launch-not-found",
      detail: `no existe launch con id ${input.launchId}`,
    };
  }

  const projectId = launchRow.project_id;
  const organizationId = extractOrgId(launchRow.projects);
  if (!organizationId) {
    return {
      ok: false,
      reason: "launch-not-found",
      detail: `launch ${input.launchId} sin proyecto/organización resuelta`,
    };
  }

  // ─── 2) Regla vigente (launch-scope > project-default) ───────────────
  const rule = await resolveActiveRule(supabase, {
    launchId: input.launchId,
    projectId,
  });

  if (!rule) {
    return {
      ok: false,
      reason: "no-rule",
      detail:
        `no hay settlement_rule activa para launch ${input.launchId} ` +
        `ni default (launch_id IS NULL) para project ${projectId}`,
    };
  }

  // ─── 3) Guard de idempotencia ────────────────────────────────────────
  // Solo bloquean status ∈ {liquidada, transferida}. Los borradores
  // (`abierta`) no bloquean pero los reportamos.
  const closedRes = await supabase
    .from("launch_settlements")
    .select("id, status")
    .eq("launch_id", input.launchId)
    .in("status", CLOSED_STATUSES)
    .limit(1)
    .maybeSingle();

  if (closedRes.error) {
    return {
      ok: false,
      reason: "already-settled",
      detail: `error consultando launch_settlements: ${closedRes.error.message}`,
    };
  }

  const closedExisting = closedRes.data as
    | { id: string; status: LaunchSettlementStatus }
    | null;

  if (closedExisting) {
    return {
      ok: false,
      reason: "already-settled",
      detail:
        `ya existe launch_settlement id=${closedExisting.id} ` +
        `status=${closedExisting.status} para launch ${input.launchId}`,
    };
  }

  const draftsRes = await supabase
    .from("launch_settlements")
    .select("id")
    .eq("launch_id", input.launchId)
    .eq("status", "abierta");

  const draftsCount = draftsRes.data?.length ?? 0;

  // ─── 4) Agregados de sales y payments (sin fan-out) ──────────────────
  // Delegado a computeLaunchAggregates — misma función que consume el
  // simulador del formulario de reglas. Antes había dos implementaciones
  // idénticas de este cálculo; unificarlas evita que diverjan.
  const { collectedTotal, totalSold, salesCount } = await computeLaunchAggregates(
    supabase,
    input.launchId,
  );

  if (collectedTotal === 0) {
    return {
      ok: false,
      reason: "no-payments",
      detail:
        `launch ${input.launchId} sin pagos (Σ payments.amount = 0). ` +
        `Nada que liquidar.`,
    };
  }

  // ─── 5) Motor de split ────────────────────────────────────────────────
  const snapshot = toSettlementRuleSnapshot(rule);
  const inputs: SettlementInputs = { collectedTotal, totalSold, salesCount };
  const breakdown = computeSettlement(snapshot, inputs);

  const payload: LaunchSettlementInsert = {
    organization_id: organizationId,
    launch_id: input.launchId,
    project_id: projectId,
    settlement_rule_snapshot: snapshot,
    collected_total: collectedTotal,
    kingrow_retained: breakdown.kingrowRetained,
    owed_to_client: breakdown.owedToClient,
    status: "abierta",
    closed_at: null,
  };

  // ─── 6) Insert (o dry-run) ────────────────────────────────────────────
  if (dryRun) {
    return { ok: true, dryRun: true, payload, draftsCount };
  }

  const insertRes = await supabase
    .from("launch_settlements")
    .insert(payload as unknown as never)
    .select("id")
    .single();

  const inserted = insertRes.data as { id: string } | null;
  if (insertRes.error || !inserted) {
    // Al ser una inserción, un error acá no encaja en ninguno de los
    // reasons de negocio — lo tratamos como un fallo runtime y lo
    // propagamos como excepción para no ocultarlo bajo un ok:false que
    // el caller confundiría con una regla de negocio ausente.
    throw new Error(
      `insert launch_settlements falló: ${insertRes.error?.message ?? "sin data"}`,
    );
  }

  return {
    ok: true,
    dryRun: false,
    payload,
    draftsCount,
    settlementId: inserted.id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers internos
// ═══════════════════════════════════════════════════════════════════════════

function extractOrgId(
  projects: { organization_id: string } | { organization_id: string }[] | null,
): string | null {
  if (!projects) return null;
  if (Array.isArray(projects)) return projects[0]?.organization_id ?? null;
  return projects.organization_id ?? null;
}
