import { EmptyState } from "@/components/kg/empty-state";
import type {
  CourseDropoffRow,
  CourseModuleCompletionRow,
  CourseOverallProgress,
} from "@/lib/academia/course-metrics";
import { pickTopDropoff } from "@/lib/academia/course-metrics";

/**
 * Pestaña "Métricas" del detalle del curso (Fase F). Renderizada solo si
 * course.progress_source = 'ghl_tags'. Server component — recibe los datos
 * ya resueltos por el padre; sin fetching interno ni state.
 *
 * Layout:
 *   - Card KPI grande arriba: % visualización promedio
 *   - Card KPI: alumnos que completaron todo el curso
 *   - Card KPI: módulo con más abandono
 *   - Gráfico embudo por módulo: barras horizontales HTML/CSS (sin lib de
 *     charts). Ancho proporcional a completion_rate.
 */

export function MetricasTab({
  completions,
  dropoff,
  overall,
}: {
  readonly completions: readonly CourseModuleCompletionRow[];
  readonly dropoff: readonly CourseDropoffRow[];
  readonly overall: CourseOverallProgress;
}) {
  const topDropoff = pickTopDropoff(dropoff);

  if (completions.length === 0) {
    return (
      <EmptyState
        title="Sin módulos configurados"
        hint="Cargá los módulos del curso en la pestaña Módulos y asignales su tag GHL. Cuando la sync corra, aparecen las métricas."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <KpiCard
          label="% visualización promedio"
          value={formatPct(overall.avg_completion_percent)}
          hint={
            overall.total_students === 0
              ? "Sin alumnos activos"
              : `${overall.total_students} alumno${overall.total_students === 1 ? "" : "s"} en el universo`
          }
          big
        />
        <KpiCard
          label="Completaron todo el curso"
          value={String(overall.fully_completed_students)}
          hint={
            overall.total_students === 0
              ? "Sin base"
              : `${overall.fully_completed_students} de ${overall.total_students}`
          }
        />
        <KpiCard
          label="Módulo con más abandono"
          value={topDropoff?.module_name ?? "—"}
          hint={
            topDropoff == null
              ? "Sin abandono detectable"
              : `${topDropoff.students_stuck} alumno${topDropoff.students_stuck === 1 ? "" : "s"} atascado${topDropoff.students_stuck === 1 ? "" : "s"} acá`
          }
        />
      </div>

      <div
        className="kg-glass"
        style={{
          borderRadius: "var(--kg-r-16)",
          padding: "16px 18px",
          boxShadow: "var(--kg-shadow-amb)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.3,
          }}
        >
          Embudo por módulo
        </div>
        <FunnelChart rows={completions} />
      </div>
    </div>
  );
}

function FunnelChart({
  rows,
}: {
  readonly rows: readonly CourseModuleCompletionRow[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div
          key={r.course_module_id}
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "baseline",
            }}
          >
            <div
              style={{
                color: "var(--kg-text-1)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {r.order_index + 1}. {r.module_name}
            </div>
            <div
              className="kg-t7"
              style={{
                color: "var(--kg-text-3)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {r.completed_students}/{r.total_students} ·{" "}
              {formatPct(r.completion_rate)}
            </div>
          </div>
          <div
            style={{
              position: "relative",
              width: "100%",
              height: 10,
              borderRadius: 999,
              background: "var(--kg-surface-1-solid)",
              border: "1px solid var(--kg-border-subtle)",
              overflow: "hidden",
            }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(r.completion_rate)}
            aria-label={`Completion de ${r.module_name}`}
          >
            <div
              style={{
                width: `${clampPct(r.completion_rate)}%`,
                height: "100%",
                background: "var(--kg-accent-500)",
                transition: "width 200ms ease-out",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  big = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly big?: boolean;
}) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "16px 18px",
        boxShadow: "var(--kg-shadow-amb)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: big ? 34 : 26,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.15,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {hint}
      </div>
    </div>
  );
}

function formatPct(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(1)}%`;
}

function clampPct(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}
