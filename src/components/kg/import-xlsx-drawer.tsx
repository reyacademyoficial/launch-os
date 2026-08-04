"use client";

import { useRef, useState, useTransition } from "react";

import { Drawer } from "@/components/kg/drawer";

/**
 * Import xlsx drawer genérico — 3 pasos:
 *   1. upload  → elegir archivo + link a la plantilla
 *   2. review  → mostrar preview (X válidas, Y con error) + botón confirmar
 *   3. done    → resultado final (importadas, errores)
 *
 * Sin mapping de columnas: la plantilla tiene headers fijos. La fila 1 =
 * headers, datos desde la 2.
 *
 * Genérico via callbacks: cada consumidor pasa `onPreview` y `onConfirm`
 * (server actions que envían el archivo). El drawer no conoce el dominio.
 */

export interface ParseError {
  readonly rowNumber: number;
  readonly reason: string;
}

export type PreviewOk = {
  readonly ok: true;
  readonly validCount: number;
  readonly errorCount: number;
  readonly totalRows: number;
  readonly errors: ReadonlyArray<ParseError>;
};
export type PreviewResult = PreviewOk | { readonly ok: false; readonly error: string };

export type ConfirmOk = {
  readonly ok: true;
  readonly imported: number;
  readonly errors: ReadonlyArray<ParseError>;
};
export type ConfirmResult = ConfirmOk | { readonly ok: false; readonly error: string };

export function ImportXlsxDrawer({
  open,
  onClose,
  title,
  templateHref,
  templateDescription,
  onPreview,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly templateHref: string;
  readonly templateDescription: string;
  readonly onPreview: (formData: FormData) => Promise<PreviewResult>;
  readonly onConfirm: (formData: FormData) => Promise<ConfirmResult>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handlePreview() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await onPreview(fd);
      setPreview(res);
    });
  }

  function handleConfirm() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await onConfirm(fd);
      setResult(res);
    });
  }

  const step: "upload" | "review" | "done" =
    result ? "done" : preview && preview.ok ? "review" : "upload";

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={title}
      subtitle="Importar desde Excel (.xlsx)"
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={handleClose}
            className="kg-focus"
            style={ghostBtn}
          >
            {step === "done" ? "Cerrar" : "Cancelar"}
          </button>
          {step === "upload" && (
            <button
              type="button"
              onClick={handlePreview}
              disabled={!file || pending}
              className="kg-focus"
              style={primaryBtn(!file || pending)}
            >
              {pending ? "Analizando…" : "Validar archivo"}
            </button>
          )}
          {step === "review" && preview && preview.ok && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={preview.validCount === 0 || pending}
              className="kg-focus"
              style={primaryBtn(preview.validCount === 0 || pending)}
            >
              {pending
                ? "Importando…"
                : `Importar ${preview.validCount} fila${preview.validCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      }
    >
      {step === "upload" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            className="kg-t6"
            style={{ color: "var(--kg-text-3)", lineHeight: 1.5 }}
          >
            {templateDescription}
          </div>
          <a
            href={templateHref}
            className="kg-focus"
            style={{
              alignSelf: "flex-start",
              padding: "6px 12px",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-2)",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Descargar plantilla
          </a>

          <div>
            <label
              className="kg-t7"
              style={{
                display: "block",
                color: "var(--kg-text-3)",
                marginBottom: 6,
              }}
            >
              Archivo
            </label>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(null);
              }}
              className="kg-focus"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "var(--kg-r-8)",
                background: "var(--kg-surface-2-solid)",
                border: "1px solid var(--kg-border-subtle)",
                color: "var(--kg-text-1)",
                fontSize: 13,
              }}
            />
          </div>

          {preview && !preview.ok && (
            <Callout tone="negative">{preview.error}</Callout>
          )}
        </div>
      )}

      {step === "review" && preview && preview.ok && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Stat label="Filas leídas" value={preview.totalRows} />
            <Stat
              label="Válidas"
              value={preview.validCount}
              color="#00D084"
            />
            <Stat
              label="Con error"
              value={preview.errorCount}
              color={preview.errorCount > 0 ? "#EF4444" : undefined}
            />
          </div>

          {preview.errors.length > 0 && (
            <div>
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-3)", marginBottom: 8 }}
              >
                Filas descartadas (mostrando hasta 20)
              </div>
              <ErrorList errors={preview.errors.slice(0, 20)} />
              {preview.errors.length > 20 && (
                <div
                  className="kg-t7"
                  style={{
                    color: "var(--kg-text-3)",
                    marginTop: 6,
                    fontStyle: "italic",
                  }}
                >
                  … y {preview.errors.length - 20} más.
                </div>
              )}
            </div>
          )}

          {preview.validCount === 0 ? (
            <Callout tone="warning">
              No hay filas válidas para importar. Revisá los errores y volvé a
              subir el archivo.
            </Callout>
          ) : (
            <Callout tone="positive">
              Se van a importar <strong>{preview.validCount}</strong> filas.
              Confirmá abajo.
            </Callout>
          )}
        </div>
      )}

      {step === "done" && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {result.ok ? (
            <>
              <Callout tone="positive">
                Se importaron <strong>{result.imported}</strong> filas.
              </Callout>
              {result.errors.length > 0 && (
                <div>
                  <div
                    className="kg-t7"
                    style={{ color: "var(--kg-text-3)", marginBottom: 8 }}
                  >
                    Filas que quedaron fuera
                  </div>
                  <ErrorList errors={result.errors.slice(0, 20)} />
                </div>
              )}
            </>
          ) : (
            <Callout tone="negative">{result.error}</Callout>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: number;
  readonly color?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {label}
      </span>
      <strong
        className="kg-num"
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: color ?? "var(--kg-text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function ErrorList({ errors }: { readonly errors: ReadonlyArray<ParseError> }) {
  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxHeight: 240,
        overflowY: "auto",
        border: "1px solid var(--kg-border-subtle)",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
      }}
    >
      {errors.map((e, i) => (
        <li
          key={`${e.rowNumber}-${i}`}
          style={{
            padding: "6px 10px",
            borderBottom:
              i === errors.length - 1
                ? "none"
                : "1px solid var(--kg-border-subtle)",
            fontSize: 12,
            color: "var(--kg-text-2)",
            display: "flex",
            gap: 10,
          }}
        >
          <span
            style={{
              minWidth: 42,
              color: "var(--kg-text-3)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            #{e.rowNumber}
          </span>
          <span>{e.reason}</span>
        </li>
      ))}
    </ul>
  );
}

function Callout({
  tone,
  children,
}: {
  readonly tone: "positive" | "warning" | "negative";
  readonly children: React.ReactNode;
}) {
  const map = {
    positive: { bg: "rgba(0,208,132,0.10)", border: "#00D084", fg: "#00D084" },
    warning: { bg: "rgba(255,184,0,0.10)", border: "#FFB800", fg: "#FFB800" },
    negative: { bg: "rgba(239,68,68,0.10)", border: "#EF4444", fg: "#EF4444" },
  } as const;
  const s = map[tone];
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: "var(--kg-r-8)",
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.fg,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 999,
    background: "var(--kg-accent-500)",
    border: "none",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
