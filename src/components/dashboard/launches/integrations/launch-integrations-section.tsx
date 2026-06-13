import "server-only";

import { getInstructions } from "@/lib/integrations/instructions";
import {
  getLaunchIntegrationStatus,
  listRecentRuns,
} from "@/lib/integrations/runs";
import type { SyncProviderId } from "@/lib/integrations/sync";
import { createServiceClient } from "@/lib/supabase/service";

import { ConfigModal } from "./config-modal";
import { GhlStageButtons } from "./ghl-stage-buttons";
import { InstructionsModal } from "./instructions-modal";
import { RunsHistory } from "./runs-history";
import { SyncButton } from "./sync-button";

/**
 * Sección "Integraciones" del detalle del lanzamiento. Server component que
 * arma TODO el estado leyendo:
 *   - `launches.integration_config` (vía service-role, no expuesta a UI ajena)
 *   - existencia de `launch_secrets` por provider (vía service-role, no expone
 *     el valor; solo hasSecret: boolean)
 *   - últimos `integration_runs` (vía RLS — los miembros del proyecto los ven)
 *
 * Solo se renderiza para admin / operador / superadmin — la gate la hace
 * el page parent. Esta función no re-verifica permisos: confía en el caller.
 */

/**
 * Catálogo de providers separado en dos arrays para que TS narrowee bien:
 *   - los AVAILABLE tienen id : SyncProviderId (backend implementado).
 *   - los SOON son placeholders con un label, sin más logic.
 */
const AVAILABLE_PROVIDERS: ReadonlyArray<{
  id: SyncProviderId;
  label: string;
}> = [
  { id: "meta", label: "Meta Ads" },
  { id: "ghl", label: "Go High Level" },
];

const SOON_PROVIDERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "google", label: "Google Ads" },
  { id: "tiktok", label: "TikTok Ads" },
];

interface MetaConfigShape {
  ad_account_id?: string;
  campaign_ids?: string[];
}
interface GhlConfigShape {
  location_id?: string;
  default_country?: string;
}
interface IntegrationConfigShape {
  meta?: MetaConfigShape;
  ghl?: GhlConfigShape;
  google?: MetaConfigShape;
  tiktok?: MetaConfigShape;
}

