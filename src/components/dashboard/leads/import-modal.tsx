"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  confirmImport,
  previewImport,
  validateImport,
  type ConfirmResult,
  type ImportRowError,
  type PreviewResult,
  type ValidateResult,
} from "@/app/(app)/proyectos/[projectId]/leads/import-actions";
import { IMPORT_FIELDS, type ImportMapping } from "@/lib/leads/import-config";

/**
 * Modal de import xlsx (reemplaza la página dedicada).
 *
 * 3 pasos:
 *   1. Upload: arrastrar el .xlsx o usar el botón. Antes hay 2 links de
 *      descarga — plantilla vacía con headers + ejemplo, y export de los
 *      leads actuales (formato espejo para edición masiva externa).
 *   2. Mapear columnas + país + lanzamiento. Click "Validar archivo" llama
 *      a `validateImport` que parsea todo sin insertar y devuelve cuántas
 *      filas son válidas / con error / duplicadas internas.
 *   3. Confirmar: el usuario ve el reporte previo y click "Importar X leads"
 *      llama a `confirmImport` que hace el insert batched. El resultado final
 *      muestra cuántos entraron, cuántos se skippearon por duplicar (en DB) y
 *      cuántos no entraron por error.
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "inline-flex items-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-elevated"
        }
      >
        {triggerLabel}
      </button>

      {open && (
        <Dialog onClose={() => setOpen(false)}>
          <Wizard
            projectId={projectId}
            launches={launches}
            onClose={() => setOpen(false)}
          />
        </Dialog>
      )}
    </>
  );
}

function Dialog({
  children,
  onClose,
}: {
  readonly children: React.ReactNode;
  readonly onClose: () => void;
}) {
  // Esc cierra el modal. Mismo patrón que los otros modals del proyecto.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-md border border-border bg-bg p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
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
  const exportHref = `/api/proyectos/${projectId}/leads/export`;

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

  return (
    <div className="space-y-5">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-fg">Importar leads</h2>
          <p className="mt-1 text-xs text-fg-subtle">
            Paso {step === "upload" ? 1 : step === "mapping" ? 2 : step === "review" ? 3 : 4} de 4
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="text-fg-muted hover:text-fg"
        >
          ✕
        </button>
      </header>

      {step === "upload" && (
        <UploadStep
          file={file}
          setFile={setFile}
          onPreview={handlePreview}
          pending={pending}
          previewError={preview && !preview.ok ? preview.error : null}
          templateHref={templateHref}
          exportHref={exportHref}
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
          onBack={() => setStep("upload")}
          onValidate={handleValidate}
          validationError={validation && !validation.ok ? validation.error : null}
          pending={pending}
        />
      )}

      {step === "review" && validation?.ok && (
        <ReviewStep
          validCount={validation.validCount}
          withErrors={validation.withErrors}
          duplicatesInFile={validation.duplicatesInFile}
          errors={validation.errors}
          onBack={() => setStep("mapping")}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}

      {step === "result" && confirmed && (
        <ResultStep
          result={confirmed}
          onClose={onClose}
          onAnother={reset}
        />
      )}
    </div>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────────────

function UploadStep({
  file,
  setFile,
  onPreview,
  pending,
  previewError,
  templateHref,
  exportHref,
}: {
  readonly file: File | null;
  readonly setFile: (f: File | null) => void;
  readonly onPreview: () => void;
  readonly pending: boolean;
  readonly previewError: string | null;
  readonly templateHref: string;
  readonly exportHref: string;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-accent/30 bg-accent/5 p-4">
        <p className="text-sm font-medium text-fg">
          ¿No sabés qué columnas tiene que tener el archivo?
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          Descargá la plantilla con los headers de muestra, llenala con tus
          leads y subila acá.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={templateHref}
            className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-bg-elevated"
          >
            ⬇ Descargar plantilla vacía
          </a>
          <a
            href={exportHref}
            className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-bg-elevated"
          >
            ⬇ Exportar leads actuales (.xlsx)
          </a>
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-fg">Archivo .xlsx</span>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full rounded-md border border-border bg-bg-elevated p-2 text-sm text-fg"
        />
      </label>

      {previewError && (
        <p className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-error">
          {previewError}
        </p>
      )}

      <div className="flex justify-end">
        <Button disabled={!file || pending} onClick={onPreview}>
          {pending ? "Leyendo…" : "Continuar"}
        </Button>
      </div>
    </div>
  );
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
  onBack,
  onValidate,
  validationError,
  pending,
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
  readonly onBack: () => void;
  readonly onValidate: () => void;
  readonly validationError: string | null;
  readonly pending: boolean;
}) {
  const headerOptions = [
    { value: "", label: "— ninguna —" },
    ...headers.map((h) => ({ value: h, label: h })),
  ];

  return (
    <div className="space-y-5">
      <p className="text-xs text-fg-subtle">
        Asociá las columnas del xlsx con los campos de leads. El teléfono se
        normaliza al formato internacional usando el país que elijas.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {IMPORT_FIELDS.map((field) => (
          <label key={field} className="block text-sm">
            <span className="text-fg-subtle">{FIELD_LABELS[field]}</span>
            <select
              value={mapping[field] ?? ""}
              onChange={(e) =>
                setMapping((prev) => ({
                  ...prev,
                  [field]: e.target.value || undefined,
                }))
              }
              className="mt-1 w-full rounded-md border border-border bg-bg-elevated p-2 text-sm text-fg"
            >
              {headerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ))}

        <label className="block text-sm">
          <span className="text-fg-subtle">País default del teléfono</span>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-bg-elevated p-2 text-sm text-fg"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-fg-subtle">Asociar a lanzamiento (opcional)</span>
          <select
            value={launchId}
            onChange={(e) => setLaunchId(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-bg-elevated p-2 text-sm text-fg"
          >
            <option value="">— Ninguno —</option>
            {launches.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="rounded-md border border-border bg-surface/40 p-3">
        <summary className="cursor-pointer text-sm font-medium text-fg">
          Ver preview de las primeras filas
        </summary>
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="bg-surface text-left uppercase tracking-wide text-fg-subtle">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-2 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sampleRows.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {headers.map((h) => (
                    <td key={h} className="px-2 py-2 text-fg-muted">
                      {row[h] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {validationError && (
        <p className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-error">
          {validationError}
        </p>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onBack} disabled={pending}>
          ← Volver
        </Button>
        <Button disabled={!mapping.name || pending} onClick={onValidate}>
          {pending ? "Validando…" : "Validar archivo"}
        </Button>
      </div>
    </div>
  );
}

function ReviewStep({
  validCount,
  withErrors,
  duplicatesInFile,
  errors,
  onBack,
  onConfirm,
  pending,
}: {
  readonly validCount: number;
  readonly withErrors: number;
  readonly duplicatesInFile: number;
  readonly errors: ReadonlyArray<ImportRowError>;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
  readonly pending: boolean;
}) {
  const hasErrors = withErrors > 0;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Listos para importar"
          value={validCount}
          emphasis="success"
        />
        <StatCard
          label="No se van a importar"
          value={withErrors}
          emphasis={hasErrors ? "warning" : "neutral"}
        />
        <StatCard
          label="Duplicados internos"
          value={duplicatesInFile}
          emphasis="neutral"
          hint="Mismo teléfono en > 1 fila del archivo"
        />
      </div>

      {hasErrors && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm font-medium text-fg">
            {withErrors} filas no se van a importar
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Corregilas en el archivo y volvé a subirlo si las querés
            incluir, o continuá sin ellas.
          </p>
          <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-border bg-bg-elevated">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface text-left uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-3 py-2">Fila</th>
                  <th className="px-3 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5 text-fg-muted tabular-nums">
                      {e.rowNumber}
                    </td>
                    <td className="px-3 py-1.5 text-fg">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onBack} disabled={pending}>
          ← Cambiar mapeo
        </Button>
        <Button
          disabled={validCount === 0 || pending}
          onClick={onConfirm}
        >
          {pending
            ? "Importando…"
            : validCount > 0
              ? `Importar ${validCount} leads`
              : "Sin datos válidos"}
        </Button>
      </div>
    </div>
  );
}

function ResultStep({
  result,
  onClose,
  onAnother,
}: {
  readonly result: ConfirmResult;
  readonly onClose: () => void;
  readonly onAnother: () => void;
}) {
  if (!result.ok) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-error/40 bg-error/5 p-4">
          <h3 className="text-base font-semibold text-fg">No pude importar</h3>
          <p className="mt-2 text-sm text-fg-muted">{result.error}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onAnother}>
            Probar otro archivo
          </Button>
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    );
  }

  const hasErrors = result.errors.length > 0;
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-success/40 bg-success/5 p-4">
        <h3 className="text-base font-semibold text-fg">Import terminado</h3>
        <ul className="mt-2 space-y-1 text-sm text-fg">
          <li>
            <strong>{result.imported}</strong> leads importados
          </li>
          <li>
            <strong>{result.skippedDuplicates}</strong> duplicados (mismo
            teléfono ya cargado en la base)
          </li>
          {hasErrors && (
            <li>
              <strong>{result.errors.length}</strong> con error (ver detalle)
            </li>
          )}
        </ul>
      </div>

      {hasErrors && (
        <details className="rounded-md border border-border bg-surface/40 p-3" open>
          <summary className="cursor-pointer text-sm font-medium text-fg">
            Detalle de errores ({result.errors.length})
          </summary>
          <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-border bg-bg-elevated">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface text-left uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th className="px-3 py-2">Fila</th>
                  <th className="px-3 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5 text-fg-muted tabular-nums">
                      {e.rowNumber}
                    </td>
                    <td className="px-3 py-1.5 text-fg">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onAnother}>
          Importar otro archivo
        </Button>
        <Button onClick={onClose}>Listo</Button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  emphasis,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly emphasis: "success" | "warning" | "neutral";
  readonly hint?: string;
}) {
  const valueClass =
    emphasis === "success"
      ? "text-success"
      : emphasis === "warning"
        ? "text-warning"
        : "text-fg";
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold ${valueClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}
