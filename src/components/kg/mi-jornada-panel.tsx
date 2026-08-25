import Link from "next/link";

import { resolveCurrentPersonId } from "@/lib/ops/current-person";
import { createClient } from "@/lib/supabase/server";

/**
 * KG · MiJornadaPanel — resumen compacto en el sidebar de los proyectos
 * abiertos que le pertenecen al usuario logueado (fuente del proyecto es
 * indiferente — Notion sync o alta manual).
 *
 * DISEÑO (v5 — alineado con /operaciones/proyectos scope=mine)
 *   Los responsables viven en `internal_project_owners` (M2M desde 0140,
 *   alimentado por el sync de Notion vía notion_users.kg_person_id o por el
 *   drawer nativo). Este widget:
 *     1) Fetch los project_ids donde yo (persona actual) figuro como owner.
 *     2) Fetch esos proyectos que además estén abiertos (status abierto).
 *   Sin filtro por notion_page_id — un proyecto manual asignado también
 *   cuenta como "tu jornada". Antes se restringía a Notion, generaba
 *   discrepancia con /operaciones/proyectos scope=mine.
 *
 *   Muestra hasta 3 contadores según haya:
 *     · Urgente: status='alerta_maxima' O derived atrasado
 *       (due_on < hoy AND status abierto). Notion es fuente de verdad para el
 *       status, por eso "atrasado" NO se persiste — se deriva al leer.
 *     · Altas: priority='alta'. Notion sólo tiene alta/media/baja (mapeadas
 *       en 0137/0138).
 *     · Sin empezar: status='sin_empezar'.
 *   Las líneas overlapean (un proyecto puede caer en las 3) — cada línea es
 *   una vista independiente.
 *
 *   Si el user no tiene persona vinculada, el widget no se muestra.
 *   Si tiene 0 proyectos abiertos, muestra empty state.
 */

type ProjectStatus =
  | "sin_empezar"
  | "en_proceso"
  | "bloqueado"
  | "alerta_maxima"
  | "listo";

type ProjectPriority = "alta" | "media" | "baja";

const OPEN_STATUSES: readonly ProjectStatus[] = [
  "sin_empezar",
  "en_proceso",
  "bloqueado",
  "alerta_maxima",
];

interface OwnedProjectRow {
  readonly id: string;
  readonly status: ProjectStatus;
  readonly priority: ProjectPriority;
  readonly due_on: string | null;
}

export async function MiJornadaPanel() {
  const personId = await resolveCurrentPersonId();
  if (!personId) return null;

  const supabase = await createClient();

  // 1) Ids de proyectos donde soy owner.
  const myOwnerRes = await supabase
    .from("internal_project_owners")
    .select("internal_project_id")
    .eq("person_id", personId);
  const myProjectIds = (
    (myOwnerRes.data ?? []) as Array<{ internal_project_id: string }>
  ).map((r) => r.internal_project_id);

  // 2) Traigo esos proyectos que además estén abiertos.
  //    Sin filtro por notion_page_id — mantiene simetría con
  //    /operaciones/proyectos scope=mine + statusFilter=activos. Antes se
  //    restringía a proyectos sincronizados desde Notion, lo que ocultaba
  //    proyectos manuales asignados y generaba mismatch entre el sidebar y
  //    la lista completa.
  const projectsRes =
    myProjectIds.length === 0
      ? { data: [] as OwnedProjectRow[] }
      : await supabase
          .from("internal_projects")
          .select("id, status, priority, due_on")
          .in("id", myProjectIds)
          .in("status", [...OPEN_STATUSES]);

  const rows = (projectsRes.data ?? []) as OwnedProjectRow[];
  const total = rows.length;

  const today = todayYmd();

  // Urgente = alerta_maxima explícito O atrasado derivado. Usamos un Set de
  // ids para no doble-contar un proyecto que sea AMBAS cosas.
  const urgentIds = new Set<string>();
  for (const r of rows) {
    if (r.status === "alerta_maxima") urgentIds.add(r.id);
    else if (r.due_on != null && r.due_on < today) urgentIds.add(r.id);
  }
  const urgentCount = urgentIds.size;

  const altaCount = rows.filter((r) => r.priority === "alta").length;
  const sinEmpezarCount = rows.filter((r) => r.status === "sin_empezar").length;

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--kg-r-12)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        Mi jornada
      </div>

      {total === 0 ? (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontStyle: "italic",
            fontSize: 11,
          }}
        >
          Sin proyectos pendientes ✓
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            fontSize: 12,
            lineHeight: 1.35,
          }}
        >
          <div
            style={{
              color: "var(--kg-text-1)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{total}</span>{" "}
            {plural(total, "proyecto abierto", "proyectos abiertos")}
          </div>
          {(urgentCount > 0 || altaCount > 0 || sinEmpezarCount > 0) && (
            <div
              className="kg-t7"
              style={{
                color: "var(--kg-text-3)",
                fontSize: 10,
                fontStyle: "italic",
                marginTop: 2,
              }}
              title="Las categorías se solapan: un proyecto puede aparecer en varias."
            >
              De los cuales:
            </div>
          )}
          {urgentCount > 0 && (
            <CounterLine
              n={urgentCount}
              label={plural(urgentCount, "urgente", "urgentes")}
              color="#F04060"
            />
          )}
          {altaCount > 0 && (
            <CounterLine
              n={altaCount}
              label={plural(altaCount, "de alta prioridad", "de alta prioridad")}
              color="#FFB800"
            />
          )}
          {sinEmpezarCount > 0 && (
            <CounterLine
              n={sinEmpezarCount}
              label="sin empezar"
              color="var(--kg-text-1)"
            />
          )}
        </div>
      )}

      <Link
        href="/operaciones/proyectos"
        className="kg-focus"
        style={{
          color: "var(--kg-text-2)",
          textDecoration: "none",
          fontSize: 11,
          fontWeight: 600,
          marginTop: 2,
        }}
      >
        Ver todo →
      </Link>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes / helpers
// ═══════════════════════════════════════════════════════════════════════════

function CounterLine({
  n,
  label,
  color,
}: {
  readonly n: number;
  readonly label: string;
  readonly color: string;
}) {
  return (
    <div style={{ color, fontWeight: color === "var(--kg-text-1)" ? 400 : 600 }}>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{n}</span>{" "}
      {label}
    </div>
  );
}

function plural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

function todayYmd(): string {
  // Argentina TZ — matchea /operaciones/proyectos (calendario laboral).
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}
