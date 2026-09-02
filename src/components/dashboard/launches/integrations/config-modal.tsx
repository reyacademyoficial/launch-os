"use client";

import {
  useActionState,
  useEffect,
  useState,
  useTransition,
  type CSSProperties,
} from "react";

import {
  listGhlPipelines,
  saveIntegrationConfig,
  saveLaunchSecret,
  type GhlPipelineItem,
  type SyncActionState,
} from "@/app/(app)/(kg)/proyectos/[projectId]/launches/[launchId]/sync-actions";
import { Drawer } from "@/components/kg/drawer";
import {
  ErrorBanner,
  Field,
  inputStyle,
  primaryBtn,
  secondaryBtn,
  smallBtn,
} from "@/components/kg/form-primitives";
import { StateDot } from "@/components/kg/state-dot";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";
import type { SyncProviderId } from "@/lib/integrations/sync";

/**
 * Modal de configuración por provider. Dos forms independientes:
 *   1) Pegar el token (`saveLaunchSecret`) — copy distinto por provider.
 *   2) Cargar la config (`saveIntegrationConfig`) — campos distintos por
 *      provider: Meta/Google/TikTok piden ad_account_id + campaign_ids; GHL
 *      pide location_id + default_country.
 *
 * El usuario puede guardar token sin tocar config y viceversa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MIGRACIÓN KG — qué cambió y qué NO
 * ─────────────────────────────────────────────────────────────────────────
 * Cambió SOLO el chasis y los estilos: el overlay propio (`fixed inset-0` +
 * header + body scrolleable, con `bg-bg-elevated` / `border-border`) pasó a
 * `Drawer`, y `Button`/`Input`/`Label`/`FieldError` de `components/ui` a
 * `Field` + `inputStyle` + `primaryBtn`/`secondaryBtn`/`smallBtn` +
 * `ErrorBanner`.
 *
 * NO cambió nada de la máquina de estados: los dos `useActionState` siguen
 * viviendo acá arriba (fuera del cuerpo del drawer) para que el resultado de
 * la action sobreviva al cierre, el `useEffect` que auto-cierra cuando ambos
 * pasos están OK es idéntico, y la validación entera sigue del lado del
 * server action.
 *
 * DECISIÓN: los submits NO bajaron al `footer` del Drawer. El footer es un
 * slot único fuera de los `<form>`, y acá hay DOS forms independientes con
 * un submit cada uno ("Guardar token" y "Guardar config"). Meterlos ahí
 * obligaría a colgarlos con el atributo `form=` de un `<form id>` — más
 * frágil que dejar cada botón dentro de su propio form, que además es lo
 * que comunica que son dos pasos separados.
 *
 * DECISIÓN: los `<select>` van nativos con `inputStyle`, NO con
 * `KgFilterSelect`. `KgFilterSelect` navega con `router.push(href)` — es un
 * filtro de URL, no un control de formulario; no emite un valor al FormData.
 * Es el mismo criterio que usa `session-form-drawer.tsx`.
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

  const subtitle =
    provider === "ghl"
      ? "Necesitás el Private Integration Token + el Location ID del subaccount."
      : provider === "sendflow"
        ? "Necesitás la API Key de SendAPI + el ID de cada comunidad (release)."
        : "Necesitás el access token + el ad_account_id + al menos una campaña.";

  const secretLabel =
    provider === "ghl"
      ? "Private Integration Token"
      : provider === "sendflow"
        ? "API Key (SendAPI)"
        : "Access token (System User)";

  const secretPlaceholder = hasSecret
    ? "Dejá vacío para no cambiarlo · pegá uno nuevo para reconectar"
    : provider === "ghl"
      ? "pit-... (pegá el token completo)"
      : provider === "sendflow"
        ? "sf_... (pegá la API Key completa)"
        : "EAAB... (pegá el token completo)";

  const secretHint =
    provider === "ghl"
      ? "Nunca lo vamos a mostrar de nuevo. Si lo perdés, borrá el viejo en GHL y generá uno nuevo desde Settings → Private Integrations."
      : provider === "sendflow"
        ? "Nunca lo vamos a mostrar de nuevo. Si lo perdés, generá una nueva en SendFlow → SendAPI."
        : "Nunca lo vamos a mostrar de nuevo. Si lo perdés, generás uno nuevo desde Meta Business Manager.";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={secondaryBtn}
      >
        {hasSecret ? "Editar conexión" : "Conectar"}
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={`Conectar ${providerLabel}`}
        subtitle={subtitle}
        width={640}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {/* ── Paso 1: token ───────────────────────────────────────────── */}
          <form
            action={secretAction}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/*
              "Ya está guardado" es ESTADO, no una decoración del label: va en
              un StatusPill (dot + texto neutro) en vez del `text-success`
              viejo que pintaba el propio texto.
            */}
            {hasSecret && (
              <StatusPill text="Token guardado" tone={TONE_VAR.positive} />
            )}

            <Field label={secretLabel} htmlFor="secret" hint={secretHint}>
              <input
                id="secret"
                name="secret"
                type="password"
                autoComplete="off"
                placeholder={secretPlaceholder}
                aria-describedby="secret_hint"
                style={inputStyle}
              />
            </Field>

            {secretState && "error" in secretState && (
              <ErrorBanner message={secretState.error} />
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <SubmitBtn pending={secretPending} label="Guardar token" />
            </div>
          </form>

          <div style={{ height: 1, background: "var(--kg-border-subtle)" }} />

          {/* ── Paso 2: config polimórfica por provider ─────────────────── */}
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
            <form
              action={configAction}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <Field
                label="Release IDs"
                htmlFor="release_ids_text"
                required
                hint="Al menos 1. Separados por coma o espacio. El sync suma las métricas de todas las comunidades del lanzamiento."
              >
                <input
                  id="release_ids_text"
                  name="release_ids_text"
                  type="text"
                  autoComplete="off"
                  placeholder="rel_abc123 rel_def456"
                  defaultValue={initialConfig.releaseIds.join(" ")}
                  aria-describedby="release_ids_text_hint"
                  style={inputStyle}
                />
              </Field>

              {configState && "error" in configState && (
                <ErrorBanner message={configState.error} />
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <SubmitBtn pending={configPending} label="Guardar config" />
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
      </Drawer>
    </>
  );
}

/**
 * Submit de un form del drawer. El pending se comunica con un `StateDot` de
 * acento adelante del label — mismo criterio que `sync-button.tsx`: el color
 * semántico vive en el dot, el botón conserva su tono de jerarquía.
 */
function SubmitBtn({
  pending,
  label,
}: {
  readonly pending: boolean;
  readonly label: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="kg-focus"
      style={{
        ...primaryBtn,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        opacity: pending ? 0.5 : 1,
        cursor: pending ? "not-allowed" : "pointer",
      }}
    >
      {pending && <StateDot tone="accent" />}
      {pending ? "Guardando…" : label}
    </button>
  );
}

/**
 * Estilo del bloque-caja que agrupa los sub-campos de una ad account dentro
 * del drawer. No usa `kg-glass`: anidar glass sobre glass (el drawer ya es
 * `kg-glass-3`) apila blurs y el borde interno deja de leerse.
 */
const subCardStyle: CSSProperties = {
  borderRadius: "var(--kg-r-16)",
  border: "1px solid var(--kg-border-subtle)",
  background: "var(--kg-surface-2-solid)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

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
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      {/* pipeline_id siempre presente en el FormData */}
      <input type="hidden" name="pipeline_id" value={selectedPipelineId} />

      <Field
        label="Location ID (Subaccount)"
        htmlFor="location_id"
        hint="El ID del subaccount del cliente (se ve en la URL de GHL después de /location/)."
      >
        <input
          id="location_id"
          name="location_id"
          type="text"
          autoComplete="off"
          placeholder="abc123XYZ456"
          defaultValue={initialLocationId}
          aria-describedby="location_id_hint"
          style={inputStyle}
        />
      </Field>

      <Field
        label="País default del teléfono"
        htmlFor="default_country"
        hint="Usado para normalizar los teléfonos de GHL antes del match con leads."
      >
        <select
          id="default_country"
          name="default_country"
          defaultValue={initialDefaultCountry || "AR"}
          aria-describedby="default_country_hint"
          style={inputStyle}
        >
          <option value="AR">Argentina (+54)</option>
          <option value="UY">Uruguay (+598)</option>
          <option value="CL">Chile (+56)</option>
          <option value="CO">Colombia (+57)</option>
          <option value="MX">México (+52)</option>
          <option value="ES">España (+34)</option>
          <option value="US">Estados Unidos (+1)</option>
        </select>
      </Field>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label
              htmlFor="pipeline_select"
              className="kg-t7"
              style={{ color: "var(--kg-text-3)" }}
            >
              Pipeline de leads
            </label>
            {selectedPipelineId && (
              <StatusPill text="Seleccionada" tone={TONE_VAR.positive} />
            )}
          </div>
          <button
            type="button"
            onClick={handleLoadPipelines}
            disabled={isPending}
            className="kg-focus"
            style={{
              ...smallBtn,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: isPending ? 0.5 : 1,
              cursor: isPending ? "not-allowed" : "pointer",
            }}
          >
            {isPending && <StateDot tone="accent" />}
            {isPending ? "Cargando…" : "Cargar desde GHL"}
          </button>
        </div>

        {pipelinesLoaded && pipelines.length > 0 ? (
          <select
            id="pipeline_select"
            value={selectedPipelineId}
            onChange={(e) => setSelectedPipelineId(e.target.value)}
            aria-label="Pipeline de leads"
            style={inputStyle}
          >
            <option value="">— Sin pipeline —</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : pipelinesLoaded && pipelines.length === 0 ? (
          <p className="kg-t7" style={{ color: "var(--kg-text-3)", margin: 0 }}>
            No se encontraron pipelines en este location.
          </p>
        ) : selectedPipelineId ? (
          <p className="kg-t7" style={{ color: "var(--kg-text-3)", margin: 0 }}>
            Pipeline guardada:{" "}
            <code style={{ color: "var(--kg-text-1)" }}>{selectedPipelineId}</code>.
            Hacé click en &quot;Cargar desde GHL&quot; para ver la lista y
            cambiarla.
          </p>
        ) : (
          <p className="kg-t7" style={{ color: "var(--kg-text-3)", margin: 0 }}>
            Hacé click en &quot;Cargar desde GHL&quot; para elegir la pipeline
            desde donde se cuentan los leads por vendedor. Requiere token +
            Location ID ya guardados.
          </p>
        )}

        {loadError && <ErrorBanner message={loadError} />}
      </div>

      {error && <ErrorBanner message={error} />}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          borderTop: "1px solid var(--kg-border-subtle)",
          paddingTop: 14,
        }}
      >
        <SubmitBtn pending={pending} label="Guardar config" />
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
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <input type="hidden" name="ad_accounts_json" value={serialized} />

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((row, idx) => (
          <div key={idx} style={subCardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
                Cuenta {idx + 1}
              </span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  className="kg-focus"
                  style={{
                    ...smallBtn,
                    borderColor: "#EF4444",
                    color: "#EF4444",
                  }}
                >
                  Quitar
                </button>
              )}
            </div>

            <Field label="Ad Account ID" htmlFor={`ad_account_id_${idx}`}>
              <input
                id={`ad_account_id_${idx}`}
                type="text"
                autoComplete="off"
                placeholder="act_1234567890"
                value={row.adAccountId}
                onChange={(e) => update(idx, { adAccountId: e.target.value })}
                style={inputStyle}
              />
            </Field>

            <Field
              label={`Campaign IDs (${row.campaignIds.length} ${
                row.campaignIds.length === 1 ? "campaña" : "campañas"
              })`}
              htmlFor={`campaign_input_${idx}`}
              hint='Pegá un ID y presioná Enter o "Agregar". También podés pegar varios separados por coma o espacio.'
            >
              {row.campaignIds.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: 8,
                  }}
                >
                  {row.campaignIds.map((id, ci) => (
                    <span
                      key={id}
                      className="kg-num"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        borderRadius: 999,
                        border: "1px solid var(--kg-border-subtle)",
                        background: "var(--kg-surface-2-solid)",
                        padding: "3px 9px",
                        fontSize: 11,
                        color: "var(--kg-text-2)",
                      }}
                    >
                      {id}
                      <button
                        type="button"
                        onClick={() => removeCampaign(idx, ci)}
                        aria-label={`Quitar campaña ${id}`}
                        className="kg-focus"
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          color: "var(--kg-text-3)",
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <input
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
                  aria-describedby={`campaign_input_${idx}_hint`}
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => addCampaign(idx)}
                  className="kg-focus"
                  style={{ ...smallBtn, flexShrink: 0 }}
                >
                  Agregar
                </button>
              </div>
            </Field>
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={addRow}
          className="kg-focus"
          style={secondaryBtn}
        >
          + Agregar otra cuenta
        </button>
      </div>

      <p className="kg-t7" style={{ color: "var(--kg-text-3)", margin: 0 }}>
        Todas las cuentas tienen que estar bajo el mismo Business Manager (un
        solo token las cubre).
      </p>

      {error && <ErrorBanner message={error} />}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          borderTop: "1px solid var(--kg-border-subtle)",
          paddingTop: 14,
        }}
      >
        <SubmitBtn pending={pending} label="Guardar config" />
      </div>
    </form>
  );
}
