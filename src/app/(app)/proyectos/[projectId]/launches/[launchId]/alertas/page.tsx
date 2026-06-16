import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { listAlertRulesForLaunch } from "@/lib/alerts/list";
import {
  ALERT_METRIC_LABELS,
  type AlertMetric,
} from "@/lib/alerts/types";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";

import { AlertRuleForm } from "./rule-form";
import { AlertRuleRowActions } from "./row-actions";

export const metadata: Metadata = { title: "Alertas · Lanzamiento" };

/**
 * Tab "Alertas" del detalle del launch. Tabla de reglas + form de creación.
 *
 * Quién puede tocar:
 *   - SELECT: cualquier miembro del proyecto (RLS por has_project_access).
 *     Analista y cliente (en el shell del equipo) ven la lista pero no
 *     pueden crear/editar/borrar — el form se oculta y los row actions
 *     también.
 *   - I/U/D: admin / operador / superadmin (can_edit_launches_in).
 *
 * Las reglas evalúan post-sync OK y post-daily manual. La evaluación es
 * idempotente por (launch, rule, día UTC) — disparar el mismo día no
 * duplica la notif.
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

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <header>
          <h2 className="text-base font-semibold text-fg">Reglas de alerta</h2>
          <p className="text-xs text-fg-subtle">
            Configurá umbrales por lanzamiento. Cuando se cruzan, el equipo
            recibe una notificación deduplicada por día.
          </p>
        </header>
      </section>

      {canEdit && <AlertRuleForm projectId={projectId} launchId={launchId} />}

      <section className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Sin reglas configuradas todavía
            {canEdit ? "." : ". Pedile al admin/operador que cree alguna."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Métrica
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Condición
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Estado
                  </th>
                  {canEdit && (
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Acciones
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-border transition-colors hover:bg-bg-elevated"
                  >
                    <td className="px-4 py-3 font-medium text-fg">
                      {ALERT_METRIC_LABELS[r.metric as AlertMetric]}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {r.metric === "sin_leads"
                        ? `≥ ${r.threshold} días`
                        : `${r.operator} ${r.threshold}`}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={r.active ? "success" : "neutral"}>
                        {r.active ? "Activa" : "Inactiva"}
                      </Badge>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <AlertRuleRowActions
                          projectId={projectId}
                          launchId={launchId}
                          ruleId={r.id}
                          active={r.active}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
