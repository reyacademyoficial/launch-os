"use client";

import { Breakdown, type BreakdownPart } from "./breakdown";
import { Drawer } from "./drawer";
import { Halo } from "./halo";

/**
 * KG · ProvenanceDrawer. Muestra de dónde sale un KPI: valor grande + desglose
 * (Breakdown con las partes que devolvió el selector).
 *
 * A diferencia del artefacto — que resolvía todo desde el registro `KPIS` —
 * este drawer recibe el desglose ya armado por la page/dashboard.
 *
 * Footer: "Ningún valor se introduce a mano" — es la tesis del sistema.
 */
export interface ProvenanceDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** Valor total YA FORMATEADO (la page lo pasa listo). */
  readonly value: string;
  readonly parts: ReadonlyArray<BreakdownPart>;
  readonly fmtFn: (n: number) => string;
  readonly haloTone?: string;
}

export function ProvenanceDrawer({
  open,
  onClose,
  title,
  value,
  parts,
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

    </Drawer>
  );
}
