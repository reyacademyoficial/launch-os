import Link from "next/link";

import { resolveCurrentPersonId } from "@/lib/ops/current-person";
import { createClient } from "@/lib/supabase/server";

/**
 * KG · MiJornadaPanel — resumen compacto en el sidebar de los proyectos
 * sincronizados desde Notion (0132-0138) que le pertenecen al usuario logueado.
 *
 * DISEÑO (v3 — Notion-first)
 *   El sync trae TODOS los proyectos de las databases habilitadas y persiste
 *   `owner_id` en cada uno (mapeado desde el assignee de Notion vía
 *   notion_users.kg_person_id). Este widget filtra por `owner_id = mi persona`
 *   y por `notion_page_id IS NOT NULL` para ver "mis tareas de Notion".
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
 *
 * PERFORMANCE
 *   Una sola query por render: `internal_projects` con filtros por owner +
 *   notion_page_id NOT NULL + status abierto. Estimación: < 100 rows por
 *   persona, no vale paginar. Trae solo los campos necesarios.
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

interface NotionProjectRow {
  readonly id: string;
  readonly status: ProjectStatus;
  readonly priority: ProjectPriority;
  readonly due_on: string | null;
}

export async function MiJornadaPanel() {
  const personId = await resolveCurrentPersonId();
  if (!personId) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("internal_projects")
    .select("id, status, priority, due_on")
    .eq("owner_id", personId)
    .not("notion_page_id", "is", null)
    .in("status", [...OPEN_STATUSES]);

  const rows = (data ?? []) as NotionProjectRow[];
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
              label={plural(altaCount, "alta", "altas")}
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
