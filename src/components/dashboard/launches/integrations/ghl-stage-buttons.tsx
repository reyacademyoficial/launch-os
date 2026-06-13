import "server-only";

import type {
  IntegrationStatusForProvider,
  RunStage,
} from "@/lib/integrations/runs";

import { SyncButton } from "./sync-button";

/**
 * 3 botones para GHL: uno por stage. Cada uno corre su propia corrida del
 * sync, lo que mantiene cada invocación corta (<60s típico) y dentro del
 * timeout del Server Action. Cada uno muestra "Última OK" de SU stage para
 * que el usuario entienda qué está al día y qué no.
 *
 * Disable individual:
 *   - launch cerrado / sin token / sin config → todos disabled (común al provider).
 *   - stage con run propio en `running` (no expirado) → solo ese disabled.
 */

const STAGE_DEFINITIONS: ReadonlyArray<{ id: RunStage; label: string }> = [
  { id: "appointments", label: "Appointments" },
  { id: "conversations", label: "Conversaciones" },
  { id: "contacts", label: "Contactos" },
];

export function GhlStageButtons({
  projectId,
  launchId,
  status,
  isClosed,
  hasSecret,
  hasConfig,
  missingMessage,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly status: IntegrationStatusForProvider | null;
  readonly isClosed: boolean;
  readonly hasSecret: boolean;
  readonly hasConfig: boolean;
  readonly missingMessage: string;
}) {
  const baseDisabledReason = isClosed
    ? "Lanzamiento cerrado"
    : !hasSecret
      ? "Falta el token"
      : !hasConfig
        ? missingMessage
        : null;

  return (
    <div className="flex flex-col items-end gap-2">
      {STAGE_DEFINITIONS.map((s) => {
        const stageStatus = status?.stages[s.id] ?? null;
        const isStageRunning = stageStatus?.lastRunStatus === "running";

        const disabled = baseDisabledReason !== null || isStageRunning;
        const disabledReason =
          baseDisabledReason ?? (isStageRunning ? "Esta etapa está corriendo" : undefined);

        return (
          <div key={s.id} className="flex items-center gap-3">
            <span className="text-[11px] text-fg-subtle">
              {s.label}
              {stageStatus?.lastSuccessAt && (
                <>
                  {" · OK "}
                  <span className="text-fg">
                    {new Date(stageStatus.lastSuccessAt).toLocaleString("es-AR", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              )}
            </span>
            <SyncButton
              projectId={projectId}
              launchId={launchId}
              provider="ghl"
              stage={s.id}
              label={s.label}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          </div>
        );
      })}
    </div>
  );
}
