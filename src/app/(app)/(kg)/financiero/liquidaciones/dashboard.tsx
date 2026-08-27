"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { Breakdown } from "@/components/kg/breakdown";
import { ContextBar } from "@/components/kg/context-bar";
import { Drawer } from "@/components/kg/drawer";
import { EmptyState } from "@/components/kg/empty-state";
import { IconFin } from "@/components/kg/icons";
import { KgPageFilters } from "@/components/kg/page-menu";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import {
  computeSettlementNetTransfer,
  type SettlementNetTransfer,
} from "@/lib/settlements/calc";
import type { LaunchSettlementStatus } from "@/lib/settlements/types";
import type { LaunchSettlementInsert } from "@/lib/settlements/create";

import {
  closeLaunchSettlement,
  commitComplementarySettlement,
  commitCreateSettlement,
  previewComplementarySettlement,
  previewCreateSettlement,
  reopenLaunchSettlement,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de datos que la page (server) inyecta
// ═══════════════════════════════════════════════════════════════════════════

export interface SettlementRow {
  readonly id: string;
  readonly status: LaunchSettlementStatus;
  readonly collectedTotal: number;
  /** Σ cobrado por bancos NO externos (plata que ya tiene Kingrow). Ver mig 0170. */
  readonly collectedByMe: number;
  /** Σ cobrado por bancos externos del proyecto (plata que ya tiene el cliente). */
  readonly collectedByClientExternal: number;
  readonly kingrowRetained: number;
  readonly owedToClient: number;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly ruleName: string;
}

export interface LaunchRow {
  readonly launchId: string;
  readonly launchName: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly ownership: "propia" | "externa";
  readonly organizationId: string;
  /** `launches.date_end` — fecha "económica" del lanzamiento (default de closed_at). */
  readonly dateEnd: string | null;
  /** `launches.closed_at` — cuándo se marcó cerrado en el módulo de launches. */
  readonly launchClosedAt: string | null;
  /** true si hay regla activa (override o default) — pre-check informativo. */
  readonly canBeSettled: boolean;
  /** Ordenado por created_at DESC. Puede estar vacío. */
  readonly settlements: readonly SettlementRow[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Filtros del listado — el usuario mira o el estado de las liquidaciones,
// o "lanzamientos sin liquidar" (una señal: hay plata sin liquidar).
// ═══════════════════════════════════════════════════════════════════════════

type FilterKey =
  | "todos"
  | "sin-liquidar"
  | "abierta"
  | "liquidada"
  | "transferida";

const FILTERS: ReadonlyArray<{ readonly key: FilterKey; readonly label: string }> =
  [
    { key: "todos", label: "Todos" },
    { key: "sin-liquidar", label: "Sin liquidar" },
    { key: "abierta", label: "Borradores" },
    { key: "liquidada", label: "Liquidadas" },
    { key: "transferida", label: "Transferidas" },
  ];

// ═══════════════════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════════════════

export function LiquidacionesDashboard({
  rows,
}: {
  readonly rows: readonly LaunchRow[];
}) {
  const [filter, setFilter] = useState<FilterKey>("todos");

  // Panel de creación: launch elegido + preview vivo. Panel de cierre:
  // settlement elegido + fecha elegida. Separados a propósito — son dos
  // flujos con confirmaciones diferentes.
  const [creatingFor, setCreatingFor] = useState<LaunchRow | null>(null);
  const [complementaryFor, setComplementaryFor] = useState<LaunchRow | null>(
    null,
  );
  const [reopening, setReopening] = useState<{
    launch: LaunchRow;
    settlement: SettlementRow;
  } | null>(null);
  const [closing, setClosing] = useState<{
    launch: LaunchRow;
    settlement: SettlementRow;
  } | null>(null);

  // ─── Filtrado ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (filter === "todos") return rows;
    if (filter === "sin-liquidar") {
      // "Sin liquidar" = no hay ningún settlement cerrado (liquidada|
      // transferida). Los borradores (abierta) NO cuentan como "liquidado"
      // — es exactamente la señal: hay plata sin liquidar.
      return rows.filter(
        (r) =>
          !r.settlements.some(
            (s) => s.status === "liquidada" || s.status === "transferida",
          ),
      );
    }
    return rows.filter((r) => r.settlements.some((s) => s.status === filter));
  }, [rows, filter]);

  // ─── Métricas del contexto bar ────────────────────────────────────────
  const counts = useMemo(() => {
    let abierta = 0;
    let liquidada = 0;
    let transferida = 0;
    let sinLiquidar = 0;
    for (const r of rows) {
      const hasClosed = r.settlements.some(
        (s) => s.status === "liquidada" || s.status === "transferida",
      );
      if (!hasClosed) sinLiquidar += 1;
      for (const s of r.settlements) {
        if (s.status === "abierta") abierta += 1;
        else if (s.status === "liquidada") liquidada += 1;
        else transferida += 1;
      }
    }
    return { abierta, liquidada, transferida, sinLiquidar };
  }, [rows]);

  const retenidoTotal = useMemo(
    () =>
      rows.reduce(
        (acc, r) =>
          acc +
          r.settlements.reduce(
            (a, s) =>
              s.status === "liquidada" || s.status === "transferida"
                ? a + s.kingrowRetained
                : a,
            0,
          ),
        0,
      ),
    [rows],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Kingrow · Liquidaciones"
        stats={[
          { l: "Sin liquidar", v: fCount(counts.sinLiquidar) },
          { l: "Borradores", v: fCount(counts.abierta) },
          { l: "Liquidadas", v: fCount(counts.liquidada) },
          { l: "Transferidas", v: fCount(counts.transferida) },
          { l: "Kingrow retenido", v: fMoney(retenidoTotal) },
        ]}
      />

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <KgPageFilters activeCount={filter !== "todos" ? 1 : 0}>
          <FilterPills current={filter} onChange={setFilter} rows={rows} />
        </KgPageFilters>
        <span className="hidden md:contents">
          <a
            href="/api/financiero/liquidaciones/export"
            className="kg-focus"
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-2)",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            }}
            title="Exportar todas las liquidaciones a Excel"
          >
            Exportar Excel
          </a>
        </span>
      </div>

      <Panel title="Lanzamientos y liquidaciones">
        {filtered.length === 0 ? (
          <EmptyState
            title={emptyTitle(filter)}
            hint="Cambiá el filtro o cargá lanzamientos y pagos."
          />
        ) : (
          <LaunchList
            rows={filtered}
            onCreate={(l) => setCreatingFor(l)}
            onComplementary={(l) => setComplementaryFor(l)}
            onReopen={(l, s) => setReopening({ launch: l, settlement: s })}
            onClose={(l, s) => setClosing({ launch: l, settlement: s })}
          />
        )}
      </Panel>

      {creatingFor && (
        <CreateDrawer
          launch={creatingFor}
          onClose={() => setCreatingFor(null)}
        />
      )}
      {complementaryFor && (
        <ComplementaryDrawer
          launch={complementaryFor}
          onClose={() => setComplementaryFor(null)}
        />
      )}
      {reopening && (
        <ReopenDrawer
          launch={reopening.launch}
          settlement={reopening.settlement}
          onClose={() => setReopening(null)}
        />
      )}
      {closing && (
        <CloseDrawer
          launch={closing.launch}
          settlement={closing.settlement}
          onClose={() => setClosing(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Pills de filtro — mismo look que las `PeriodPills` del dashboard financiero.
// No reusamos StatRow porque los items del StatRow son etiqueta+valor puros
// sin onClick.
// ═══════════════════════════════════════════════════════════════════════════

function FilterPills({
  current,
  onChange,
  rows,
}: {
  readonly current: FilterKey;
  readonly onChange: (k: FilterKey) => void;
  readonly rows: readonly LaunchRow[];
}) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "10px 14px",
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
      }}
      role="tablist"
      aria-label="Filtro por estado"
    >
      {FILTERS.map((f) => {
        const active = current === f.key;
        const count = countForFilter(f.key, rows);
        return (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.key)}
            className="kg-focus"
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              background: active ? "var(--kg-accent-500)" : "transparent",
              color: active ? "#fff" : "var(--kg-text-2)",
              border: active ? "none" : "1px solid var(--kg-border-subtle)",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>{f.label}</span>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                opacity: active ? 0.9 : 0.7,
              }}
            >
              {fCount(count)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function countForFilter(key: FilterKey, rows: readonly LaunchRow[]): number {
  if (key === "todos") return rows.length;
  if (key === "sin-liquidar") {
    return rows.filter(
      (r) =>
        !r.settlements.some(
          (s) => s.status === "liquidada" || s.status === "transferida",
        ),
    ).length;
  }
  return rows.reduce(
    (acc, r) => acc + r.settlements.filter((s) => s.status === key).length,
    0,
  );
}

function emptyTitle(filter: FilterKey): string {
  switch (filter) {
    case "todos":
      return "No hay lanzamientos cargados";
    case "sin-liquidar":
      return "Todos los lanzamientos tienen alguna liquidación cerrada";
    case "abierta":
      return "No hay borradores";
    case "liquidada":
      return "Aún no hay liquidaciones cerradas";
    case "transferida":
      return "Aún no hay liquidaciones transferidas";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Listado de lanzamientos
// ═══════════════════════════════════════════════════════════════════════════

function LaunchList({
  rows,
  onCreate,
  onComplementary,
  onReopen,
  onClose,
}: {
  readonly rows: readonly LaunchRow[];
  readonly onCreate: (l: LaunchRow) => void;
  readonly onComplementary: (l: LaunchRow) => void;
  readonly onReopen: (l: LaunchRow, s: SettlementRow) => void;
  readonly onClose: (l: LaunchRow, s: SettlementRow) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <LaunchCard
          key={r.launchId}
          launch={r}
          onCreate={() => onCreate(r)}
          onComplementary={() => onComplementary(r)}
          onReopen={(s) => onReopen(r, s)}
          onClose={(s) => onClose(r, s)}
        />
      ))}
    </div>
  );
}

function LaunchCard({
  launch,
  onCreate,
  onComplementary,
  onReopen,
  onClose,
}: {
  readonly launch: LaunchRow;
  readonly onCreate: () => void;
  readonly onComplementary: () => void;
  readonly onReopen: (s: SettlementRow) => void;
  readonly onClose: (s: SettlementRow) => void;
}) {
  const hasClosed = launch.settlements.some(
    (s) => s.status === "liquidada" || s.status === "transferida",
  );
  const hasDraft = launch.settlements.some((s) => s.status === "abierta");
  return (
    <article
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginBottom: 2 }}
          >
            {launch.projectName} · {launch.ownership}
          </div>
          <h4
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              color: "var(--kg-text-1)",
            }}
          >
            {launch.launchName}
          </h4>
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 3 }}
          >
            {launch.dateEnd
              ? `Cierre económico: ${fmtDate(launch.dateEnd)}`
              : "Sin fecha de cierre"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!hasClosed && (
            <button
              type="button"
              onClick={onCreate}
              disabled={!launch.canBeSettled}
              className="kg-focus"
              title={
                launch.canBeSettled
                  ? "Crear una liquidación en borrador"
                  : "El proyecto no tiene regla de split activa"
              }
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                background: launch.canBeSettled
                  ? "var(--kg-accent-500)"
                  : "var(--kg-surface-2-solid)",
                color: launch.canBeSettled ? "#fff" : "var(--kg-text-3)",
                border: "none",
                fontSize: 11,
                fontWeight: 700,
                cursor: launch.canBeSettled ? "pointer" : "not-allowed",
              }}
            >
              + Crear liquidación
            </button>
          )}
          {hasClosed && (
            <button
              type="button"
              onClick={onComplementary}
              className="kg-focus"
              title="Liquidar los pagos posteriores al último cierre"
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                background: "transparent",
                color: "var(--kg-accent-500)",
                border: "1px solid var(--kg-accent-500)",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + Complementaria
            </button>
          )}
        </div>
      </header>

      {launch.settlements.length === 0 ? (
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontStyle: "italic" }}
        >
          Sin liquidaciones registradas.
          {!launch.canBeSettled &&
            " Configurá la regla de split del proyecto para poder liquidar."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {launch.settlements.map((s) => (
            <SettlementLine
              key={s.id}
              settlement={s}
              onClose={() => onClose(s)}
              onReopen={() => onReopen(s)}
            />
          ))}
          {hasDraft && hasClosed && (
            <div
              className="kg-t7"
              style={{
                color: "var(--kg-text-3)",
                fontStyle: "italic",
                marginTop: 4,
              }}
            >
              Convive un borrador con una liquidación cerrada. El orquestador
              considera el cierre como el estado autoritativo — el borrador es
              una copia sin efecto.
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function SettlementLine({
  settlement,
  onClose,
  onReopen,
}: {
  readonly settlement: SettlementRow;
  readonly onClose: () => void;
  readonly onReopen: () => void;
}) {
  const s = settlement;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <StatusPill status={s.status} />
        <Metric label="Cobrado" value={s.collectedTotal} />
        <Metric label="Kingrow" value={s.kingrowRetained} />
        <Metric label="Cliente" value={s.owedToClient} />
        {s.closedAt && (
          <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            Cerrada: {fmtDate(s.closedAt)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Regla: {s.ruleName}
        </div>
        {s.status === "abierta" && (
          <button
            type="button"
            onClick={onClose}
            className="kg-focus"
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              background: "var(--kg-accent-500)",
              color: "#fff",
              border: "none",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Cerrar
          </button>
        )}
        {s.status === "liquidada" && (
          <button
            type="button"
            onClick={onReopen}
            className="kg-focus"
            title="Reabrir la liquidación (solo superadmin). Deshace el auto-devengo al cliente."
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              background: "transparent",
              color: "var(--kg-text-2)",
              border: "1px solid var(--kg-border-subtle)",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reabrir
          </button>
        )}
        {/*
          `transferida` se muestra en el listado y en los filtros, pero NO
          se ofrece la transición `liquidada → transferida`. Requiere linkear
          un movimiento bancario real y eso es otro bloque. Ver comentario
          cabecera de la RPC 0100. Tampoco se ofrece "Reabrir" desde
          `transferida` — la plata ya se movió y el flujo es un ajuste
          contable manual, no una reapertura.
        */}
      </div>
    </div>
  );
}

function StatusPill({ status }: { readonly status: LaunchSettlementStatus }) {
  const spec = statusSpec(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: spec.bg,
        color: spec.fg,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: spec.dot,
          display: "inline-block",
        }}
      />
      {spec.label}
    </span>
  );
}

function statusSpec(status: LaunchSettlementStatus): {
  label: string;
  bg: string;
  fg: string;
  dot: string;
} {
  if (status === "abierta")
    return {
      label: "Borrador",
      bg: "rgba(138,138,153,0.15)",
      fg: "var(--kg-text-2)",
      dot: "#8A8A99",
    };
  if (status === "liquidada")
    return {
      label: "Liquidada",
      bg: "rgba(255,184,0,0.15)",
      fg: "#FFB800",
      dot: "#FFB800",
    };
  return {
    label: "Transferida",
    bg: "rgba(0,208,132,0.15)",
    fg: "#00D084",
    dot: "#00D084",
  };
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {label}
      </span>
      <strong
        className="kg-num"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--kg-text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fMoney(value)}
      </strong>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Drawer: crear liquidación (preview + commit)
// ═══════════════════════════════════════════════════════════════════════════
//
// Flujo:
//   1) Al abrir, ejecuta el `previewCreateSettlement` (dryRun) contra el
//      launch elegido. Muestra el desglose con los mismos componentes que
//      el simulador de reglas — retenido, a transferir, cantidad de ventas.
//   2) El usuario confirma explícitamente y llama `commitCreateSettlement`.
//   3) Si el preview falla (no-rule / no-payments / already-settled) se
//      muestra el mensaje traducido y NO se ofrece el botón de commit.

function CreateDrawer({
  launch,
  onClose,
}: {
  readonly launch: LaunchRow;
  readonly onClose: () => void;
}) {
  const [previewState, setPreviewState] = useState<
    | { kind: "loading" }
    | {
        kind: "ok";
        payload: LaunchSettlementInsert;
        draftsCount: number;
      }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [committing, startCommit] = useTransition();
  const [committed, setCommitted] = useState<{ id: string } | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Carga el preview la primera vez que se abre el drawer. Dep del launchId:
  // si el drawer se re-abre con un launch distinto, se recarga. El brief del
  // gate 2 pide asegurar que la vista previa no escribe — es exactamente
  // `dryRun=true` del orquestador (default de createSettlement).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await previewCreateSettlement({ launchId: launch.launchId });
      if (cancelled) return;
      if (res.ok) {
        setPreviewState({
          kind: "ok",
          payload: res.payload,
          draftsCount: res.draftsCount,
        });
      } else {
        setPreviewState({ kind: "error", message: res.error });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [launch.launchId]);

  function handleCommit() {
    setCommitError(null);
    startCommit(async () => {
      const res = await commitCreateSettlement({ launchId: launch.launchId });
      if (res.ok) {
        setCommitted({ id: res.settlementId });
      } else {
        setCommitError(res.error);
      }
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Crear liquidación"
      subtitle={`${launch.projectName} · ${launch.launchName}`}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            className="kg-focus"
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-2)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {committed ? "Cerrar" : "Cancelar"}
          </button>
          {previewState.kind === "ok" && !committed && (
            <button
              type="button"
              onClick={handleCommit}
              disabled={committing}
              className="kg-focus"
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                background: "var(--kg-accent-500)",
                border: "none",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                cursor: committing ? "wait" : "pointer",
                opacity: committing ? 0.7 : 1,
              }}
            >
              {committing ? "Creando…" : "Crear en borrador"}
            </button>
          )}
        </div>
      }
    >
      {previewState.kind === "loading" && (
        <div className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
          Calculando la vista previa…
        </div>
      )}

      {previewState.kind === "error" && (
        <Callout tone="negative">{previewState.message}</Callout>
      )}

      {previewState.kind === "ok" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            className="kg-t6"
            style={{ color: "var(--kg-text-3)", lineHeight: 1.5 }}
          >
            Vista previa —{" "}
            <strong style={{ color: "var(--kg-text-2)" }}>
              no se escribe hasta que confirmes
            </strong>
            . El cálculo usa la regla{" "}
            <strong>{previewState.payload.settlement_rule_snapshot.name}</strong>
            {" "}(base: {previewState.payload.settlement_rule_snapshot.applies_on}).
          </div>

          <Breakdown
            total={previewState.payload.collected_total}
            totalLabel="Cobrado del lanzamiento"
            parts={[
              {
                l: "Kingrow retenido",
                v: previewState.payload.kingrow_retained,
              },
              {
                l:
                  launch.ownership === "externa"
                    ? "A transferir al cliente"
                    : "Queda para el proyecto propio",
                v: previewState.payload.owed_to_client,
              },
            ]}
            fmtFn={fMoney}
          />

          <ChannelBreakdown
            collectedByMe={previewState.payload.collected_by_me}
            collectedByClientExternal={
              previewState.payload.collected_by_client_external
            }
            kingrowRetained={previewState.payload.kingrow_retained}
            fmtFn={fMoney}
          />

          {previewState.draftsCount > 0 && (
            <Callout tone="warning">
              Ya existen {fCount(previewState.draftsCount)} borrador
              {previewState.draftsCount === 1 ? "" : "es"} para este
              lanzamiento. Se va a crear uno nuevo — no reemplaza a los
              anteriores. Revisá los borradores viejos si sobran.
            </Callout>
          )}

          {committed && (
            <Callout tone="positive">
              Liquidación creada en borrador. Ya podés cerrarla desde el
              listado eligiendo la fecha de cierre.
            </Callout>
          )}

          {commitError && <Callout tone="negative">{commitError}</Callout>}
        </div>
      )}
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Drawer: cerrar liquidación (abierta → liquidada)
// ═══════════════════════════════════════════════════════════════════════════
//
// El `closed_at` lo elige el usuario, con default en `launches.date_end` (o
// `launches.closed_at`, o hoy como último recurso). Debajo del campo se muestra
// el mes de impacto — un lanzamiento cerrado en junio y liquidado hoy
// caería como facturación de julio si nadie mira ese campo. La UI lo hace
// explícito.

function CloseDrawer({
  launch,
  settlement,
  onClose,
}: {
  readonly launch: LaunchRow;
  readonly settlement: SettlementRow;
  readonly onClose: () => void;
}) {
  const defaultDate =
    launch.dateEnd ??
    (launch.launchClosedAt ? launch.launchClosedAt.slice(0, 10) : todayYmd());
  const [closedAt, setClosedAt] = useState<string>(defaultDate);
  const [submitting, startClose] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const willImpactLabel = useMemo(() => impactMonthLabel(closedAt), [closedAt]);

  function handleSubmit() {
    setError(null);
    startClose(async () => {
      // Convertimos el `yyyy-mm-dd` a un ISO 8601 al inicio del día. La RPC
      // acepta timestamptz — la hora exacta no afecta la lectura porque los
      // selectores agregan por mes.
      const iso = new Date(`${closedAt}T00:00:00`).toISOString();
      const res = await closeLaunchSettlement({
        settlementId: settlement.id,
        closedAt: iso,
      });
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  }

  const willGenerateTransfer =
    settlement.owedToClient > 0 && launch.ownership === "externa";

  return (
    <Drawer
      open
      onClose={onClose}
      title="Cerrar liquidación"
      subtitle={`${launch.projectName} · ${launch.launchName}`}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            className="kg-focus"
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-2)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {done ? "Cerrar" : "Cancelar"}
          </button>
          {!done && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !closedAt}
              className="kg-focus"
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                background: "var(--kg-accent-500)",
                border: "none",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting || !closedAt ? 0.7 : 1,
              }}
            >
              {submitting ? "Cerrando…" : "Confirmar cierre"}
            </button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Breakdown
          total={settlement.collectedTotal}
          totalLabel="Cobrado"
          parts={[
            { l: "Kingrow retiene", v: settlement.kingrowRetained },
            {
              l:
                launch.ownership === "externa"
                  ? "A transferir al cliente"
                  : "Queda para el proyecto propio",
              v: settlement.owedToClient,
            },
          ]}
          fmtFn={fMoney}
        />

        <ChannelBreakdown
          collectedByMe={settlement.collectedByMe}
          collectedByClientExternal={settlement.collectedByClientExternal}
          kingrowRetained={settlement.kingrowRetained}
          fmtFn={fMoney}
        />

        <div>
          <label
            htmlFor="closed-at"
            className="kg-t7"
            style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
          >
            Fecha de cierre
          </label>
          <input
            id="closed-at"
            type="date"
            value={closedAt}
            onChange={(e) => setClosedAt(e.target.value)}
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
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6, lineHeight: 1.5 }}
          >
            Default: fecha económica del lanzamiento. Podés cambiarla al día
            administrativo del cierre. <br />
            <strong style={{ color: "var(--kg-text-2)" }}>
              Esta liquidación va a sumar {fMoney(settlement.kingrowRetained)} al
              ingreso de Kingrow de {willImpactLabel}.
            </strong>
          </div>
        </div>

        {willGenerateTransfer && (
          <Callout tone="warning">
            Se va a generar automáticamente un devengo a favor del cliente por{" "}
            <strong>{fMoney(settlement.owedToClient)}</strong>. Aparece en
            cuentas por pagar hasta que se registre la transferencia real
            desde el módulo bancario.
          </Callout>
        )}

        {done && (
          <Callout tone="positive">
            Liquidación cerrada. El ingreso ya se refleja en el dashboard
            financiero.
          </Callout>
        )}

        {error && <Callout tone="negative">{error}</Callout>}
      </div>
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Drawer: crear liquidación complementaria (delta cobrado post-cierre)
// ═══════════════════════════════════════════════════════════════════════════
//
// Mismo flujo que CreateDrawer: preview (dryRun) al abrir, commit al
// confirmar. La diferencia es que llama a las actions de complementaria
// y el copy explica que solo se cobra % sobre el delta (sin fixed fees ni
// min_guarantee — esos ya se cobraron en la original).

function ComplementaryDrawer({
  launch,
  onClose,
}: {
  readonly launch: LaunchRow;
  readonly onClose: () => void;
}) {
  const [previewState, setPreviewState] = useState<
    | { kind: "loading" }
    | {
        kind: "ok";
        payload: LaunchSettlementInsert;
        newlyCollected: number;
        previouslyCollected: number;
      }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [committing, startCommit] = useTransition();
  const [committed, setCommitted] = useState<{ id: string } | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await previewComplementarySettlement({
        launchId: launch.launchId,
      });
      if (cancelled) return;
      if (res.ok) {
        setPreviewState({
          kind: "ok",
          payload: res.payload,
          newlyCollected: res.newlyCollected,
          previouslyCollected: res.previouslyCollected,
        });
      } else {
        setPreviewState({ kind: "error", message: res.error });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [launch.launchId]);

  function handleCommit() {
    setCommitError(null);
    startCommit(async () => {
      const res = await commitComplementarySettlement({
        launchId: launch.launchId,
      });
      if (res.ok) {
        setCommitted({ id: res.settlementId });
      } else {
        setCommitError(res.error);
      }
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Crear liquidación complementaria"
      subtitle={`${launch.projectName} · ${launch.launchName}`}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            className="kg-focus"
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-2)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {committed ? "Cerrar" : "Cancelar"}
          </button>
          {previewState.kind === "ok" && !committed && (
            <button
              type="button"
              onClick={handleCommit}
              disabled={committing}
              className="kg-focus"
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                background: "var(--kg-accent-500)",
                border: "none",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                cursor: committing ? "wait" : "pointer",
                opacity: committing ? 0.7 : 1,
              }}
            >
              {committing ? "Creando…" : "Crear en borrador"}
            </button>
          )}
        </div>
      }
    >
      {previewState.kind === "loading" && (
        <div className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
          Calculando el delta cobrado…
        </div>
      )}

      {previewState.kind === "error" && (
        <Callout tone="negative">{previewState.message}</Callout>
      )}

      {previewState.kind === "ok" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            className="kg-t6"
            style={{ color: "var(--kg-text-3)", lineHeight: 1.5 }}
          >
            Complementaria sobre <strong>{fMoney(previewState.newlyCollected)}</strong>{" "}
            de pagos entrados después de la última liquidación (
            {fMoney(previewState.previouslyCollected)} ya liquidados). Solo se
            aplica el porcentaje de la regla vigente — los fees fijos y el
            mínimo garantizado ya se cobraron en la original.
          </div>

          <Breakdown
            total={previewState.payload.collected_total}
            totalLabel="Cobrado nuevo (delta)"
            parts={[
              {
                l: "Kingrow retenido",
                v: previewState.payload.kingrow_retained,
              },
              {
                l:
                  launch.ownership === "externa"
                    ? "A transferir al cliente"
                    : "Queda para el proyecto propio",
                v: previewState.payload.owed_to_client,
              },
            ]}
            fmtFn={fMoney}
          />

          <ChannelBreakdown
            collectedByMe={previewState.payload.collected_by_me}
            collectedByClientExternal={
              previewState.payload.collected_by_client_external
            }
            kingrowRetained={previewState.payload.kingrow_retained}
            fmtFn={fMoney}
          />

          {committed && (
            <Callout tone="positive">
              Complementaria creada en borrador. Cerrala desde el listado para
              devengar los montos.
            </Callout>
          )}

          {commitError && <Callout tone="negative">{commitError}</Callout>}
        </div>
      )}
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Drawer: reabrir liquidación (liquidada → abierta, con motivo)
// ═══════════════════════════════════════════════════════════════════════════
//
// Solo aparece para `status='liquidada'` (nunca para transferida). Requiere
// motivo obligatorio (la RPC 0130 rebota si está vacío). Deshace el
// auto-devengo `a_favor_cliente` que 0100 había insertado — la UI lo avisa
// para que el operador entienda qué se está tocando.

