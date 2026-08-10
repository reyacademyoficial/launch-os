"use client";

import { useState, useTransition } from "react";

import { EmptyState } from "@/components/kg/empty-state";
import { StatusPill } from "@/components/kg/status-pill";
import { daysSinceLastContact } from "@/lib/clients/health";
import type { RelationshipStatus } from "@/lib/clients/types";

import { resetProjectHealth } from "./actions";
import {
  HealthFormDrawer,
  type HealthInitial,
} from "./health-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Panel de health del cliente. Muestra estado actual + drawer para editar.
//
// Si no hay fila en project_health (cliente sin health cargada), invita a
// cargarla. Si hay, muestra los cuatro ingredientes y ofrece editar o
// resetear (borrar la fila para volver a "sin cargar").
// ═══════════════════════════════════════════════════════════════════════════

export interface HealthCurrent {
  readonly relationshipStatus: RelationshipStatus;
  readonly healthScore: number | null;
  readonly lastContactAt: string | null;
  readonly notes: string | null;
}

/**
 * Score compuesto pre-calculado por el server con la fórmula del plan §1.4
 * (NPS + contacto + tickets urgentes). Se usa como fallback cuando
 * `HealthCurrent.healthScore` es null (sin override manual).
 *
 * `isLimited` = true si alguno de los ingredientes principales faltó
 * (redistribución de pesos). Se muestra badge "Datos limitados" en la UI.
 */
export interface HealthComputed {
  readonly score: number;
  readonly isLimited: boolean;
  readonly npsComponent: number | null;
  readonly contactComponent: number | null;
  readonly ticketsComponent: number;
}

const STATUS_LABEL: Record<RelationshipStatus, string> = {
  onboarding: "Onboarding",
  activa: "Activa",
  en_riesgo: "En riesgo",
  perdida: "Perdida",
};

const STATUS_TONE: Record<RelationshipStatus, string> = {
  onboarding: "var(--kg-accent-500)",
  activa: "var(--kg-positive-500)",
  en_riesgo: "var(--kg-warning-500)",
  perdida: "var(--kg-negative-500)",
};

export function HealthPanel({
  clientId,
  clientName,
  current,
  computed,
}: {
  readonly clientId: string;
  readonly clientName: string;
  readonly current: HealthCurrent | null;
  readonly computed: HealthComputed;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial: HealthInitial | undefined = current
    ? {
        relationshipStatus: current.relationshipStatus,
        healthScore: current.healthScore,
        lastContactAt: current.lastContactAt,
        notes: current.notes,
      }
    : undefined;

  function handleReset() {
    const ok = window.confirm(
      `¿Resetear el health del cliente "${clientName}"? ` +
        "Se borra la fila de project_health y el cliente queda como 'sin health cargada'. " +
        "Reversible cargándolo de nuevo.",
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await resetProjectHealth(clientId);
      if ("error" in result) setError(result.error);
    });
  }

  if (current == null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <ErrorBanner text={error} />}
        <EmptyState
          title="Health sin cargar"
          hint="Cargá el estado inicial de la relación (onboarding, activa, en riesgo, perdida), un score opcional, y la fecha del último contacto. Se puede editar cuando cambie."
          actions={
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="kg-focus"
              style={primaryBtn}
            >
              Cargar health
            </button>
          }
        />
        <HealthFormDrawer
          clientId={clientId}
          clientName={clientName}
          hasCurrent={false}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      </div>
    );
  }

  const daysSince = daysSinceLastContact({
    last_contact_at: current.lastContactAt,
  });
  const daysLabel =
    daysSince == null
      ? "—"
      : daysSince === 0
        ? "hoy"
        : daysSince === 1
          ? "hace 1 día"
          : `hace ${daysSince} días`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error && <ErrorBanner text={error} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Row
          label="Estado"
          value={
            <StatusPill
              text={STATUS_LABEL[current.relationshipStatus]}
              tone={STATUS_TONE[current.relationshipStatus]}
            />
          }
        />
        <Row
          label="Health score"
          value={
            current.healthScore != null ? (
              <ScoreBadge value={current.healthScore} kind="manual" />
            ) : (
              <ScoreBadge
                value={computed.score}
                kind="compuesto"
                limited={computed.isLimited}
              />
            )
          }
        />
        {current.healthScore == null && (
          <Row
            label="Cómo se compone"
            value={
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-3)", lineHeight: 1.55 }}
              >
                NPS: {formatComponent(computed.npsComponent)} · Contacto:{" "}
                {formatComponent(computed.contactComponent)} · Tickets urgentes:{" "}
                {formatComponent(computed.ticketsComponent)}
                {computed.isLimited && (
                  <div style={{ marginTop: 4 }}>
                    Faltan ingredientes — los pesos se redistribuyeron
                    proporcionalmente entre los disponibles.
                  </div>
                )}
              </div>
            }
            multiline
          />
        )}
        <Row
          label="Último contacto"
          value={
            current.lastContactAt == null
              ? "—"
              : `${formatDate(current.lastContactAt)} · ${daysLabel}`
          }
        />
        {current.notes && <Row label="Notas" value={current.notes} multiline />}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleReset}
          disabled={pending}
          className="kg-focus"
          style={secondaryBtn}
          title="Borra la fila de health (reversible cargándola de nuevo)"
        >
          {pending ? "Reseteando…" : "Resetear"}
        </button>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          disabled={pending}
          className="kg-focus"
          style={primaryBtn}
        >
          Editar
        </button>
      </div>

      <HealthFormDrawer
        clientId={clientId}
        clientName={clientName}
        hasCurrent
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initial={initial}
      />
    </div>
  );
}

function ScoreBadge({
  value,
  kind,
  limited,
}: {
  readonly value: number;
  readonly kind: "manual" | "compuesto";
  readonly limited?: boolean;
}) {
  const tone =
    value >= 70
      ? "var(--kg-positive-500)"
      : value >= 40
        ? "var(--kg-warning-500)"
        : "var(--kg-negative-500)";
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "var(--kg-text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span style={{ color: "var(--kg-text-3)", fontSize: 12 }}>/ 100</span>
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: tone,
        }}
      />
      <span
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.3,
          marginLeft: 2,
        }}
      >
        {kind === "manual" ? "Manual" : "Compuesto"}
        {limited && " · Datos limitados"}
      </span>
    </div>
  );
}

function formatComponent(value: number | null): string {
  if (value == null) return "—";
  return String(Math.round(value));
}

function Row({
  label,
  value,
  multiline,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly multiline?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 13,
          lineHeight: multiline ? 1.55 : 1.4,
          whiteSpace: multiline ? "pre-wrap" : "normal",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ErrorBanner({ text }: { readonly text: string }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "rgba(239,68,68,0.10)",
        border: "1px solid #EF4444",
        color: "#EF4444",
        fontSize: 12,
      }}
    >
      {text}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
    const d = new Date(s);
    return d.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
