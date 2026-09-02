"use client";

import {
  useActionState,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { LaunchActionState } from "@/app/(app)/(kg)/proyectos/[projectId]/launches/actions";
import {
  ErrorBanner,
  Field,
  inputStyle,
  primaryBtn,
} from "@/components/kg/form-primitives";
import {
  DEFAULT_DURATIONS,
  tryComputeLaunchCalendar,
} from "@/lib/launches/calendar";
import type { LaunchRow } from "@/lib/launches/types";

import { LaunchCalendarTable } from "./launch-calendar-table";

const TYPES = ["En Vivo", "Automatizado", "Replay"] as const;
const STATUSES = ["Activo", "Escalando", "Finalizado", "Evergreen"] as const;
const PLATFORMS = ["Facebook", "Instagram", "Tiktok", "Youtube", "Email"] as const;

type FormState = LaunchActionState;
type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * `inputStyle` de KG da ~38px de alto con su padding 9/12 + fontSize 13, pero
 * los `<select>` nativos calculan su propio alto según la fuente del sistema y
 * en algunos browsers de Android caen por debajo. Fijamos 36 explícito para
 * garantizar el target mínimo de toque en toda la grilla del form.
 */
const controlStyle: CSSProperties = { ...inputStyle, minHeight: 36 };

function dur(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

export function LaunchForm({
  action,
  initial,
  submitLabel,
  onSuccess,
  copyableLaunches,
  recycleTargetOptions,
}: {
  readonly action: FormAction;
  readonly initial?: LaunchRow;
  readonly submitLabel: string;
  /**
   * Llamado cuando la action devuelve `{ ok: true }` (caso update). Lo usa
   * `LaunchFormModal` para cerrarse. En create el flujo es distinto: la
   * action redirige a la URL del nuevo launch y el componente se desmonta,
   * así que onSuccess no se dispara — y eso está bien.
   */
  readonly onSuccess?: () => void;
  /**
   * Lista de launches del mismo proyecto desde los que se pueden copiar
   * conexiones (token + integration_config). Solo se muestra el select en
   * modo create (initial === undefined). Si no se pasa o está vacía, no
   * aparece la opción.
   */
  readonly copyableLaunches?: ReadonlyArray<{ id: string; name: string }>;
  /**
   * Lanzamientos del mismo proyecto válidos como destino de reciclado para
   * un evergreen — todos menos el actual. Se renderizan en el select de
   * `recycle_target_launch_id` cuando el checkbox de evergreen está activo.
   */
  readonly recycleTargetOptions?: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  // Estado controlado para los inputs que alimentan la preview del calendario.
  // Otros inputs siguen como uncontrolled (defaultValue) — no nos importa
  // recomputar UI con cada keystroke fuera de la sección Calendario.
  const [launchDate, setLaunchDate] = useState<string>(initial?.launch_date ?? "");
  const [durCreacion, setDurCreacion] = useState<number>(
    dur(initial?.dur_creacion, DEFAULT_DURATIONS.durCreacion),
  );
  const [durNutricion, setDurNutricion] = useState<number>(
    dur(initial?.dur_nutricion, DEFAULT_DURATIONS.durNutricion),
  );
  const [durCaptacion, setDurCaptacion] = useState<number>(
    dur(initial?.dur_captacion, DEFAULT_DURATIONS.durCaptacion),
  );
  const [durCalentamiento, setDurCalentamiento] = useState<number>(
    dur(initial?.dur_calentamiento, DEFAULT_DURATIONS.durCalentamiento),
  );
  const [durCompra, setDurCompra] = useState<number>(
    dur(initial?.dur_compra, DEFAULT_DURATIONS.durCompra),
  );
  const [durCierre, setDurCierre] = useState<number>(
    dur(initial?.dur_cierre, DEFAULT_DURATIONS.durCierre),
  );

  // Estado controlado para evergreen: el select del target se renderiza solo
  // cuando el flag está prendido. El check del DB exige `is_evergreen=true`
  // cuando `recycle_target_launch_id` está seteado, así que en la action
  // forzamos `target=null` si el flag está apagado — esto es coherente.
  const [isEvergreen, setIsEvergreen] = useState<boolean>(
    initial?.is_evergreen ?? false,
  );

  /*
   * Plataformas: antes eran checkboxes uncontrolled (`defaultChecked`) y el
   * highlight del chip seleccionado lo resolvía Tailwind con
   * `has-[input:checked]:bg-accent/10` sobre tokens VIEJOS. Al pasar a estilos
   * inline con vars `--kg-*` ya no hay forma de reaccionar al `:checked` sin
   * CSS propio, así que el set pasa a estado local.
   *
   * Es estado PRESENTACIONAL, no lógica: los `<input name="platforms" value>`
   * siguen siendo los mismos cinco, con el mismo `name`, y el FormData que
   * llega a la action es idéntico (`getAll("platforms")`). El valor inicial
   * sale del mismo lugar que salía el `defaultChecked`.
   */
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    () => new Set(initial?.platforms ?? []),
  );

  function togglePlatform(p: string) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  const calendar = tryComputeLaunchCalendar({
    launchDate: launchDate || undefined,
    durCreacion,
    durNutricion,
    durCaptacion,
    durCalentamiento,
    durCompra,
    durCierre,
    isEvergreen,
  });

  const showCopyFrom =
    !initial && copyableLaunches !== undefined && copyableLaunches.length > 0;

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 26 }}
    >
      {showCopyFrom && (
        <FormSection title="Copiar conexiones de">
          <Field
            label="Lanzamiento de origen (opcional)"
            htmlFor="copy_from_launch_id"
            hint="Copia el token + ad_account_id + campañas. Editable después desde la sección Integraciones del lanzamiento nuevo."
          >
            <select
              id="copy_from_launch_id"
              name="copy_from_launch_id"
              defaultValue=""
              aria-describedby="copy_from_launch_id_hint"
              style={controlStyle}
            >
              <option value="">— No copiar nada —</option>
              {copyableLaunches!.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>
      )}

      <FormSection title="Datos básicos">
        <FieldsGrid>
          {/* Nombre ocupa el ancho entero: en mobile es la única columna y en
              md+ no queremos que un nombre largo quede en medio input. */}
          <div className="md:col-span-2">
            <Field label="Nombre" htmlFor="name" required>
              <input
                id="name"
                name="name"
                required
                defaultValue={initial?.name ?? ""}
                style={controlStyle}
              />
            </Field>
          </div>
          <Field label="Tipo" htmlFor="type">
            <select
              id="type"
              name="type"
              defaultValue={initial?.type ?? ""}
              style={controlStyle}
            >
              <option value="">—</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="status">
            <select
              id="status"
              name="status"
              defaultValue={initial?.status ?? ""}
              style={controlStyle}
            >
              <option value="">—</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </FieldsGrid>

        {/* Grupo de checkboxes: no hay un solo control al que apuntar con
            `htmlFor`, así que va con label de grupo en vez de <Field>. */}
        <div>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
          >
            Plataformas
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PLATFORMS.map((p) => {
              const checked = selectedPlatforms.has(p);
              return (
                <label
                  key={p}
                  htmlFor={`platform_${p}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 36,
                    padding: "0 12px",
                    borderRadius: "var(--kg-r-8)",
                    border: `1px solid ${
                      checked ? "var(--kg-accent-500)" : "var(--kg-border-subtle)"
                    }`,
                    background: checked
                      ? "var(--kg-accent-halo)"
                      : "var(--kg-surface-2-solid)",
                    color: checked ? "var(--kg-accent-text)" : "var(--kg-text-2)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <input
                    id={`platform_${p}`}
                    type="checkbox"
                    name="platforms"
                    value={p}
                    checked={checked}
                    onChange={() => togglePlatform(p)}
                    style={{ cursor: "pointer", accentColor: "var(--kg-accent-500)" }}
                  />
                  {p}
                </label>
              );
            })}
          </div>
        </div>
      </FormSection>

      <FormSection title="Calendario del lanzamiento">
        <HelpText>
          La fecha del lanzamiento es la fecha de la Clase 1. Las 6 duraciones
          son configurables por lanzamiento — defaults <b>30/15/21/14/5/3</b>{" "}
          días (creación/nutrición/captación/calentamiento/compra/cierre).{" "}
          <CodeChip>date_start</CodeChip> y <CodeChip>date_end</CodeChip> quedan
          derivadas automáticamente (las usa el sync engine).
        </HelpText>
        <FieldsGrid cols={3}>
          <Field label="Fecha de lanzamiento (Clase 1)" htmlFor="launch_date">
            <input
              id="launch_date"
              name="launch_date"
              type="date"
              value={launchDate}
              onChange={(e) => setLaunchDate(e.target.value)}
              style={controlStyle}
            />
          </Field>
          <DurField
            id="dur_creacion"
            label="Días de creación"
            value={durCreacion}
            onChange={setDurCreacion}
          />
          <DurField
            id="dur_nutricion"
            label="Días de nutrición"
            value={durNutricion}
            onChange={setDurNutricion}
          />
          <DurField
            id="dur_captacion"
            label="Días de captación"
            value={durCaptacion}
            onChange={setDurCaptacion}
          />
          <DurField
            id="dur_calentamiento"
            label="Días de calentamiento"
            value={durCalentamiento}
            onChange={setDurCalentamiento}
          />
          <DurField
            id="dur_compra"
            label="Días de compra"
            value={durCompra}
            onChange={setDurCompra}
          />
          <DurField
            id="dur_cierre"
            label="Días de cierre"
            value={durCierre}
            onChange={setDurCierre}
          />
        </FieldsGrid>

        {calendar ? (
          <div
            style={{
              borderRadius: "var(--kg-r-12)",
              border: "1px solid var(--kg-border-subtle)",
              background: "var(--kg-surface-2-solid)",
              padding: 14,
            }}
          >
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)", marginBottom: 10 }}
            >
              Preview en vivo
            </div>
            {/* La tabla tiene más columnas que ancho hay en 390px — scrollea
                dentro de su caja en vez de romper el layout del drawer. */}
            <div style={{ overflowX: "auto" }}>
              <LaunchCalendarTable calendar={calendar} />
            </div>
          </div>
        ) : (
          <EmptyHint text="Elegí la fecha de lanzamiento para ver el calendario calculado." />
        )}
      </FormSection>

      <FormSection title="Evergreen">
        <HelpText>
          Un evergreen es un lanzamiento normal que corre constantemente. Al
          cerrarlo, los leads que <b>no</b> compraron se transfieren al
          lanzamiento destino para que sigan en pipeline.
        </HelpText>
        <label
          htmlFor="is_evergreen"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            minHeight: 36,
            fontSize: 13,
            color: "var(--kg-text-1)",
            cursor: "pointer",
          }}
        >
          <input
            id="is_evergreen"
            type="checkbox"
            name="is_evergreen"
            checked={isEvergreen}
            onChange={(e) => setIsEvergreen(e.target.checked)}
            style={{ cursor: "pointer", accentColor: "var(--kg-accent-500)" }}
          />
          Este lanzamiento es evergreen
        </label>
        {isEvergreen && (
          <div style={{ maxWidth: 420 }}>
            <Field
              label="Lanzamiento destino al cerrar"
              htmlFor="recycle_target_launch_id"
              hint="Sin destino, al cerrar no se reciclan leads y queda un aviso al equipo en la campanita."
            >
              <select
                id="recycle_target_launch_id"
                name="recycle_target_launch_id"
                defaultValue={initial?.recycle_target_launch_id ?? ""}
                aria-describedby="recycle_target_launch_id_hint"
                style={controlStyle}
              >
                <option value="">— Sin destino —</option>
                {(recycleTargetOptions ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </FormSection>

      <FormSection title="Moneda del lanzamiento">
        <HelpText>
          Si este lanzamiento se opera en pesos (cobros contra bancos ARS,
          spend de Meta en ARS), ingresá la tasa <b>ARS por 1 USD</b>. Todos
          los dashboards agregados van a mostrar los montos convertidos a USD
          usando esta tasa. Dejalo vacío si el lanzamiento se opera en USD
          nativo — no se aplica ninguna conversión.
        </HelpText>
        <FieldsGrid>
          <Field
            label="Tasa ARS / USD"
            htmlFor="ars_per_usd"
            hint="Se puede cambiar más adelante — la conversión se aplica al render, los datos crudos en DB no se tocan."
          >
            <input
              id="ars_per_usd"
              name="ars_per_usd"
              type="number"
              step="0.01"
              min="0"
              placeholder="ej. 1200"
              aria-describedby="ars_per_usd_hint"
              className="kg-num"
              defaultValue={
                (initial as unknown as { ars_per_usd?: number | null })
                  ?.ars_per_usd ?? ""
              }
              style={controlStyle}
            />
          </Field>
          <Field
            label="Moneda de campañas publicitarias"
            htmlFor="ads_currency"
            hint="Si elegís ARS y cargaste la tasa ARS/USD, las inversiones de Meta, Google y TikTok se convierten automáticamente a USD en los KPIs."
          >
            <select
              id="ads_currency"
              name="ads_currency"
              aria-describedby="ads_currency_hint"
              defaultValue={
                (initial as unknown as { ads_currency?: string })?.ads_currency ?? "USD"
              }
              style={controlStyle}
            >
              <option value="USD">USD — la cuenta de ads reporta en dólares</option>
              <option value="ARS">ARS — la cuenta de ads reporta en pesos</option>
            </select>
          </Field>
        </FieldsGrid>
      </FormSection>

      <ChannelSection title="Meta Ads" prefix="meta" initial={initial} />
      <ChannelSection title="Google Ads" prefix="google" initial={initial} />
      <ChannelSection title="TikTok Ads" prefix="tiktok" initial={initial} />

      <FormSection title="Webinar / lifecycle">
        <HelpText>
          Asistencia se mide como <b>pico simultáneo</b>. Show Rate usa
          Inscriptos + Asistentes Clase 1; Close Rate hasta el pitch usa
          Asistentes Clase 3. Vacío en alguno → el KPI muestra{" "}
          <CodeChip>—</CodeChip>.
        </HelpText>
        <FieldsGrid>
          <NumberField name="registrados" label="Inscriptos" initial={initial} />
          <NumberField
            name="asistentes"
            label="Asistentes Clase 1 (pico simultáneo)"
            initial={initial}
          />
          <NumberField
            name="hasta_pitch"
            label="Asistentes Clase 3 (pico simultáneo)"
            initial={initial}
          />
          <NumberField
            name="contactos_api"
            label="Contactos via API"
            initial={initial}
          />
        </FieldsGrid>
      </FormSection>

      <FormSection title="Conversión + revenue">
        <HelpText>
          Los valores manuales se <b>suman</b> a lo que viene del kanban
          (ventas en la columna <i>cerrado</i> y sus cobros). Si todo se carga
          en el kanban, dejá estos campos en 0.
        </HelpText>
        <FieldsGrid>
          <NumberField name="ventas_total" label="Ventas totales (manual)" initial={initial} />
          <NumberField name="ventas_mensuales" label="Ventas mensuales" initial={initial} />
          <NumberField name="ventas_anuales" label="Ventas anuales" initial={initial} />
          <NumberField
            name="revenue_estimated_manual"
            label="Revenue estimado manual"
            step="0.01"
            initial={initial}
          />
          <NumberField
            name="revenue_collected_manual"
            label="Revenue cobrado manual"
            step="0.01"
            initial={initial}
          />
          <NumberField
            name="ingresos_whatsapp"
            label="Ingresos via WhatsApp"
            step="0.01"
            initial={initial}
          />
        </FieldsGrid>
      </FormSection>

      {/* El error va arriba del botón y a ancho completo: en 390px el layout
          viejo (error al lado del submit) lo empujaba fuera de la vista. */}
      {state && "error" in state && <ErrorBanner message={state.error} />}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="submit"
          disabled={pending}
          className="kg-focus w-full md:w-auto"
          style={{
            ...primaryBtn,
            minHeight: 40,
            opacity: pending ? 0.7 : 1,
            cursor: pending ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ─── presentational helpers ───────────────────────────────────────────────────

/**
 * Sección del form. NO usa `SectionHeader` de KG a propósito: ese componente
 * es una barra `kg-glass` con ícono + stats pensada para separar bloques de
 * una PÁGINA, y acá hay 9 secciones dentro de un drawer que ya es
 * `kg-glass-3` — glass sobre glass, y ~50px de alto por sección solo en
 * cromo. El separador fino con label `kg-t7` es el idiom que ya usan los
 * drawers de marketing para sub-bloques.
 */
function FormSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3
        className="kg-t7"
        style={{
          margin: 0,
          color: "var(--kg-accent-text)",
          paddingBottom: 6,
          borderBottom: "1px solid var(--kg-border-subtle)",
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Párrafo explicativo bajo el título de sección. */
function HelpText({ children }: { readonly children: ReactNode }) {
  return (
    <p className="kg-t6" style={{ margin: 0, color: "var(--kg-text-3)" }}>
      {children}
    </p>
  );
}

/** Chip monoespaciado para nombres de columna / valores literales. */
function CodeChip({ children }: { readonly children: ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        padding: "1px 5px",
        borderRadius: 4,
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        color: "var(--kg-text-2)",
      }}
    >
      {children}
    </code>
  );
}

/**
 * Grilla de campos. Mobile-first: una sola columna en 390px (el drawer ocupa
 * el 100% del ancho) y recién en `md+` se abre a 2 o 3 columnas. Tailwind sólo
 * para el breakpoint — el resto del estilo es inline.
 */
function FieldsGrid({
  children,
  cols = 2,
}: {
  readonly children: ReactNode;
  readonly cols?: 2 | 3;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-3 ${
        cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2"
      }`}
    >
      {children}
    </div>
  );
}

/** Vacío corto, en línea con el `EmptyHint` de los drawers de marketing. */
function EmptyHint({ text }: { readonly text: string }) {
  return (
    <div
      className="kg-t7"
      style={{
        padding: "12px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px dashed var(--kg-border-subtle)",
        color: "var(--kg-text-3)",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

function DurField({
  id,
  label,
  value,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly onChange: (next: number) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        name={id}
        type="number"
        min="0"
        step="1"
        className="kg-num"
        value={String(value)}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10);
          onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
        }}
        style={controlStyle}
      />
    </Field>
  );
}

function ChannelSection({
  title,
  prefix,
  initial,
}: {
  readonly title: string;
  readonly prefix: "meta" | "google" | "tiktok";
  readonly initial?: LaunchRow;
}) {
  return (
    <FormSection title={title}>
      <FieldsGrid cols={3}>
        <NumberField
          name={`${prefix}_investment`}
          label="Inversión"
          step="0.01"
          initial={initial}
        />
        <NumberField name={`${prefix}_clicks`} label="Clicks" initial={initial} />
        <NumberField name={`${prefix}_leads`} label="Leads" initial={initial} />
      </FieldsGrid>
    </FormSection>
  );
}

function NumberField({
  name,
  label,
  step,
  initial,
}: {
  readonly name: string;
  readonly label: string;
  readonly step?: string;
  readonly initial?: LaunchRow;
}) {
  const raw = initial?.[name as keyof LaunchRow];
  const defaultValue = typeof raw === "number" ? String(raw) : "";
  return (
    <Field label={label} htmlFor={name}>
      <input
        id={name}
        name={name}
        type="number"
        step={step ?? "1"}
        min="0"
        className="kg-num"
        defaultValue={defaultValue}
        placeholder="0"
        style={controlStyle}
      />
    </Field>
  );
}