function ReopenDrawer({
  launch,
  settlement,
  onClose,
}: {
  readonly launch: LaunchRow;
  readonly settlement: SettlementRow;
  readonly onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleSubmit() {
    setError(null);
    startSubmit(async () => {
      const res = await reopenLaunchSettlement({
        settlementId: settlement.id,
        reason,
      });
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  }

  const willUnwindTransfer =
    settlement.owedToClient > 0 && launch.ownership === "externa";
  const canSubmit = reason.trim().length > 0 && !submitting;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Reabrir liquidación"
      subtitle={`${launch.projectName} · ${launch.launchName}`}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            className="kg-focus"
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-2)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {done ? "Cerrar" : "Cancelar"}
          </button>
          {!done && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="kg-focus"
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                background: "var(--kg-accent-500)",
                border: "none",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                cursor: canSubmit ? "pointer" : "not-allowed",
                opacity: canSubmit ? 1 : 0.6,
              }}
            >
              {submitting ? "Reabriendo…" : "Confirmar reapertura"}
            </button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Breakdown
          total={settlement.collectedTotal}
          totalLabel="Cobrado (queda igual al reabrir)"
          parts={[
            { l: "Kingrow retenido", v: settlement.kingrowRetained },
            {
              l:
                launch.ownership === "externa"
                  ? "A transferir al cliente"
                  : "Queda para el proyecto propio",
              v: settlement.owedToClient,
            },
          ]}
          fmtFn={fMoney}
        />

        <div>
          <label
            htmlFor="reopen-reason"
            className="kg-t7"
            style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
          >
            Motivo (obligatorio)
          </label>
          <textarea
            id="reopen-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ej: la regla estaba mal, hay que recalcular con el porcentaje corregido"
            className="kg-focus"
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: "var(--kg-r-8)",
              background: "var(--kg-surface-2-solid)",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-1)",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <div
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginTop: 6, lineHeight: 1.5 }}
          >
            Se guarda con el usuario y la fecha en la fila de la liquidación
            para auditoría.
          </div>
        </div>

        {willUnwindTransfer && (
          <Callout tone="warning">
            Reabrir va a borrar el devengo automático de{" "}
            <strong>{fMoney(settlement.owedToClient)}</strong> a favor del
            cliente (el que 0100 había insertado al cerrar). Si ya se generó
            una transferencia bancaria linkeada, la reapertura va a rebotar
            hasta que la desvinculés.
          </Callout>
        )}

        {done && (
          <Callout tone="positive">
            Liquidación reabierta. Ya la podés recalcular y cerrar de nuevo
            desde el listado.
          </Callout>
        )}

        {error && <Callout tone="negative">{error}</Callout>}
      </div>
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Canal de cobro + neto de transferencia (post 0169/0170)
// ═══════════════════════════════════════════════════════════════════════════
//
// Solo se renderiza el bloque cuando el launch tuvo COBRO POR CANAL EXTERNO
// (`collectedByClientExternal > 0`). Si toda la plata entró por bancos
// propios, el flujo clásico (kingrow retiene → transferir a cliente) alcanza
// y no vale la pena agregar ruido visual.
//
// El neto se calcula con `computeSettlementNetTransfer` (pure). Cuando es 0
// dejamos un callout neutro con la aclaración de que no hay transferencia
// pendiente — más útil que ocultarlo (el usuario querría saber "quedó
// saldado" explícitamente).

