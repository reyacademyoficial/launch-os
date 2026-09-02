"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import {
  listGhlPipelines,
  saveIntegrationConfig,
  saveLaunchSecret,
  type GhlPipelineItem,
  type SyncActionState,
} from "@/app/(app)/(kg)/proyectos/[projectId]/launches/[launchId]/sync-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SyncProviderId } from "@/lib/integrations/sync";

/**
 * Modal de configuración por provider. Dos forms independientes:
 *   1) Pegar el token (`saveLaunchSecret`) — copy distinto por provider.
 *   2) Cargar la config (`saveIntegrationConfig`) — campos distintos por
 *      provider: Meta/Google/TikTok piden ad_account_id + campaign_ids; GHL
 *      pide location_id + default_country.
 *
 * El usuario puede guardar token sin tocar config y viceversa.
 */
export interface InitialAdAccountEntry {
  adAccountId: string;
  campaignIds: readonly string[];
}

export type InitialConfig =
  | { kind: "ads"; adAccounts: ReadonlyArray<InitialAdAccountEntry> }
  | { kind: "ghl"; locationId: string; defaultCountry: string; pipelineId: string }
  | { kind: "sendflow"; releaseIds: ReadonlyArray<string> };

export function ConfigModal({
  projectId,
  launchId,
  provider,
  providerLabel,
  hasSecret,
  initialConfig,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly provider: SyncProviderId;
  readonly providerLabel: string;
  readonly hasSecret: boolean;
  readonly initialConfig: InitialConfig;
}) {
  const [open, setOpen] = useState(false);

  const boundConfig = saveIntegrationConfig.bind(null, projectId, launchId, provider);
  const [configState, configAction, configPending] = useActionState<
    SyncActionState,
    FormData
  >(boundConfig, null);

  const boundSecret = saveLaunchSecret.bind(null, projectId, launchId, provider);
  const [secretState, secretAction, secretPending] = useActionState<
    SyncActionState,
    FormData
  >(boundSecret, null);

  // Cerrar modal solo cuando AMBOS pasos saliero ok al menos una vez. En la
  // práctica el usuario tipea token, guarda, después config, guarda, listo.
  const configOk = configState && "ok" in configState && configState.ok;
  const secretOk = secretState && "ok" in secretState && secretState.ok;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (configOk && (secretOk || hasSecret)) setOpen(false);
  }, [configOk, secretOk, hasSecret]);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        className="!px-3 !py-1.5 !text-xs"
      >
        {hasSecret ? "Editar conexión" : "Conectar"}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="config-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <h3
                  id="config-modal-title"
                  className="text-lg font-bold text-fg"
                >
                  Conectar {providerLabel}
                </h3>
                <p className="mt-1 text-xs text-fg-subtle">
                  {provider === "ghl"
                    ? "Necesitás el Private Integration Token + el Location ID del subaccount."
                    : provider === "sendflow"
                      ? "Necesitás la API Key de SendAPI + el ID de cada comunidad (release)."
                      : "Necesitás el access token + el ad_account_id + al menos una campaña."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              {/* Paso 1: token */}
              <form action={secretAction} className="space-y-3">
                <div>
                  <Label htmlFor="secret">
                    {provider === "ghl"
                      ? "Private Integration Token"
                      : provider === "sendflow"
                        ? "API Key (SendAPI)"
                        : "Access token (System User)"}{" "}
                    {hasSecret && (
                      <span className="ml-2 text-xs text-success">· guardado</span>
                    )}
                  </Label>
                  <Input
                    id="secret"
                    name="secret"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      hasSecret
                        ? "Dejá vacío para no cambiarlo · pegá uno nuevo para reconectar"
                        : provider === "ghl"
                          ? "pit-... (pegá el token completo)"
                          : provider === "sendflow"
                            ? "sf_... (pegá la API Key completa)"
                            : "EAAB... (pegá el token completo)"
                    }
                  />
                  <p className="mt-1 text-xs text-fg-subtle">
                    Nunca lo vamos a mostrar de nuevo. Si lo perdés,{" "}
                    {provider === "ghl"
                      ? "borrá el viejo en GHL y generá uno nuevo desde Settings → Private Integrations."
                      : provider === "sendflow"
                        ? "generá una nueva en SendFlow → SendAPI."
                        : "generás uno nuevo desde Meta Business Manager."}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3">
                  {secretState && "error" in secretState && (
                    <FieldError>{secretState.error}</FieldError>
                  )}
                  <Button type="submit" disabled={secretPending}>
                    {secretPending ? "Guardando…" : "Guardar token"}
                  </Button>
                </div>
              </form>

              <div className="h-px bg-border" />

              {/* Paso 2: config polimórfica por provider */}
              {initialConfig.kind === "ghl" ? (
                <GhlConfigForm
                  projectId={projectId}
                  launchId={launchId}
                  formAction={configAction}
                  pending={configPending}
                  error={configState && "error" in configState ? configState.error : null}
                  initialLocationId={initialConfig.locationId}
                  initialDefaultCountry={initialConfig.defaultCountry}
                  initialPipelineId={initialConfig.pipelineId}
                />
              ) : initialConfig.kind === "sendflow" ? (
                <form action={configAction} className="space-y-3">
                  <div>
                    <Label htmlFor="release_ids_text">
                      Release IDs{" "}
                      <span className="text-xs text-fg-subtle">(al menos 1)</span>
                    </Label>
                    <Input
                      id="release_ids_text"
                      name="release_ids_text"
                      type="text"
                      autoComplete="off"
                      placeholder="rel_abc123 rel_def456"
                      defaultValue={initialConfig.releaseIds.join(" ")}
                    />
                    <p className="mt-1 text-xs text-fg-subtle">
                      Separados por coma o espacio. El sync suma las métricas de todas las
                      comunidades del lanzamiento.
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    {configState && "error" in configState && (
                      <FieldError>{configState.error}</FieldError>
                    )}
                    <Button type="submit" disabled={configPending}>
                      {configPending ? "Guardando…" : "Guardar config"}
                    </Button>
                  </div>
                </form>
              ) : (
                <AdsMultiAccountForm
                  formAction={configAction}
                  pending={configPending}
                  error={
                    configState && "error" in configState ? configState.error : null
                  }
                  initialAccounts={initialConfig.adAccounts}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Form de config GHL. Además de location_id + default_country expone un
 * selector de pipeline que carga los pipelines disponibles desde GHL con un
 * click ("Cargar pipelines") y los muestra en un select. El pipeline elegido
 * se envía al server action como `pipeline_id`.
 */
function GhlConfigForm({
  projectId,
  launchId,
  formAction,
  pending,
  error,
  initialLocationId,
  initialDefaultCountry,
  initialPipelineId,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly formAction: (formData: FormData) => void;
  readonly pending: boolean;
  readonly error: string | null;
  readonly initialLocationId: string;
  readonly initialDefaultCountry: string;
  readonly initialPipelineId: string;
}) {
  const [pipelines, setPipelines] = useState<GhlPipelineItem[]>([]);
  const [pipelinesLoaded, setPipelinesLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState(initialPipelineId);
  const [isPending, startTransition] = useTransition();

  function handleLoadPipelines() {
    setLoadError(null);
    startTransition(async () => {
      const res = await listGhlPipelines(projectId, launchId);
      if (res.ok) {
        setPipelines(res.pipelines);
        setPipelinesLoaded(true);
        // Si la pipeline actual ya está en la lista, la pre-seleccionamos.
        if (selectedPipelineId && res.pipelines.some((p) => p.id === selectedPipelineId)) {
          // ya está seleccionada, no hace falta cambiar
        } else if (res.pipelines.length > 0 && !selectedPipelineId) {
          setSelectedPipelineId(res.pipelines[0]!.id);
        }
      } else {
        setLoadError(res.error);
      }
    });
  }

  return (
    <form action={formAction} className="space-y-3">
      {/* pipeline_id siempre presente en el FormData */}
      <input type="hidden" name="pipeline_id" value={selectedPipelineId} />

      <div>
        <Label htmlFor="location_id">Location ID (Subaccount)</Label>
        <Input
          id="location_id"
          name="location_id"
          type="text"
          autoComplete="off"
          placeholder="abc123XYZ456"
          defaultValue={initialLocationId}
        />
        <p className="mt-1 text-xs text-fg-subtle">
          El ID del subaccount del cliente (se ve en la URL de GHL después de{" "}
          <code className="text-fg">/location/</code>).
        </p>
      </div>

      <div>
        <Label htmlFor="default_country">País default del teléfono</Label>
        <select
          id="default_country"
          name="default_country"
          defaultValue={initialDefaultCountry || "AR"}
          className="mt-1 w-full rounded-md border border-border bg-bg-elevated p-2 text-sm text-fg"
        >
          <option value="AR">Argentina (+54)</option>
          <option value="UY">Uruguay (+598)</option>
          <option value="CL">Chile (+56)</option>
          <option value="CO">Colombia (+57)</option>
          <option value="MX">México (+52)</option>
          <option value="ES">España (+34)</option>
          <option value="US">Estados Unidos (+1)</option>
        </select>
        <p className="mt-1 text-xs text-fg-subtle">
          Usado para normalizar los teléfonos de GHL antes del match con leads.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <Label>
            Pipeline de leads{" "}
            {selectedPipelineId && (
              <span className="ml-1 text-xs text-success">· seleccionada</span>
            )}
          </Label>
          <button
            type="button"
            onClick={handleLoadPipelines}
            disabled={isPending}
            className="text-xs text-accent hover:underline disabled:opacity-50"
          >
            {isPending ? "Cargando…" : "Cargar desde GHL"}
          </button>
        </div>

        {pipelinesLoaded && pipelines.length > 0 ? (
          <select
            className="mt-1 w-full rounded-md border border-border bg-bg-elevated p-2 text-sm text-fg"
            value={selectedPipelineId}
            onChange={(e) => setSelectedPipelineId(e.target.value)}
          >
            <option value="">— Sin pipeline —</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : pipelinesLoaded && pipelines.length === 0 ? (
          <p className="mt-1 text-xs text-fg-subtle">
            No se encontraron pipelines en este location.
          </p>
        ) : selectedPipelineId ? (
          <p className="mt-1 text-xs text-fg-subtle">
            Pipeline guardada:{" "}
            <code className="text-fg">{selectedPipelineId}</code>. Hacé click en
            "Cargar desde GHL" para ver la lista y cambiarla.
          </p>
        ) : (
          <p className="mt-1 text-xs text-fg-subtle">
            Hacé click en "Cargar desde GHL" para elegir la pipeline desde donde
            se cuentan los leads por vendedor. Requiere token + Location ID ya
            guardados.
          </p>
        )}

        {loadError && (
          <p className="mt-1 text-xs text-error">{loadError}</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border pt-3">
        {error && <FieldError>{error}</FieldError>}
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar config"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Form de Meta/Google/TikTok con UI dinámica para múltiples ad accounts. El
 * estado se serializa a un hidden input `ad_accounts_json` que el server action
 * parsea y valida. Cada fila tiene su account_id + lista de campaign IDs que
 * se cargan de a uno (con soporte para pegar varios separados por coma/espacio).
 */
function AdsMultiAccountForm({
  formAction,
  pending,
  error,
  initialAccounts,
}: {
  readonly formAction: (formData: FormData) => void;
  readonly pending: boolean;
  readonly error: string | null;
  readonly initialAccounts: ReadonlyArray<InitialAdAccountEntry>;
}) {
  interface Row {
    adAccountId: string;
    campaignIds: string[];
    campaignInput: string;
  }

  const [rows, setRows] = useState<Row[]>(() => {
    if (initialAccounts.length === 0) {
      return [{ adAccountId: "", campaignIds: [], campaignInput: "" }];
    }
    return initialAccounts.map((a) => ({
      adAccountId: a.adAccountId,
      campaignIds: [...a.campaignIds],
      campaignInput: "",
    }));
  });

  function update(idx: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    );
  }
  function addRow() {
    setRows((prev) => [...prev, { adAccountId: "", campaignIds: [], campaignInput: "" }]);
  }
  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function addCampaign(idx: number) {
    const raw = (rows[idx]?.campaignInput ?? "").trim();
    if (!raw) return;
    const newIds = raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const existing = new Set(row.campaignIds);
        const toAdd = newIds.filter((id) => !existing.has(id));
        return { ...row, campaignIds: [...row.campaignIds, ...toAdd], campaignInput: "" };
      }),
    );
  }

  function removeCampaign(rowIdx: number, campaignIdx: number) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== rowIdx) return row;
        return { ...row, campaignIds: row.campaignIds.filter((_, ci) => ci !== campaignIdx) };
      }),
    );
  }

  const serialized = JSON.stringify(
    rows
      .filter((r) => r.adAccountId.trim().length > 0)
      .map((r) => ({
        ad_account_id: r.adAccountId.trim(),
        campaign_ids: r.campaignIds,
      })),
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="ad_accounts_json" value={serialized} />

      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className="rounded-md border border-border bg-surface/40 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-fg-subtle">
                Cuenta {idx + 1}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  className="text-xs text-error hover:underline"
                >
                  Quitar
                </button>
              )}
            </div>

            <div>
              <Label htmlFor={`ad_account_id_${idx}`}>Ad Account ID</Label>
              <Input
                id={`ad_account_id_${idx}`}
                type="text"
                autoComplete="off"
                placeholder="act_1234567890"
                value={row.adAccountId}
                onChange={(e) => update(idx, { adAccountId: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor={`campaign_input_${idx}`}>
                Campaign IDs{" "}
                <span className="text-xs text-fg-subtle">
                  ({row.campaignIds.length}{" "}
                  {row.campaignIds.length === 1 ? "campaña" : "campañas"})
                </span>
              </Label>

              {row.campaignIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 mb-2">
                  {row.campaignIds.map((id, ci) => (
                    <span
                      key={id}
                      className="flex items-center gap-1 rounded border border-border bg-surface px-2 py-0.5 font-mono text-xs text-fg"
                    >
                      {id}
                      <button
                        type="button"
                        onClick={() => removeCampaign(idx, ci)}
                        aria-label={`Quitar campaña ${id}`}
                        className="ml-0.5 text-fg-subtle hover:text-error"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  id={`campaign_input_${idx}`}
                  type="text"
                  autoComplete="off"
                  placeholder="120203456789"
                  value={row.campaignInput}
                  onChange={(e) => update(idx, { campaignInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCampaign(idx);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => addCampaign(idx)}
                  className="!px-3 !py-1.5 !text-xs shrink-0"
                >
                  Agregar
                </Button>
              </div>
              <p className="mt-1 text-xs text-fg-subtle">
                Pegá un ID y presioná Enter o "Agregar". También podés pegar varios separados por coma o espacio.
              </p>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        onClick={addRow}
        className="!px-3 !py-1.5 !text-xs"
      >
        + Agregar otra cuenta
      </Button>

      <p className="text-xs text-fg-subtle">
        Todas las cuentas tienen que estar bajo el mismo Business Manager (un solo
        token las cubre).
      </p>

      <div className="flex items-center justify-end gap-3 border-t border-border pt-3">
        {error && <FieldError>{error}</FieldError>}
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar config"}
        </Button>
      </div>
    </form>
  );
}
