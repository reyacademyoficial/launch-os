import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconLaunch } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";
import { listAlertRulesForLaunch } from "@/lib/alerts/list";
import {
  ALERT_METRIC_LABELS,
  type AlertMetric,
  type AlertRuleRow,
} from "@/lib/alerts/types";
import { fmtNumber } from "@/lib/format";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";

import { AlertRuleForm } from "./rule-form";
import { AlertRuleRowActions } from "./row-actions";

export const metadata: Metadata = { title: "Alertas · Lanzamiento" };

/**
 * Tab "Alertas" del detalle del launch. Tabla de reglas + form de creación.
 *
 * Quién puede tocar:
 *   - SELECT: cualquier miembro del proyecto (RLS por has_project_access).
 *     Coordinador y cliente (en el shell del equipo) ven la lista pero no
 *     pueden crear/editar/borrar — el form se oculta y los row actions
 *     también.
 *   - I/U/D: admin / operador / superadmin (can_edit_launches_in).
 *
 * Las reglas evalúan post-sync OK y post-daily manual. La evaluación es
 * idempotente por (launch, rule, día UTC) — disparar el mismo día no
 * duplica la notif.
 *
 * MIGRACIÓN KG
 * La `<table>` a mano pasó a `KgDataTable` dentro de un `Panel`, el `Badge`
 * legacy a `StatusPill` y el "sin reglas configuradas" al EmptyState que la
 * propia tabla renderiza (`emptyTitle` / `emptyHint`). El `ContextBar` ya
 * estaba y se conserva tal cual.
 *
 * El wrapper raíz sigue siendo `flex flex-col gap-5` (NO `h-full min-h-0`):
 * esta page apila dos Panels y ninguno usa `fillHeight`, así que clavarle la
 * altura al viewport dejaría el segundo bloque fuera del scroll de `main`.
 */
export default async function LaunchAlertasPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [rules, canEdit] = await Promise.all([
    listAlertRulesForLaunch(launchId),
    userCanEditLaunchesIn(projectId),
  ]);

  const activeRules = rules.filter((r) => r.active).length;
  // Métricas distintas cubiertas: dos reglas sobre la misma métrica (ej. dos
  // umbrales de CPL) vigilan lo mismo, así que el count de reglas solo no
  // dice cuánta superficie del launch está realmente monitoreada.
  const metricsCovered = new Set(rules.map((r) => r.metric)).size;

  const columns: ReadonlyArray<Column<AlertRuleRow>> = [
    {
      key: "metric",
      label: "Métrica",
      render: (r) => (
        <strong style={{ fontWeight: 600, color: "var(--kg-text-1)" }}>
          {ALERT_METRIC_LABELS[r.metric as AlertMetric]}
        </strong>
      ),
    },
    {
      key: "condition",
      label: "Condición",
      width: "200px",
      // `numeric` para que el umbral salga con tabular-nums: alineado entre
      // filas aunque el operador cambie de ancho.
      numeric: true,
      render: (r) =>
        r.metric === "sin_leads"
          ? `≥ ${r.threshold} días`
          : `${r.operator} ${r.threshold}`,
    },
    {
      key: "active",
      label: "Estado",
      width: "140px",
      render: (r) => (
        <StatusPill
          text={r.active ? "Activa" : "Inactiva"}
          tone={r.active ? TONE_VAR.positive : "var(--kg-neutral-500)"}
        />
      ),
    },
    // La columna de acciones sólo existe si el usuario puede editar — mismo
    // gate que antes, ahora expresado como columna condicional.
    ...(canEdit
      ? [
          {
            key: "actions",
            label: "Acciones",
            align: "right" as const,
            width: "200px",
            render: (r: AlertRuleRow) => (
              <AlertRuleRowActions
                projectId={projectId}
                launchId={launchId}
                ruleId={r.id}
                active={r.active}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <ContextBar
        icon={<IconLaunch size={16} />}
        title="Alertas"
        stats={[
          { l: "Reglas", v: fmtNumber(rules.length) },
          {
            l: "Activas",
            v: fmtNumber(activeRules),
            // Sin reglas activas el launch no dispara ninguna notificación.
            c: activeRules === 0 ? "#FFB800" : undefined,
          },
          { l: "Pausadas", v: fmtNumber(rules.length - activeRules) },
          { l: "Métricas cubiertas", v: fmtNumber(metricsCovered) },
        ]}
      />

      {canEdit && (
        <Panel title="Nueva regla">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="kg-t6" style={{ color: "var(--kg-text-3)", margin: 0 }}>
              Configurá umbrales por lanzamiento. Cuando se cruzan, el equipo
              recibe una notificación deduplicada por día.
            </p>
            <AlertRuleForm projectId={projectId} launchId={launchId} />
          </div>
        </Panel>
      )}

      <Panel
        title="Reglas de alerta"
        pad={false}
        actions={
          <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            {canEdit ? "Podés editarlas" : "Solo lectura"}
          </span>
        }
      >
        <KgDataTable
          columns={columns}
          rows={rules}
          rowKey={(r) => r.id}
          totalCount={rules.length}
          emptyTitle="Sin reglas configuradas"
          emptyHint={
            canEdit
              ? "Creá la primera arriba: elegí métrica, operador y umbral."
              : "Pedile al admin u operador del proyecto que cree alguna."
          }
        />
      </Panel>
    </div>
  );
}
