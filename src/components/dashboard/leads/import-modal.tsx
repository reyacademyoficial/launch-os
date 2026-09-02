"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";

import {
  confirmImport,
  previewImport,
  validateImport,
  type ConfirmResult,
  type ImportRowError,
  type PreviewResult,
  type ValidateResult,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/import-actions";
import { KgDataTable } from "@/components/kg/data-table";
import { Drawer } from "@/components/kg/drawer";
import {
  ErrorBanner,
  Field,
  inputStyle,
  primaryBtn,
  secondaryBtn,
} from "@/components/kg/form-primitives";
import { StateDot } from "@/components/kg/state-dot";
import type { KgTone } from "@/components/kg/tone";
import { IMPORT_FIELDS, type ImportMapping } from "@/lib/leads/import-config";

/**
 * Drawer de import xlsx (reemplaza la página dedicada).
 *
 * 4 pasos:
 *   1. Upload: elegir el .xlsx. Antes hay un link de descarga a la plantilla
 *      vacía con headers + ejemplo. (El export de leads actuales vive afuera
 *      de este drawer, en el header de /leads — usa `<ExportLeadsButton>` y
 *      respeta los filtros activos.)
 *   2. Mapear columnas + país + lanzamiento. Click "Validar archivo" llama
 *      a `validateImport` que parsea todo sin insertar y devuelve cuántas
 *      filas son válidas / con error / duplicadas internas.
 *   3. Revisar: el usuario ve el reporte previo y click "Importar X leads"
 *      llama a `confirmImport` que hace el insert batched.
 *   4. Resultado: cuántos entraron, cuántos se skippearon por duplicar (en DB)
 *      y cuántos no entraron por error.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE WIZARD NO USA `ImportXlsxDrawer` DE KG
 * ───────────────────────────────────────────────────────────────────────────
 * `src/components/kg/import-xlsx-drawer.tsx` es un wizard de 3 pasos
 * (upload → review → done) para plantillas de HEADERS FIJOS: su propio
 * comentario lo dice, "sin mapping de columnas". Su contrato es
 * `onPreview(FormData) => { validCount, errorCount, totalRows, errors }` y
 * `onConfirm(FormData) => { imported, errors }`.
 *
 * Este import no entra en ese contrato por cuatro razones, ninguna cosmética:
 *   1. Tiene un paso extra (mapping) que NO existe allá: el archivo del
 *      usuario trae headers arbitrarios y `previewImport` devuelve
 *      `headers + sampleRows + suggestedMapping` para que el usuario los
 *      asocie a nombre / teléfono / email / contacto.
 *   2. Ese paso también junta CONTEXTO que viaja en el FormData de los pasos
 *      siguientes (`map_*`, `default_country`, `launch_id`). El drawer
 *      genérico arma su FormData sólo con `file`.
 *   3. Los reportes tienen métricas propias: `duplicatesInFile` en validate y
 *      `skippedDuplicates` en confirm. El genérico no tiene dónde ponerlas.
 *   4. Las tres server actions llevan `projectId` como primer argumento y un
 *      `_prev` — firma distinta a la que el genérico invoca.
 *
 * Hacerlo encajar exigiría cambiar `ImportXlsxDrawer` (paso de mapping
 * opcional, preview con headers, slots de métricas extra), y ese componente lo
 * consumen otros módulos. Así que el wizard se migró EN EL LUGAR: chasis
 * `Drawer`, campos con `form-primitives`, tablas con `KgDataTable`. La lógica
 * —las tres server actions, el mapeo, las validaciones y el reporte de
 * duplicados— no se tocó.
 */

const COUNTRIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "AR", label: "Argentina (+54)" },
  { code: "UY", label: "Uruguay (+598)" },
  { code: "CL", label: "Chile (+56)" },
  { code: "CO", label: "Colombia (+57)" },
  { code: "MX", label: "México (+52)" },
  { code: "ES", label: "España (+34)" },
  { code: "US", label: "Estados Unidos (+1)" },
];

const FIELD_LABELS: Record<(typeof IMPORT_FIELDS)[number], string> = {
  name: "Nombre (obligatorio)",
  phone: "Teléfono",
  email: "Email",
  contact: "Contacto / handle",
};

type Step = "upload" | "mapping" | "review" | "result";

const STEP_INDEX: Record<Step, number> = {
  upload: 1,
  mapping: 2,
  review: 3,
  result: 4,
};

