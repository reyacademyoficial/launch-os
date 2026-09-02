import "server-only";

import { EmptyState } from "@/components/kg/empty-state";
import { ErrorBanner } from "@/components/kg/form-primitives";
import { Panel } from "@/components/kg/panel";
import { StatRow, type StatRowItem } from "@/components/kg/stat-row";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";
import { getInstructions } from "@/lib/integrations/instructions";
import {
  getLaunchIntegrationStatus,
  listRecentRuns,
} from "@/lib/integrations/runs";
import type { SyncProviderId } from "@/lib/integrations/sync";
import { createServiceClient } from "@/lib/supabase/service";

import { ConfigModal } from "./config-modal";
import { GhlMappingModal } from "./ghl-mapping-modal";
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
 *   - los AVAILABLE tienen id : ConfigurableProvider (backend implementado +
 *     UI de config). `ghl_messages` queda EXCLUIDO acá porque no tiene config
 *     propia ni card propia — es un sub-sync del card de GHL (botón aparte).
 *   - los SOON son placeholders con un label, sin más logic.
 */
type ConfigurableProvider = Exclude<SyncProviderId, "ghl_messages">;

const AVAILABLE_PROVIDERS: ReadonlyArray<{
  id: ConfigurableProvider;
  label: string;
}> = [
  { id: "meta", label: "Meta Ads" },
  { id: "ghl", label: "Go High Level" },
  { id: "sendflow", label: "SendFlow" },
];

const SOON_PROVIDERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "google", label: "Google Ads" },
  { id: "tiktok", label: "TikTok Ads" },
];

