import Link from "next/link";

import { EmptyState } from "@/components/kg/empty-state";
import { StatusPill } from "@/components/kg/status-pill";
import { classifyNps, computeNps } from "@/lib/clients/health";
import { fMoney } from "@/lib/finance/format";
import type {
  RenewalStatus,
  TicketPriority,
  TicketStatus,
  UpsellStatus,
} from "@/lib/clients/types";

// ═══════════════════════════════════════════════════════════════════════════
// Sub-secciones de la ficha del cliente. Server components puros — reciben
// datos pre-procesados por la page y renderizan mini-listas con top 3 rows
// y link "Ver todos" al módulo global filtrado por clientId.
//
// El objetivo es "un vistazo": counts + últimos movimientos + un tap para
// llegar al CRUD completo. La carga/edición vive en las vistas globales.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_ROWS = 3;

const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  abierto: "Abierto",
  en_progreso: "En progreso",
  esperando_cliente: "Esperando cliente",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};

const TICKET_STATUS_TONE: Record<TicketStatus, string> = {
  abierto: "var(--kg-accent-500)",
  en_progreso: "var(--kg-warning-500)",
  esperando_cliente: "var(--kg-neutral-500)",
  resuelto: "var(--kg-positive-500)",
  cerrado: "var(--kg-neutral-500)",
};

const PRIORITY_TONE: Record<TicketPriority, string> = {
  baja: "var(--kg-neutral-500)",
  media: "var(--kg-neutral-500)",
  alta: "var(--kg-warning-500)",
  urgente: "var(--kg-negative-500)",
};

const OPEN_TICKET_STATUSES: ReadonlySet<TicketStatus> = new Set([
  "abierto",
  "en_progreso",
  "esperando_cliente",
]);

const CLOSED_LIFECYCLE: ReadonlySet<RenewalStatus | UpsellStatus> = new Set([
  "cobrada",
  "perdida",
]);

// ═══════════════════════════════════════════════════════════════════════════
// TICKETS
// ═══════════════════════════════════════════════════════════════════════════

export interface TicketSummaryItem {
  readonly id: string;
  readonly title: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly dueDate: string | null;
  readonly createdAt: string;
}