export async function LaunchIntegrationsSection({
  projectId,
  launchId,
  isClosed,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly isClosed: boolean;
}) {
  const service = createServiceClient();

  // Cargar config + flags de secret en paralelo
  const [configRes, secretsRes, statusByProvider, runs] = await Promise.all([
    service
      .from("launches")
      .select("integration_config")
      .eq("id", launchId)
      .maybeSingle(),
    service
      .from("launch_secrets")
      .select("provider")
      .eq("launch_id", launchId),
    getLaunchIntegrationStatus(launchId),
    listRecentRuns(launchId, 10),
  ]);

  const config = ((configRes.data as { integration_config: unknown } | null)
    ?.integration_config ?? {}) as IntegrationConfigShape;
  const secretProviders = new Set(
    ((secretsRes.data ?? []) as Array<{ provider: string }>).map(
      (r) => r.provider,
    ),
  );

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-base font-semibold text-fg">Integraciones</h2>
        <p className="text-xs text-fg-subtle">
          Conectá las APIs de ads para que los datos diarios se carguen solos.
          Cada lanzamiento tiene sus propias credenciales y campañas.
        </p>
      </header>

      <div className="space-y-3">
        {AVAILABLE_PROVIDERS.map((p) => {
          // Provider available: extraemos los datos de display de forma
          // distinta según el shape de config del provider.
          const hasSecret = secretProviders.has(p.id);
          const status = statusByProvider.get(p.id);
          const instructions = getInstructions(p.id);

          // Meta/Google/TikTok comparten el shape de ad-account + campaigns.
          // GHL usa location_id (sin campañas).
          const display =
            p.id === "ghl"
              ? buildGhlDisplay(config.ghl ?? {})
              : buildAdsDisplay(config[p.id] ?? {});

          const disabled =
            isClosed || !hasSecret || !display.hasConfig || status?.lastRunStatus === "running";
          const disabledReason = isClosed
            ? "Lanzamiento cerrado"
            : !hasSecret
              ? "Falta el token"
              : !display.hasConfig
                ? display.missingMessage
                : status?.lastRunStatus === "running"
                  ? "Hay una sincronización en curso"
                  : undefined;

          return (
            <article
              key={p.id}
              className="rounded-md border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-fg">{p.label}</h3>
                    <StatusBadge status={status?.lastRunStatus ?? null} />
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs text-fg-subtle">
                    {display.hasConfig ? (
                      display.fields.map((f) => (
                        <div key={f.label}>
                          <span className="text-fg-muted">{f.label}:</span>{" "}
                          {f.code ? (
                            <code className="text-fg">{f.value}</code>
                          ) : (
                            <span className="text-fg">{f.value}</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <div>Sin configurar</div>
                    )}
                    {status?.lastSuccessAt && (
                      <div>
                        Última sync OK:{" "}
                        <span className="text-fg">
                          {new Date(status.lastSuccessAt).toLocaleString("es-AR", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                  {instructions && (
                    <div className="mt-2">
                      <InstructionsModal
                        title={instructions.title}
                        markdown={instructions.markdown}
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2">
                  <ConfigModal
                    projectId={projectId}
                    launchId={launchId}
                    provider={p.id}
                    providerLabel={p.label}
                    hasSecret={hasSecret}
                    initialConfig={display.initialConfig}
                  />
                  {p.id === "ghl" ? (
                    <GhlStageButtons
                      projectId={projectId}
                      launchId={launchId}
                      status={status ?? null}
                      isClosed={isClosed}
                      hasSecret={hasSecret}
                      hasConfig={display.hasConfig}
                      missingMessage={display.missingMessage}
                    />
                  ) : (
                    <SyncButton
                      projectId={projectId}
                      launchId={launchId}
                      provider={p.id}
                      disabled={disabled}
                      disabledReason={disabledReason}
                    />
                  )}
                </div>
              </div>

              <div className="mt-3">
                <RunsHistory runs={runs} filterProvider={p.id} />
              </div>

              {status?.lastRunStatus === "token_invalid" && (
                <div className="mt-3 rounded-md border border-error/40 bg-error/10 p-3 text-xs text-error">
                  El token dejó de funcionar. Generá uno nuevo y reconectá con
                  el botón <strong>Editar conexión</strong>.
                </div>
              )}
              {status?.lastRunStatus === "rate_limited" && (
                <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                  El proveedor nos pidió esperar antes de pedir más datos. Reintentá en unos minutos.
                </div>
              )}
            </article>
          );
        })}

        {SOON_PROVIDERS.map((p) => (
          <article
            key={p.id}
            className="rounded-md border border-dashed border-border bg-surface/40 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-fg-muted">
                    {p.label}
                  </h3>
                  <span className="rounded bg-fg-subtle/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
                    Próximamente
                  </span>
                </div>
                <p className="mt-1 text-xs text-fg-subtle">
                  Integración disponible en una próxima fase.
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <p className="text-xs text-fg-subtle">
        Nota: cuando el sync escribe nuevos datos, los KPIs y el gráfico se
        actualizan automáticamente — no hace falta recargar.
      </p>
    </section>
  );
}

// ─── Display por provider ──────────────────────────────────────────────────

/**
 * Shape común que el card y el modal consumen. `initialConfig` se pasa al
 * ConfigModal para que sepa qué campos prellenar (es polimórfica por provider).
 */
interface ProviderDisplay {
  hasConfig: boolean;
  missingMessage: string;
  fields: ReadonlyArray<{ label: string; value: string; code?: boolean }>;
  initialConfig:
    | { kind: "ads"; adAccountId: string; campaignIds: string[] }
    | { kind: "ghl"; locationId: string; defaultCountry: string };
}

function buildAdsDisplay(cfg: MetaConfigShape): ProviderDisplay {
  const adAccount = cfg.ad_account_id ?? "";
  const campaigns = cfg.campaign_ids ?? [];
  const hasConfig =
    adAccount.length > 0 && Array.isArray(campaigns) && campaigns.length > 0;

  return {
    hasConfig,
    missingMessage: "Falta ad_account_id o campañas",
    fields: hasConfig
      ? [
          { label: "Ad account", value: adAccount, code: true },
          {
            label: "Campañas",
            value: `${campaigns.length} configurada${campaigns.length === 1 ? "" : "s"}`,
          },
        ]
      : [],
    initialConfig: { kind: "ads", adAccountId: adAccount, campaignIds: campaigns },
  };
}

function buildGhlDisplay(cfg: GhlConfigShape): ProviderDisplay {
  const locationId = cfg.location_id ?? "";
  const defaultCountry = cfg.default_country ?? "AR";
  const hasConfig = locationId.length > 0;

  return {
    hasConfig,
    missingMessage: "Falta el Location ID",
    fields: hasConfig
      ? [
          { label: "Location ID", value: locationId, code: true },
          { label: "País default", value: defaultCountry },
        ]
      : [],
    initialConfig: { kind: "ghl", locationId, defaultCountry },
  };
}

function StatusBadge({ status }: { readonly status: string | null }) {
  if (!status) {
    return (
      <span className="rounded bg-fg-subtle/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
        Sin sincronizar
      </span>
    );
  }
  const map: Record<string, { label: string; classes: string }> = {
    running: {
      label: "Sincronizando",
      classes: "bg-accent/15 text-accent",
    },
    success: {
      label: "Conectado",
      classes: "bg-success/15 text-success",
    },
    error: {
      label: "Error",
      classes: "bg-error/15 text-error",
    },
    token_invalid: {
      label: "Reconectar",
      classes: "bg-error/15 text-error",
    },
    rate_limited: {
      label: "Rate limit",
      classes: "bg-warning/15 text-warning",
    },
    config_missing: {
      label: "Falta config",
      classes: "bg-warning/15 text-warning",
    },
    partial: {
      label: "Parcial",
      classes: "bg-warning/15 text-warning",
    },
  };
  const cfg = map[status] ?? { label: status, classes: "bg-surface text-fg-muted" };
  return (
    <span
      className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${cfg.classes}`}
    >
      {cfg.label}
    </span>
  );
}