function ChannelBreakdown({
  collectedByMe,
  collectedByClientExternal,
  kingrowRetained,
  fmtFn,
}: {
  readonly collectedByMe: number;
  readonly collectedByClientExternal: number;
  readonly kingrowRetained: number;
  readonly fmtFn: (v: number) => string;
}) {
  if (collectedByClientExternal <= 0) return null;

  // computeSettlementNetTransfer solo lee `kingrowRetained` del breakdown —
  // no necesitamos reconstruir el objeto completo. El cast al shape mínimo
  // es intencional para evitar cargar el breakdown entero solo para el neto.
  const net: SettlementNetTransfer = computeSettlementNetTransfer(
    { kingrowRetained } as Parameters<typeof computeSettlementNetTransfer>[0],
    collectedByMe,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          textTransform: "uppercase",
          letterSpacing: ".5px",
        }}
      >
        Cobro por canal
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ChannelRow label="Cobrado por Kingrow (mis bancos)" v={collectedByMe} fmtFn={fmtFn} />
        <ChannelRow
          label="Cobrado por el cliente (banco externo)"
          v={collectedByClientExternal}
          fmtFn={fmtFn}
        />
      </div>

      <NetTransferCallout net={net} fmtFn={fmtFn} />
    </div>
  );
}

function ChannelRow({
  label,
  v,
  fmtFn,
}: {
  readonly label: string;
  readonly v: number;
  readonly fmtFn: (v: number) => string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--kg-text-3)" }}>{label}</span>
      <strong
        className="kg-num"
        style={{ color: "var(--kg-text-2)", fontWeight: 600 }}
      >
        {fmtFn(v)}
      </strong>
    </div>
  );
}

function NetTransferCallout({
  net,
  fmtFn,
}: {
  readonly net: SettlementNetTransfer;
  readonly fmtFn: (v: number) => string;
}) {
  if (net.direction === "none") {
    return (
      <Callout tone="positive">
        Neto de transferencia: <strong>saldado</strong>. Lo cobrado por
        Kingrow coincide con la retención — no hay plata que mover.
      </Callout>
    );
  }
  if (net.direction === "kingrow_to_client") {
    return (
      <Callout tone="warning">
        Kingrow le transfiere al cliente <strong>{fmtFn(net.amount)}</strong>.
        (Cobré más de lo que retengo, la diferencia es del cliente.)
      </Callout>
    );
  }
  return (
    <Callout tone="warning">
      El cliente le transfiere a Kingrow <strong>{fmtFn(net.amount)}</strong>.
      (Retengo más de lo que cobré por mis bancos — la diferencia me la debe.)
    </Callout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

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

function fmtDate(iso: string): string {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function impactMonthLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