interface MetaAdAccountShape {
  ad_account_id?: string;
  campaign_ids?: string[];
}
interface MetaConfigShape {
  // Shape nuevo
  ad_accounts?: MetaAdAccountShape[];
  // Shape legacy (1 cuenta suelta) — toleramos para no romper launches viejos
  ad_account_id?: string;
  campaign_ids?: string[];
}
interface GhlConfigShape {
  location_id?: string;
  default_country?: string;
  pipeline_id?: string;
}
interface SendflowConfigShape {
  release_ids?: string[];
}
interface IntegrationConfigShape {
  meta?: MetaConfigShape;
  ghl?: GhlConfigShape;
  google?: MetaConfigShape;
  tiktok?: MetaConfigShape;
  sendflow?: SendflowConfigShape;
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
    // El `<h2>Integraciones</h2>` del header viejo se borró: el ContextBar de
    // la page ya titula la pestaña y repetirlo dejaba dos títulos idénticos
    // uno encima del otro. Sobrevive la bajada, que sí explica algo.
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className="kg-t6" style={{ color: "var(--kg-text-3)", margin: 0 }}>
        Conectá las APIs de ads para que los datos diarios se carguen solos.
        Cada lanzamiento tiene sus propias credenciales y campañas.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {AVAILABLE_PROVIDERS.map((p) => {
          // Provider available: extraemos los datos de display de forma
          // distinta según el shape de config del provider.
          const hasSecret = secretProviders.has(p.id);
          const status = statusByProvider.get(p.id);
          const instructions = getInstructions(p.id);

          // Meta/Google/TikTok comparten el shape de ad-account + campaigns.
          // GHL usa location_id. SendFlow usa release_ids.
          const display =
            p.id === "ghl"
              ? buildGhlDisplay(config.ghl ?? {})
              : p.id === "sendflow"
                ? buildSendflowDisplay(config.sendflow ?? {})
                : buildAdsDisplay((config[p.id] ?? {}) as MetaConfigShape);

          // Para GHL extra: stats del último sync exitoso (incluye opps).
          const ghlSummary =
            p.id === "ghl" ? readGhlLastSummary(runs) : null;

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

          // Los datos de config del card dejaron de ser un `<div>` por línea
          // con `text-fg-subtle` y pasan a un único `StatRow`: es exactamente
          // la jerarquía-3 del design system (métricas de apoyo, no tarjetas).
          // "Última sync OK" y el resumen de opportunities entran al mismo
          // StatRow porque son del mismo nivel de lectura.
          const statItems: StatRowItem[] = [
            ...display.fields.map((f) => ({ l: f.label, v: f.value })),
          ];
          if (status?.lastSuccessAt) {
            statItems.push({
              l: "Última sync OK",
              v: new Date(status.lastSuccessAt).toLocaleString("es-AR", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            });
          }
          if (ghlSummary) {
            statItems.push({
              l: "Opportunities",
              v: `${ghlSummary.fetched} sincronizadas`,
            });
            if (ghlSummary.wonInWindow > 0) {
              statItems.push({
                l: "Ganadas en la ventana",
                v: `${ghlSummary.wonInWindow} · ${ghlSummary.wonRevenueInWindow.toLocaleString(
                  "es-AR",
                  {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  },
                )}`,
              });
            }
          }

          const badge = statusBadge(status?.lastRunStatus ?? null);
          const totalCampaigns = (display.campaignDetails ?? []).reduce(
            (s, a) => s + a.campaignIds.length,
            0,
          );

          return (
            <Panel
              key={p.id}
              title={p.label}
              // El estado del último run es metadata del provider, no una
              // acción: va en el slot `actions` del Panel como StatusPill
              // (dot de color + texto neutro), reemplazando al badge de fondo
              // tintado que producía efecto semáforo con 3 cards seguidos.
              actions={<StatusPill text={badge.label} tone={badge.tone} />}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                {display.hasConfig ? (
                  <StatRow items={statItems} />
                ) : (
                  <EmptyState
                    title="Sin configurar"
                    hint={display.missingMessage}
                  />
                )}

                {display.campaignDetails &&
                  display.campaignDetails.length > 0 && (
                    // `<details>` nativo: es un server component, no hay
                    // estado que manejar y el colapsado sale gratis.
                    <details>
                      <summary
                        className="kg-t7 kg-focus"
                        style={{
                          cursor: "pointer",
                          userSelect: "none",
                          color: "var(--kg-accent-text)",
                        }}
                      >
                        Ver campañas ({totalCampaigns})
                      </summary>
                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                          paddingLeft: 8,
                        }}
                      >
                        {display.campaignDetails.map((account) => (
                          <div key={account.adAccountId}>
                            <code
                              className="kg-t7"
                              style={{ color: "var(--kg-text-3)" }}
                            >
                              {account.adAccountId}
                            </code>
                            <ul
                              style={{
                                margin: "4px 0 0",
                                paddingLeft: 16,
                                listStyle: "disc",
                              }}
                            >
                              {account.campaignIds.map((id) => (
                                <li key={id}>
                                  <code
                                    className="kg-num"
                                    style={{
                                      fontSize: 11.5,
                                      color: "var(--kg-text-2)",
                                    }}
                                  >
                                    {id}
                                  </code>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                {/*
                  Acciones y ayuda en una sola fila: la ayuda pegada a la
                  izquierda (se lee antes de tocar nada) y los botones a la
                  derecha. En 390px la fila envuelve sola.
                */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div>
                    {instructions && (
                      <InstructionsModal
                        title={instructions.title}
                        markdown={instructions.markdown}
                      />
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                      justifyContent: "flex-end",
                      gap: 8,
                    }}
                  >
                    <ConfigModal
                      projectId={projectId}
                      launchId={launchId}
                      provider={p.id}
                      providerLabel={p.label}
                      hasSecret={hasSecret}
                      initialConfig={display.initialConfig}
                    />
                    {p.id === "ghl" && hasSecret && display.hasConfig && (
                      <GhlMappingModal
                        projectId={projectId}
                        launchId={launchId}
                      />
                    )}
                    <SyncButton
                      projectId={projectId}
                      launchId={launchId}
                      provider={p.id}
                      disabled={disabled}
                      disabledReason={disabledReason}
                    />
                    {p.id === "ghl" && (
                      <GhlMessagesSyncButton
                        projectId={projectId}
                        launchId={launchId}
                        isClosed={isClosed}
                        hasSecret={hasSecret}
                        hasConfig={display.hasConfig}
                        missingMessage={display.missingMessage}
                        messagesStatus={
                          statusByProvider.get("ghl_messages") ?? null
                        }
                      />
                    )}
                  </div>
                </div>

                <RunsHistory runs={runs} filterProvider={p.id} />

                {/*
                  Los dos avisos accionables pasan a `ErrorBanner`: mismo
                  contenido, pero el tono sale de la primitiva en vez de
                  `border-error/40 bg-error/10` (tokens viejos).
                */}
                {status?.lastRunStatus === "token_invalid" && (
                  <ErrorBanner message="El token dejó de funcionar. Generá uno nuevo y reconectá con el botón “Editar conexión”." />
                )}
                {status?.lastRunStatus === "rate_limited" && (
                  <ErrorBanner
                    tone="warning"
                    message="El proveedor nos pidió esperar antes de pedir más datos. Reintentá en unos minutos."
                  />
                )}
              </div>
            </Panel>
          );
        })}

        {SOON_PROVIDERS.map((p) => (
          // Mismo Panel que los providers reales, pero atenuado: el borde
          // punteado del card viejo no existe en el design system, así que el
          // "todavía no" se comunica con opacidad + el pill neutro.
          <Panel
            key={p.id}
            title={p.label}
            style={{ opacity: 0.6 }}
            actions={<StatusPill text="Próximamente" />}
          >
            <p className="kg-t6" style={{ color: "var(--kg-text-3)", margin: 0 }}>
              Integración disponible en una próxima fase.
            </p>
          </Panel>
        ))}
      </div>

      <p className="kg-t7" style={{ color: "var(--kg-text-3)", margin: 0 }}>
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
interface AdAccountEntry {
  adAccountId: string;
  campaignIds: string[];
}

interface ProviderDisplay {
  hasConfig: boolean;
  missingMessage: string;
  fields: ReadonlyArray<{ label: string; value: string; code?: boolean }>;
  /** Lista expandible de campañas por cuenta, solo para providers de ads. */
  campaignDetails?: ReadonlyArray<AdAccountEntry>;
  initialConfig:
    | { kind: "ads"; adAccounts: AdAccountEntry[] }
    | { kind: "ghl"; locationId: string; defaultCountry: string; pipelineId: string }
    | { kind: "sendflow"; releaseIds: string[] };
}

/**
 * Normaliza la config almacenada (que puede venir en shape nuevo o legacy) a
 * una lista plana de entries que el modal y el display consumen igual.
 */
function readAdAccounts(cfg: MetaConfigShape): AdAccountEntry[] {
  if (Array.isArray(cfg.ad_accounts)) {
    const out: AdAccountEntry[] = [];
    for (const item of cfg.ad_accounts) {
      const id = item.ad_account_id ?? "";
      const campaigns = Array.isArray(item.campaign_ids) ? item.campaign_ids : [];
      if (!id || campaigns.length === 0) continue;
      out.push({ adAccountId: id, campaignIds: campaigns });
    }
    return out;
  }
  // Legacy
  const legacyId = cfg.ad_account_id ?? "";
  const legacyCampaigns = cfg.campaign_ids ?? [];
  if (legacyId && legacyCampaigns.length > 0) {
    return [{ adAccountId: legacyId, campaignIds: legacyCampaigns }];
  }
  return [];
}

function buildAdsDisplay(cfg: MetaConfigShape): ProviderDisplay {
  const adAccounts = readAdAccounts(cfg);
  const hasConfig = adAccounts.length > 0;
  const totalCampaigns = adAccounts.reduce((acc, a) => acc + a.campaignIds.length, 0);

  return {
    hasConfig,
    missingMessage: "Falta al menos una cuenta con campañas",
    fields: hasConfig
      ? [
          {
            label: "Cuentas",
            value: `${adAccounts.length}: ${adAccounts.map((a) => a.adAccountId).join(", ")}`,
            code: true,
          },
          {
            label: "Campañas totales",
            value: `${totalCampaigns} en ${adAccounts.length} cuenta${adAccounts.length === 1 ? "" : "s"}`,
          },
        ]
      : [],
    campaignDetails: hasConfig ? adAccounts : undefined,
    initialConfig: { kind: "ads", adAccounts },
  };
}

/**
 * Lee del `error_detail` del último run exitoso de GHL los contadores de
 * opportunities. El sync persiste `{ cause: 'ghl_summary', counts, meta }` —
 * acá extraemos solo los 3 campos que el card muestra. Defensivo: cualquier
 * shape inesperado devuelve null y la línea no se renderiza.
 */
function readGhlLastSummary(
  runs: ReadonlyArray<{ provider: string; status: string | null; errorDetail: unknown }>,
): { fetched: number; wonInWindow: number; wonRevenueInWindow: number } | null {
  const last = runs.find((r) => r.provider === "ghl" && r.status === "success");
  if (!last || !last.errorDetail || typeof last.errorDetail !== "object") {
    return null;
  }
  const detail = last.errorDetail as Record<string, unknown>;
  const counts = detail.counts as Record<string, unknown> | undefined;
  const opps = counts?.opportunities as Record<string, unknown> | undefined;
  const meta = detail.meta as Record<string, unknown> | undefined;
  const oppsMeta = meta?.opportunities as Record<string, unknown> | undefined;

  // Si la corrida es vieja (anterior a este feature), el shape no trae
  // opportunities. Sin datos, no mostramos línea.
  if (!opps && !oppsMeta) return null;

  const fetched = numOr0(opps?.fetched);
  const wonInWindow = numOr0(oppsMeta?.won_in_window);
  const wonRevenueInWindow = numOr0(oppsMeta?.won_revenue_in_window);
  return { fetched, wonInWindow, wonRevenueInWindow };
}

function numOr0(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Botón "Sync mensajes" — sub-sync del card de GHL (Fase B).
 *
 * Pega al mismo PIT + location_id del provider 'ghl' (no necesita config
 * separada). El backend usa provider='ghl_messages' en integration_runs para
 * tener su propia historia, status badge y notificaciones independientes
 * del sync GHL interactivo.
 *
 * Variant secondary para que se note que es secundario al "Sincronizar"
 * principal del card.
 */
function GhlMessagesSyncButton({
  projectId,
  launchId,
  isClosed,
  hasSecret,
  hasConfig,
  missingMessage,
  messagesStatus,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly isClosed: boolean;
  readonly hasSecret: boolean;
  readonly hasConfig: boolean;
  readonly missingMessage: string;
  readonly messagesStatus: {
    lastRunStatus: string | null;
    lastSuccessAt: string | null;
  } | null;
}) {
  const isRunning = messagesStatus?.lastRunStatus === "running";
  const disabled = isClosed || !hasSecret || !hasConfig || isRunning;
  const disabledReason = isClosed
    ? "Lanzamiento cerrado"
    : !hasSecret
      ? "Configurá GHL primero (token)"
      : !hasConfig
        ? missingMessage
        : isRunning
          ? "Sync de mensajes en curso"
          : undefined;

  return (
    <SyncButton
      projectId={projectId}
      launchId={launchId}
      provider="ghl_messages"
      disabled={disabled}
      disabledReason={disabledReason}
      label="Sync mensajes"
      pendingLabel="Sincronizando mensajes…"
      variant="secondary"
    />
  );
}

function buildGhlDisplay(cfg: GhlConfigShape): ProviderDisplay {
  const locationId = cfg.location_id ?? "";
  const defaultCountry = cfg.default_country ?? "AR";
  const pipelineId = cfg.pipeline_id ?? "";
  const hasConfig = locationId.length > 0;

  const fields: ProviderDisplay["fields"] = hasConfig
    ? [
        { label: "Location ID", value: locationId, code: true },
        { label: "País default", value: defaultCountry },
        ...(pipelineId
          ? [{ label: "Pipeline", value: pipelineId, code: true }]
          : [{ label: "Pipeline", value: "Sin configurar" }]),
      ]
    : [];

  return {
    hasConfig,
    missingMessage: "Falta el Location ID",
    fields,
    initialConfig: { kind: "ghl", locationId, defaultCountry, pipelineId },
  };
}

function buildSendflowDisplay(cfg: SendflowConfigShape): ProviderDisplay {
  const releaseIds = Array.isArray(cfg.release_ids)
    ? cfg.release_ids.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
  const hasConfig = releaseIds.length > 0;

  return {
    hasConfig,
    missingMessage: "Falta al menos un Release ID",
    fields: hasConfig
      ? [
          {
            label: "Comunidades",
            value: `${releaseIds.length}: ${releaseIds.join(", ")}`,
            code: true,
          },
        ]
      : [],
    initialConfig: { kind: "sendflow", releaseIds },
  };
}

/**
 * Estado del último run → `{ label, tone }` para el `StatusPill` del Panel.
 *
 * Antes era un `<StatusBadge>` que devolvía un chip con FONDO tintado
 * (`bg-success/15 text-success`…). Con tres cards apilados eso pintaba tres
 * rectángulos de colores distintos y el ojo leía "semáforo" antes que
 * "provider". El design system resuelve esto con el pill sin fondo: el color
 * queda en un dot de 5px y el texto va neutro.
 *
 * Devuelve la CSS var directamente porque es lo que `StatusPill` consume como
 * `tone` — mismo contrato que `launchStatusTone()`.
 */
function statusBadge(status: string | null): {
  readonly label: string;
  readonly tone: string;
} {
  if (!status) {
    return { label: "Sin sincronizar", tone: "var(--kg-neutral-500)" };
  }
  const map: Record<string, { label: string; tone: string }> = {
    running: { label: "Sincronizando", tone: TONE_VAR.accent },
    success: { label: "Conectado", tone: TONE_VAR.positive },
    error: { label: "Error", tone: TONE_VAR.negative },
    token_invalid: { label: "Reconectar", tone: TONE_VAR.negative },
    rate_limited: { label: "Rate limit", tone: TONE_VAR.warning },
    config_missing: { label: "Falta config", tone: TONE_VAR.warning },
    partial: { label: "Parcial", tone: TONE_VAR.warning },
  };
  return map[status] ?? { label: status, tone: "var(--kg-neutral-500)" };
}
