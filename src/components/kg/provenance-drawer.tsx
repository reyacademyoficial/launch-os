"use client";

import { Breakdown, type BreakdownPart } from "./breakdown";
import { Drawer } from "./drawer";
import { Halo } from "./halo";

/**
 * KG · ProvenanceDrawer. Muestra de dónde sale un KPI: valor grande + desglose
 * (Breakdown con las partes que devolvió el selector) + chips con la metadata
 * origen (`<tabla>.<campo> · <condición>`).
 *
 * A diferencia del artefacto — que resolvía todo desde el registro `KPIS` —
 * este drawer recibe el desglose ya armado por la page/dashboard. Los sources
 * se declaran una sola vez, al lado del fetch, y viajan como prop.
 *
 * Footer: "Ningún valor se introduce a mano" — es la tesis del sistema.
 */
export interface ProvenanceSource {
  readonly table: string;
  readonly field: string;
  readonly cond?: string;
}

export interface ProvenanceDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** Valor total YA FORMATEADO (la page lo pasa listo). */
  readonly value: string;
  readonly parts: ReadonlyArray<BreakdownPart>;
  readonly sources: ReadonlyArray<ProvenanceSource>;
  readonly fmtFn: (n: number) => string;
  readonly haloTone?: string;
}

export function ProvenanceDrawer({
  open,
  onClose,
  title,
  value,
  parts,
  sources,
  fmtFn,
  haloTone,
}: ProvenanceDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Procedencia"
      footer={
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", textAlign: "center" }}
        >
          Ningún valor se introduce a mano: todo se deriva del modelo.
        </div>
      }
    >
      {/* Valor actual */}
      <div
        style={{
          position: "relative",
          padding: "18px 20px",
          borderRadius: "var(--kg-r-16)",
          border: "1px solid var(--kg-border-subtle)",
          background: "var(--kg-surface-2-solid)",
          overflow: "hidden",
          marginBottom: 20,
        }}
      >
        <Halo tone={haloTone ?? "var(--kg-accent-500)"} op={0.1} />
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", position: "relative" }}
        >
          Valor actual
        </div>
        <div
          className="kg-metric"
          style={{
            fontSize: 36,
            fontWeight: 800,
            letterSpacing: "-1.2px",
            lineHeight: 1,
            color: "var(--kg-text-1)",
            marginTop: 8,
            position: "relative",
          }}
        >
          {value}
        </div>
      </div>

      {/* Desglose */}
      {parts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginBottom: 10 }}
          >
            Desglose
          </div>
          <div
            style={{
              borderTop: "1px solid var(--kg-border-subtle)",
              borderBottom: "1px solid var(--kg-border-subtle)",
              padding: "12px 0",
            }}
          >
            <Breakdown
              total={parts.reduce((acc, p) => acc + p.v, 0)}
              totalLabel="Total"
              parts={parts}
              fmtFn={fmtFn}
            />
          </div>
        </div>
      )}

      {/* Campos origen */}
      {sources.length > 0 && (
        <div>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginBottom: 10 }}
          >
            Campos origen
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sources.map((s, i) => (
              <div
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 6,
                  padding: "8px 12px",
                  borderRadius: "var(--kg-r-8)",
                  background: "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize: 12,
                  color: "var(--kg-text-2)",
                }}
              >
                <span style={{ color: "var(--kg-accent-text)", fontWeight: 700 }}>
                  {s.table}
                </span>
                <span>.{s.field}</span>
                {s.cond && (
                  <span style={{ color: "var(--kg-text-3)" }}>· {s.cond}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