export function TicketsSummary({
  clientId,
  tickets,
}: {
  readonly clientId: string;
  readonly tickets: readonly TicketSummaryItem[];
}) {
  const openCount = tickets.filter((t) => OPEN_TICKET_STATUSES.has(t.status))
    .length;
  const urgentOpenCount = tickets.filter(
    (t) => OPEN_TICKET_STATUSES.has(t.status) && t.priority === "urgente",
  ).length;

  // Primero abiertos por prioridad desc, después el resto por creado desc.
  const sorted = [...tickets].sort((a, b) => {
    const aOpen = OPEN_TICKET_STATUSES.has(a.status) ? 1 : 0;
    const bOpen = OPEN_TICKET_STATUSES.has(b.status) ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const top = sorted.slice(0, MAX_ROWS);

  return (
    <SectionShell
      title="Tickets"
      stats={[
        { l: "Abiertos", v: String(openCount) },
        { l: "Urgentes", v: String(urgentOpenCount) },
      ]}
      viewAllHref={`/clientes/tickets?clientId=${clientId}`}
      isEmpty={tickets.length === 0}
      emptyTitle="Sin tickets del cliente"
      emptyHint="Cargalos desde 'Ver todos' — se atan al cliente y opcionalmente a un launch."
    >
      {top.map((t) => (
        <RowItem
          key={t.id}
          primary={t.title}
          secondary={
            <div
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
              className="kg-t7"
            >
              <StatusPill
                text={TICKET_STATUS_LABEL[t.status]}
                tone={TICKET_STATUS_TONE[t.status]}
              />
              {t.priority !== "baja" && t.priority !== "media" && (
                <StatusPill text={t.priority} tone={PRIORITY_TONE[t.priority]} />
              )}
              {t.dueDate && (
                <span style={{ color: "var(--kg-text-3)" }}>
                  Vence {formatDateYmd(t.dueDate)}
                </span>
              )}
            </div>
          }
        />
      ))}
    </SectionShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RENEWALS
// ═══════════════════════════════════════════════════════════════════════════

export interface RenewalSummaryItem {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly status: RenewalStatus;
  readonly collectedAt: string | null;
}

const RENEWAL_STATUS_LABEL: Record<RenewalStatus, string> = {
  propuesta: "Propuesta",
  confirmada: "Confirmada",
  facturada: "Facturada",
  cobrada: "Cobrada",
  perdida: "Perdida",
};

const LIFECYCLE_STATUS_TONE: Record<RenewalStatus, string> = {
  propuesta: "var(--kg-neutral-500)",
  confirmada: "var(--kg-accent-500)",
  facturada: "var(--kg-warning-500)",
  cobrada: "var(--kg-positive-500)",
  perdida: "var(--kg-negative-500)",
};

export function RenewalsSummary({
  clientId,
  renewals,
}: {
  readonly clientId: string;
  readonly renewals: readonly RenewalSummaryItem[];
}) {
  const pipelineCount = renewals.filter(
    (r) => !CLOSED_LIFECYCLE.has(r.status),
  ).length;
  const cobradasCount = renewals.filter((r) => r.status === "cobrada").length;

  // Ordenar por período fin desc (las más recientes primero).
  const sorted = [...renewals].sort((a, b) =>
    b.periodEnd.localeCompare(a.periodEnd),
  );
  const top = sorted.slice(0, MAX_ROWS);

  return (
    <SectionShell
      title="Renovaciones"
      stats={[
        { l: "Pipeline", v: String(pipelineCount) },
        { l: "Cobradas", v: String(cobradasCount) },
      ]}
      viewAllHref={`/clientes/renovaciones?clientId=${clientId}&status=todas`}
      isEmpty={renewals.length === 0}
      emptyTitle="Sin renovaciones del cliente"
      emptyHint="Cargalas desde 'Ver todos' — cuentan en el LTV solo cuando se marcan cobradas."
    >
      {top.map((r) => (
        <RowItem
          key={r.id}
          primary={`${formatMonth(r.periodStart)} – ${formatMonth(r.periodEnd)}`}
          secondary={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--kg-text-2)", fontSize: 12 }}>
                {fMoneyCur(r.amount, r.currency)}
              </span>
              <StatusPill
                text={RENEWAL_STATUS_LABEL[r.status]}
                tone={LIFECYCLE_STATUS_TONE[r.status]}
              />
            </div>
          }
        />
      ))}
    </SectionShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UPSELLS
// ═══════════════════════════════════════════════════════════════════════════

export interface UpsellSummaryItem {
  readonly id: string;
  readonly title: string;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly status: UpsellStatus;
  readonly closedAt: string | null;
  readonly createdAt: string;
}

const UPSELL_STATUS_LABEL: Record<UpsellStatus, string> = RENEWAL_STATUS_LABEL;

export function UpsellsSummary({
  clientId,
  upsells,
}: {
  readonly clientId: string;
  readonly upsells: readonly UpsellSummaryItem[];
}) {
  const pipelineCount = upsells.filter(
    (u) => !CLOSED_LIFECYCLE.has(u.status),
  ).length;
  const cobradosCount = upsells.filter((u) => u.status === "cobrada").length;

  const sorted = [...upsells].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const top = sorted.slice(0, MAX_ROWS);

  return (
    <SectionShell
      title="Upsells"
      stats={[
        { l: "Pipeline", v: String(pipelineCount) },
        { l: "Cobrados", v: String(cobradosCount) },
      ]}
      viewAllHref={`/clientes/upsells?clientId=${clientId}&status=todos`}
      isEmpty={upsells.length === 0}
      emptyTitle="Sin upsells del cliente"
      emptyHint="Cargalos desde 'Ver todos' — ventas adicionales al cliente que cuentan en el LTV."
    >
      {top.map((u) => (
        <RowItem
          key={u.id}
          primary={u.title}
          secondary={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--kg-text-2)", fontSize: 12 }}>
                {fMoneyCur(u.amount, u.currency)}
              </span>
              <StatusPill
                text={UPSELL_STATUS_LABEL[u.status]}
                tone={LIFECYCLE_STATUS_TONE[u.status]}
              />
            </div>
          }
        />
      ))}
    </SectionShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// NPS
// ═══════════════════════════════════════════════════════════════════════════

export interface NpsSummaryItem {
  readonly id: string;
  readonly respondentName: string | null;
  readonly respondentEmail: string | null;
  readonly score: number;
  readonly respondedAt: string;
}

const BUCKET_LABEL = {
  promoter: "Promotor",
  passive: "Pasivo",
  detractor: "Detractor",
} as const;

const BUCKET_TONE = {
  promoter: "var(--kg-positive-500)",
  passive: "var(--kg-warning-500)",
  detractor: "var(--kg-negative-500)",
} as const;

export function NpsSummary({
  clientId,
  nps,
}: {
  readonly clientId: string;
  readonly nps: readonly NpsSummaryItem[];
}) {
  // NPS score computado sobre TODAS las respuestas del cliente (no aplicamos
  // ventana temporal acá — es un summary del cliente, no un dashboard
  // periódico). Si querés ventana, filtrá antes de pasar.
  const breakdown = computeNps(
    nps.map((r) => ({
      client_id: clientId,
      score: r.score,
      responded_at: r.respondedAt,
    })),
  );

  const sorted = [...nps].sort((a, b) =>
    b.respondedAt.localeCompare(a.respondedAt),
  );
  const top = sorted.slice(0, MAX_ROWS);

  const scoreLabel =
    breakdown.npsScore == null ? "—" : String(Math.round(breakdown.npsScore));

  return (
    <SectionShell
      title="NPS"
      stats={[
        { l: "Respuestas", v: String(nps.length) },
        { l: "Score", v: scoreLabel },
      ]}
      viewAllHref={`/clientes/nps?clientId=${clientId}&range=todo`}
      isEmpty={nps.length === 0}
      emptyTitle="Sin respuestas NPS del cliente"
      emptyHint="Cargalas desde 'Ver todos' — alimentan el score compuesto de health."
    >
      {top.map((r) => {
        const bucket = classifyNps(r.score);
        const respondent =
          r.respondentName ?? r.respondentEmail ?? "Anónimo";
        return (
          <RowItem
            key={r.id}
            primary={`${r.score}/10 · ${respondent}`}
            secondary={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <StatusPill
                  text={BUCKET_LABEL[bucket]}
                  tone={BUCKET_TONE[bucket]}
                />
                <span
                  className="kg-t7"
                  style={{ color: "var(--kg-text-3)" }}
                >
                  {formatDateIso(r.respondedAt)}
                </span>
              </div>
            }
          />
        );
      })}
    </SectionShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes internos
// ═══════════════════════════════════════════════════════════════════════════

function SectionShell({
  title,
  stats,
  viewAllHref,
  isEmpty,
  emptyTitle,
  emptyHint,
  children,
}: {
  readonly title: string;
  readonly stats: readonly { l: string; v: string }[];
  readonly viewAllHref: string;
  readonly isEmpty: boolean;
  readonly emptyTitle: string;
  readonly emptyHint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-20)",
        overflow: "hidden",
        boxShadow: "var(--kg-shadow-amb)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 20px",
          borderBottom: "1px solid var(--kg-border-subtle)",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              color: "var(--kg-text-1)",
            }}
          >
            {title}
          </h3>
          <div style={{ display: "flex", gap: 12 }}>
            {stats.map((s, i) => (
              <span
                key={i}
                className="kg-t7"
                style={{ color: "var(--kg-text-3)" }}
              >
                {s.l}:{" "}
                <strong
                  style={{
                    color: "var(--kg-text-1)",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {s.v}
                </strong>
              </span>
            ))}
          </div>
        </div>
        <Link
          href={viewAllHref}
          className="kg-focus"
          style={{
            color: "var(--kg-accent-text)",
            fontSize: 11,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Ver todos →
        </Link>
      </div>
      <div style={{ padding: isEmpty ? 12 : 0, flex: 1 }}>
        {isEmpty ? (
          <EmptyState title={emptyTitle} hint={emptyHint} />
        ) : (
          <div>{children}</div>
        )}
      </div>
    </div>
  );
}

function RowItem({
  primary,
  secondary,
}: {
  readonly primary: React.ReactNode;
  readonly secondary?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "10px 20px",
        borderBottom: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          color: "var(--kg-text-1)",
          fontSize: 13,
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {primary}
      </div>
      {secondary && <div>{secondary}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Format helpers locales
// ═══════════════════════════════════════════════════════════════════════════

function fMoneyCur(amount: number, currency: "ARS" | "USD"): string {
  const raw = fMoney(amount);
  const prefix = currency === "USD" ? "US$" : "AR$";
  return raw.replace(/^(-?)\$/, `$1${prefix} `);
}

function formatMonth(ymd: string): string {
  try {
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-AR", {
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

function formatDateYmd(ymd: string): string {
  try {
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

function formatDateIso(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