/** Mismo ajuste que en los demás forms KG: alto mínimo de toque en 36px. */
const controlStyle: CSSProperties = { ...inputStyle, minHeight: 36 };

export function ImportLeadsModal({
  projectId,
  launches,
  triggerLabel,
  triggerClassName,
}: {
  readonly projectId: string;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly triggerLabel: string;
  readonly triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/*
        Trigger secundario (antes era un `bg-surface` con borde y tokens
        viejos). Sigue siendo un `<button>` real para que un call site pueda
        apretarlo con utilidades `!` de Tailwind, que emiten `!important` y
        ganan contra el `style` inline.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`kg-focus${triggerClassName ? ` ${triggerClassName}` : ""}`}
        style={{
          ...secondaryBtn,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 36,
          whiteSpace: "nowrap",
        }}
      >
        {triggerLabel}
      </button>

      {/*
        El montaje condicional se mantiene: cada apertura arranca un `Wizard`
        nuevo, o sea el paso vuelve a "upload" y el archivo anterior se
        descarta. Antes lo garantizaba el `{open && <Dialog>}`.
      */}
      {open && (
        <Wizard
          projectId={projectId}
          launches={launches}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Wizard({
  projectId,
  launches,
  onClose,
}: {
  readonly projectId: string;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<Partial<ImportMapping>>({});
  const [country, setCountry] = useState("AR");
  const [launchId, setLaunchId] = useState("");
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmResult | null>(null);
  const [pending, startTransition] = useTransition();

  const templateHref = `/api/proyectos/${projectId}/leads/template`;

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setMapping({});
    setCountry("AR");
    setLaunchId("");
    setValidation(null);
    setConfirmed(null);
  }

  function handlePreview() {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    startTransition(async () => {
      const result = await previewImport(projectId, null, form);
      setPreview(result);
      if (result.ok) {
        setMapping(result.suggestedMapping);
        setStep("mapping");
      }
    });
  }

  function buildContextForm(): FormData | null {
    if (!file || !mapping.name) return null;
    const form = new FormData();
    form.append("file", file);
    form.append("map_name", mapping.name);
    if (mapping.phone) form.append("map_phone", mapping.phone);
    if (mapping.email) form.append("map_email", mapping.email);
    if (mapping.contact) form.append("map_contact", mapping.contact);
    form.append("default_country", country);
    if (launchId) form.append("launch_id", launchId);
    return form;
  }

  function handleValidate() {
    const form = buildContextForm();
    if (!form) return;
    startTransition(async () => {
      const result = await validateImport(projectId, null, form);
      setValidation(result);
      if (result.ok) setStep("review");
    });
  }

  function handleConfirm() {
    const form = buildContextForm();
    if (!form) return;
    startTransition(async () => {
      const result = await confirmImport(projectId, null, form);
      setConfirmed(result);
      setStep("result");
    });
  }

  /*
   * Los botones de navegación viven en el `footer` del Drawer, que es un slot
   * ÚNICO fuera del cuerpo. Acá eso no genera el problema típico de los forms:
   * este wizard no tiene ningún `<form>` con submit — cada paso avanza por
   * `onClick` + `startTransition` sobre las server actions. Así que el footer
   * puede cambiar de contenido por paso sin trucos de `form={id}`.
   */
  const footer = (
    <FooterBar>
      {step === "upload" && (
        <>
          <FooterBtn kind="secondary" onClick={onClose}>
            Cancelar
          </FooterBtn>
          <FooterBtn
            kind="primary"
            onClick={handlePreview}
            disabled={!file || pending}
          >
            {pending ? "Leyendo…" : "Continuar"}
          </FooterBtn>
        </>
      )}

      {step === "mapping" && (
        <>
          <FooterBtn
            kind="secondary"
            onClick={() => setStep("upload")}
            disabled={pending}
          >
            ← Volver
          </FooterBtn>
          <FooterBtn
            kind="primary"
            onClick={handleValidate}
            disabled={!mapping.name || pending}
          >
            {pending ? "Validando…" : "Validar archivo"}
          </FooterBtn>
        </>
      )}

      {step === "review" && validation?.ok && (
        <>
          <FooterBtn
            kind="secondary"
            onClick={() => setStep("mapping")}
            disabled={pending}
          >
            ← Cambiar mapeo
          </FooterBtn>
          <FooterBtn
            kind="primary"
            onClick={handleConfirm}
            disabled={validation.validCount === 0 || pending}
          >
            {pending
              ? "Importando…"
              : validation.validCount > 0
                ? `Importar ${validation.validCount} leads`
                : "Sin datos válidos"}
          </FooterBtn>
        </>
      )}

      {step === "result" && (
        <>
          <FooterBtn kind="secondary" onClick={reset}>
            Importar otro archivo
          </FooterBtn>
          <FooterBtn kind="primary" onClick={onClose}>
            {confirmed?.ok ? "Listo" : "Cerrar"}
          </FooterBtn>
        </>
      )}
    </FooterBar>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title="Importar leads"
      subtitle={`Paso ${STEP_INDEX[step]} de 4`}
      width={760}
      footer={footer}
    >
      {step === "upload" && (
        <UploadStep
          file={file}
          setFile={setFile}
          previewError={preview && !preview.ok ? preview.error : null}
          templateHref={templateHref}
        />
      )}

      {step === "mapping" && preview?.ok && (
        <MappingStep
          headers={preview.preview.headers}
          sampleRows={preview.preview.sampleRows}
          mapping={mapping}
          setMapping={setMapping}
          country={country}
          setCountry={setCountry}
          launchId={launchId}
          setLaunchId={setLaunchId}
          launches={launches}
          validationError={validation && !validation.ok ? validation.error : null}
        />
      )}

      {step === "review" && validation?.ok && (
        <ReviewStep
          validCount={validation.validCount}
          withErrors={validation.withErrors}
          duplicatesInFile={validation.duplicatesInFile}
          errors={validation.errors}
        />
      )}

      {step === "result" && confirmed && <ResultStep result={confirmed} />}
    </Drawer>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────────────

function UploadStep({
  file,
  setFile,
  previewError,
  templateHref,
}: {
  readonly file: File | null;
  readonly setFile: (f: File | null) => void;
  readonly previewError: string | null;
  readonly templateHref: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          padding: 14,
          borderRadius: "var(--kg-r-12)",
          background: "var(--kg-surface-2-solid)",
          border: "1px solid var(--kg-border-subtle)",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--kg-text-1)",
          }}
        >
          ¿No sabés qué columnas tiene que tener el archivo?
        </p>
        <p
          className="kg-t7"
          style={{ margin: "6px 0 0", color: "var(--kg-text-3)", lineHeight: 1.5 }}
        >
          Descargá la plantilla con los headers de muestra, llenala con tus
          leads y subila acá.
        </p>
        {/* `<a href>` plano y no `Link`: el destino es un route handler que
            devuelve un archivo, no una página — el router no debe
            interceptarlo. */}
        <a
          href={templateHref}
          className="kg-focus"
          style={{
            ...secondaryBtn,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 36,
            marginTop: 12,
            textDecoration: "none",
          }}
        >
          ⬇ Descargar plantilla vacía
        </a>
      </div>

      <Field label="Archivo .xlsx" htmlFor="import-file">
        <input
          id="import-file"
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="kg-focus"
          style={controlStyle}
        />
      </Field>

      {file && (
        // Confirmación de qué archivo quedó cargado: en mobile el nombre del
        // input nativo se trunca y el usuario no sabe si tomó el correcto.
        // `kg-t7` NO se usa acá: aplica `text-transform: uppercase` y
        // destrozaría el nombre del archivo. Tamaño a mano, tabular para el
        // peso.
        <div
          className="kg-num"
          style={{
            color: "var(--kg-text-3)",
            marginTop: -10,
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            wordBreak: "break-all",
          }}
        >
          {file.name} · {formatBytes(file.size)}
        </div>
      )}

      {previewError && <ErrorBanner message={previewError} />}
    </div>
  );
}

/** Fila del preview de muestra: el id lo agrega el wizard para `rowKey`. */
interface SampleRow {
  readonly id: string;
  readonly values: Record<string, string>;
}

function MappingStep({
  headers,
  sampleRows,
  mapping,
  setMapping,
  country,
  setCountry,
  launchId,
  setLaunchId,
  launches,
  validationError,
}: {
  readonly headers: ReadonlyArray<string>;
  readonly sampleRows: ReadonlyArray<Record<string, string>>;
  readonly mapping: Partial<ImportMapping>;
  readonly setMapping: (
    update: (prev: Partial<ImportMapping>) => Partial<ImportMapping>,
  ) => void;
  readonly country: string;
  readonly setCountry: (v: string) => void;
  readonly launchId: string;
  readonly setLaunchId: (v: string) => void;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly validationError: string | null;
}) {
  const headerOptions = [
    { value: "", label: "— ninguna —" },
    ...headers.map((h) => ({ value: h, label: h })),
  ];

  // `KgDataTable` pide `rowKey: (row) => string` y las sample rows son objetos
  // planos sin id. El índice alcanza: son 5 filas de muestra, sin orden ni
  // selección.
  const previewRows: ReadonlyArray<SampleRow> = sampleRows.map((values, i) => ({
    id: `sample-${i}`,
    values,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p className="kg-t6" style={{ margin: 0, color: "var(--kg-text-3)" }}>
        Asociá las columnas del xlsx con los campos de leads. El teléfono se
        normaliza al formato internacional usando el país que elijas.
      </p>

      {/*
        Los selects van NATIVOS, no con `KgFilterSelect`: ese componente navega
        con `router.push(href)` — sirve para filtros de URL, no para juntar el
        estado de un wizard que después viaja en un FormData.

        Mobile primero: apilados en 390px, 2 columnas recién en md+.
      */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {IMPORT_FIELDS.map((field) => (
          <Field
            key={field}
            label={FIELD_LABELS[field]}
            htmlFor={`map-${field}`}
          >
            <select
              id={`map-${field}`}
              value={mapping[field] ?? ""}
              onChange={(e) =>
                setMapping((prev) => ({
                  ...prev,
                  [field]: e.target.value || undefined,
                }))
              }
              style={controlStyle}
            >
              {headerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
        ))}

        <Field label="País default del teléfono" htmlFor="map-country">
          <select
            id="map-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            style={controlStyle}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Asociar a lanzamiento (opcional)" htmlFor="map-launch">
          <select
            id="map-launch"
            value={launchId}
            onChange={(e) => setLaunchId(e.target.value)}
            style={controlStyle}
          >
            <option value="">— Ninguno —</option>
            {launches.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Disclosure summary="Ver preview de las primeras filas">
        {/* La tabla tiene tantas columnas como headers traiga el xlsx: en
            390px no entran, así que scrollea dentro de su caja (KgDataTable ya
            hace overflowX) en vez de romper el ancho del drawer. */}
        <KgDataTable<SampleRow>
          rows={previewRows}
          rowKey={(r) => r.id}
          emptyTitle="El archivo no trajo filas de muestra."
          columns={headers.map((h) => ({
            key: h,
            label: h,
            render: (r) => r.values[h] ?? "",
          }))}
        />
      </Disclosure>

      {validationError && <ErrorBanner message={validationError} />}
    </div>
  );
}

function ReviewStep({
  validCount,
  withErrors,
  duplicatesInFile,
  errors,
}: {
  readonly validCount: number;
  readonly withErrors: number;
  readonly duplicatesInFile: number;
  readonly errors: ReadonlyArray<ImportRowError>;
}) {
  const hasErrors = withErrors > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          label="Listos para importar"
          value={validCount}
          tone={validCount > 0 ? "positive" : null}
        />
        <StatCard
          label="No se van a importar"
          value={withErrors}
          tone={hasErrors ? "warning" : null}
        />
        <StatCard
          label="Duplicados internos"
          value={duplicatesInFile}
          tone={null}
          hint="Mismo teléfono en > 1 fila del archivo"
        />
      </div>

      {hasErrors && (
        <>
          <ErrorBanner
            tone="warning"
            message={`${withErrors} filas no se van a importar. Corregilas en el archivo y volvé a subirlo si las querés incluir, o continuá sin ellas.`}
          />
          <ErrorRowsTable errors={errors} />
        </>
      )}
    </div>
  );
}

function ResultStep({ result }: { readonly result: ConfirmResult }) {
  if (!result.ok) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h3 className="kg-t5" style={{ margin: 0, color: "var(--kg-text-1)" }}>
          No pude importar
        </h3>
        <ErrorBanner message={result.error} />
      </div>
    );
  }

  const hasErrors = result.errors.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          padding: 14,
          borderRadius: "var(--kg-r-12)",
          background: "var(--kg-surface-2-solid)",
          border: "1px solid var(--kg-border-subtle)",
        }}
      >
        {/* El "salió bien" se comunica con el StateDot, no pintando los
            números de verde: la regla del design system vale para cualquier
            dato, no sólo para montos. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StateDot tone="positive" />
          <h3 className="kg-t5" style={{ margin: 0, color: "var(--kg-text-1)" }}>
            Import terminado
          </h3>
        </div>
        <ul
          style={{
            listStyle: "none",
            margin: "10px 0 0",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 5,
            fontSize: 13,
            color: "var(--kg-text-2)",
            lineHeight: 1.5,
          }}
        >
          <li>
            <Count n={result.imported} /> leads importados
          </li>
          <li>
            <Count n={result.skippedDuplicates} /> duplicados (mismo teléfono ya
            cargado en la base)
          </li>
          {hasErrors && (
            <li>
              <Count n={result.errors.length} /> con error (ver detalle)
            </li>
          )}
        </ul>
      </div>

      {hasErrors && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            Detalle de errores ({result.errors.length})
          </div>
          <ErrorRowsTable errors={result.errors} />
        </div>
      )}
    </div>
  );
}

// ─── presentational helpers ─────────────────────────────────────────────────

/**
 * Fila de error con key estable: un mismo `rowNumber` puede repetirse si esa
 * fila del xlsx acumula más de un problema, así que el índice va aparte.
 */
interface ErrorRow extends ImportRowError {
  readonly key: string;
}

function ErrorRowsTable({
  errors,
}: {
  readonly errors: ReadonlyArray<ImportRowError>;
}) {
  const rows: ReadonlyArray<ErrorRow> = errors.map((e, i) => ({
    ...e,
    key: `err-${i}`,
  }));
  return (
    <KgDataTable<ErrorRow>
      rows={rows}
      rowKey={(r) => r.key}
      emptyTitle="Sin errores."
      // El body scrollea dentro del drawer: sin esto una lista de 300 errores
      // empuja el contenido y deja el reporte imposible de recorrer.
      maxBodyHeight="240px"
      columns={[
        {
          key: "rowNumber",
          label: "Fila",
          align: "right",
          numeric: true,
          width: "72px",
          render: (r) => r.rowNumber,
        },
        { key: "reason", label: "Motivo", render: (r) => r.reason },
      ]}
    />
  );
}

/**
 * Tarjeta de conteo. El número va SIEMPRE en `--kg-text-1`: el tono viaja en
 * el `StateDot` junto al label, nunca sobre el dato (regla KG).
 */
function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone: KgTone | null;
  readonly hint?: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: "var(--kg-r-12)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      <div
        className="kg-t7"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--kg-text-3)",
        }}
      >
        <StateDot tone={tone} />
        {label}
      </div>
      <div
        className="kg-num"
        style={{
          marginTop: 6,
          fontSize: 24,
          fontWeight: 700,
          color: "var(--kg-text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          className="kg-t7"
          style={{ marginTop: 4, color: "var(--kg-text-3)", lineHeight: 1.4 }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

/** Número inline dentro de una frase — tabular para que la lista "cierre". */
function Count({ n }: { readonly n: number }) {
  return (
    <strong
      className="kg-num"
      style={{ color: "var(--kg-text-1)", fontVariantNumeric: "tabular-nums" }}
    >
      {n}
    </strong>
  );
}

/**
 * `<details>` estilado. Se mantiene el elemento nativo (y no un toggle con
 * `useState`) porque no necesita estado en JS y ya trae la semántica de
 * expandido/colapsado para lectores de pantalla.
 */
function Disclosure({
  summary,
  children,
}: {
  readonly summary: string;
  readonly children: ReactNode;
}) {
  return (
    <details
      style={{
        borderRadius: "var(--kg-r-12)",
        border: "1px solid var(--kg-border-subtle)",
        background: "var(--kg-surface-2-solid)",
        padding: 12,
      }}
    >
      <summary
        className="kg-focus"
        style={{
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--kg-text-1)",
          minHeight: 24,
        }}
      >
        {summary}
      </summary>
      <div style={{ marginTop: 12 }}>{children}</div>
    </details>
  );
}

/**
 * Barra del footer. En 390px los botones se reparten el ancho (`flex-1`) para
 * llegar cómodos al target de toque; en md+ vuelven a su ancho natural, con
 * "volver" a la izquierda y la acción principal a la derecha.
 */
function FooterBar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 md:justify-between">{children}</div>
  );
}

function FooterBtn({
  kind,
  onClick,
  disabled,
  children,
}: {
  readonly kind: "primary" | "secondary";
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="kg-focus flex-1 md:flex-none"
      style={{
        ...(kind === "primary" ? primaryBtn : secondaryBtn),
        minHeight: 36,
        whiteSpace: "nowrap",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
