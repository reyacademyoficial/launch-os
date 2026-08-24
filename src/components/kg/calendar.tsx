"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// KG · Calendario mensual server-driven.
//
// Grid de 7 columnas × 6 filas (42 celdas, cubre cualquier mes con la
// semana ISO empezando en lunes). Cada día es un botón clickeable que
// dispara `onDaySelect(yyyy-mm-dd)`. Los eventos se agrupan por día en el
// server y se pasan como Map<yyyy-mm-dd, T[]>.
//
// La navegación de mes (< / >) usa `<Link>` con searchParams — el mes
// actual se pasa como prop desde la page (parseado de ?year=&month=).
// Sin estado client: el calendario es un render puro.
//
// El "detalle del día" NO vive acá — es un `<Drawer>` que renderea el
// padre cuando `onDaySelect` marca un día. Este componente solo se ocupa
// del layout del calendario.
// ═══════════════════════════════════════════════════════════════════════════

export interface KgCalendarEvent {
  readonly id: string;
  readonly label: string;
  readonly tone?: string;
}

interface KgCalendarProps {
  /** Año 4 dígitos del mes visible. */
  readonly year: number;
  /** Mes 1..12 del mes visible. */
  readonly month: number;
  /** Base path — se le agrega ?year=&month= para nav. */
  readonly baseHref: string;
  /** Otros searchParams que hay que preservar al cambiar de mes. */
  readonly preserveParams?: Record<string, string | null>;
  /** Eventos agrupados por yyyy-mm-dd. */
  readonly eventsByDate: ReadonlyMap<string, readonly KgCalendarEvent[]>;
  /** Handler client para abrir el drawer del día. */
  readonly onDaySelect: (dateKey: string) => void;
  /** Slot arriba a la derecha (ej. botón "Nueva sesión"). */
  readonly trailingAction?: ReactNode;
}

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

const MONTH_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

export function KgCalendar({
  year,
  month,
  baseHref,
  preserveParams,
  eventsByDate,
  onDaySelect,
  trailingAction,
}: KgCalendarProps) {
  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);
  const today = new Date();
  const todayKey = toDateKey(
    today.getFullYear(),
    today.getMonth() + 1,
    today.getDate(),
  );

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  function buildHref(y: number, m: number): string {
    const params = new URLSearchParams();
    if (preserveParams) {
      for (const [k, v] of Object.entries(preserveParams)) {
        if (v != null && v.length > 0) params.set(k, v);
      }
    }
    params.set("year", String(y));
    params.set("month", String(m).padStart(2, "0"));
    return `${baseHref}?${params.toString()}`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            href={buildHref(prev.year, prev.month)}
            className="kg-focus"
            style={navBtn}
            aria-label="Mes anterior"
          >
            ‹
          </Link>
          <div
            className="kg-t4"
            style={{
              color: "var(--kg-text-1)",
              fontWeight: 700,
              minWidth: 180,
              textAlign: "center",
            }}
          >
            {MONTH_LABELS[month - 1]} {year}
          </div>
          <Link
            href={buildHref(next.year, next.month)}
            className="kg-focus"
            style={navBtn}
            aria-label="Mes siguiente"
          >
            ›
          </Link>
          <Link
            href={buildHref(today.getFullYear(), today.getMonth() + 1)}
            className="kg-focus"
            style={{ ...navBtn, padding: "6px 12px" }}
          >
            Hoy
          </Link>
        </div>
        {trailingAction}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
        }}
      >
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="kg-t7"
            style={{
              padding: "6px 8px",
              color: "var(--kg-text-3)",
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            {label}
          </div>
        ))}

        {cells.map((cell) => {
          const events = eventsByDate.get(cell.dateKey) ?? [];
          const isToday = cell.dateKey === todayKey;
          const isCurrentMonth = cell.month === month;
          return (
            <button
              key={cell.dateKey}
              type="button"
              onClick={() => onDaySelect(cell.dateKey)}
              className="kg-focus"
              style={{
                textAlign: "left",
                minHeight: 92,
                padding: "6px 8px",
                borderRadius: "var(--kg-r-8)",
                background: isCurrentMonth
                  ? "var(--kg-surface-2-solid)"
                  : "transparent",
                border: `1px solid ${
                  isToday ? "var(--kg-accent-500)" : "var(--kg-border-subtle)"
                }`,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                opacity: isCurrentMonth ? 1 : 0.45,
                transition: "background var(--kg-dur) var(--kg-ease)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  color: isToday
                    ? "var(--kg-accent-text)"
                    : "var(--kg-text-2)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span>{cell.day}</span>
                {events.length > 0 && (
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: "var(--kg-accent-500)",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {events.length}
                  </span>
                )}
              </div>
              {events.slice(0, 3).map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10,
                    color: "var(--kg-text-2)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={ev.label}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      background: ev.tone ?? "var(--kg-neutral-500)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {ev.label}
                  </span>
                </div>
              ))}
              {events.length > 3 && (
                <div
                  className="kg-t7"
                  style={{ color: "var(--kg-text-3)" }}
                >
                  +{events.length - 3} más
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers puros — testeables sin renderizar.
// ═══════════════════════════════════════════════════════════════════════════

interface MonthCell {
  readonly year: number;
  readonly month: number; // 1..12
  readonly day: number; // 1..31
  readonly dateKey: string; // yyyy-mm-dd
}

/**
 * Construye 42 celdas (6 semanas × 7 días) empezando por el lunes anterior
 * o igual al día 1 del mes solicitado. Cubre cualquier mes.
 */
export function buildMonthCells(year: number, month: number): MonthCell[] {
  // Date en JS es zero-indexed en month.
  const firstOfMonth = new Date(year, month - 1, 1);
  // getDay: 0=domingo, 1=lunes … 6=sábado. Queremos semana empezando en
  // lunes → convertimos a 0=lunes … 6=domingo.
  const firstDow = (firstOfMonth.getDay() + 6) % 7;

  const start = new Date(year, month - 1, 1 - firstDow);
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      dateKey: toDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate()),
    });
  }
  return cells;
}

export function toDateKey(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { readonly year: number; readonly month: number } {
  const raw = month + delta;
  if (raw < 1) return { year: year - 1, month: 12 + raw };
  if (raw > 12) return { year: year + 1, month: raw - 12 };
  return { year, month: raw };
}

const navBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 32,
  height: 32,
  padding: "0 8px",
  borderRadius: 999,
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
};
