"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import type { NotificationRow } from "@/lib/notifications/types";

/**
 * Campanita del shell. Una sola instancia para ambos shells (equipo y
 * cliente) — el filtro de qué se muestra lo hace la RLS server-side, así
 * que el componente es agnóstico de rol.
 *
 * Comportamiento:
 *   - Al montar: pide el unread-count y arranca un polling de 30s.
 *   - Al click: abre panel y pide las últimas 20 (fetch on-demand para no
 *     traer rows cuando nadie las mira).
 *   - Click en un item: marca leída (server action, optimistic) y, si tiene
 *     `launchHref`, navega.
 *   - "Marcar todas leídas": una sola UPDATE server-side; el contador
 *     baja a 0 sin esperar el próximo poll.
 *
 * El intervalo de 30s es un trade-off: bajo lo suficiente para que un
 * evento se vea "ya" sin spamear endpoints. Si crece el costo, se cambia
 * a Supabase Realtime — el endpoint queda como fallback.
 */
const POLL_INTERVAL_MS = 30_000;

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { count?: number };
      setCount(typeof data.count === "number" ? data.count : 0);
    } catch {
      // Silencioso — la campanita no debe romper el shell si el endpoint
      // está caído.
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { rows?: NotificationRow[] };
        setItems(data.rows ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // El fetch corre fuera del cuerpo síncrono del effect — un `void
    // fetchCount()` directo dispararía la regla `set-state-in-effect` porque
    // el setState terminaría ejecutándose como reentrante al render. El
    // timeout(0) lo desacopla a la próxima tick.
    const initial = window.setTimeout(() => void fetchCount(), 0);
    const id = window.setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, [fetchCount]);

  // Cierra con click fuera y Esc.
  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      void fetchItems();
    }
    setOpen((v) => !v);
  }

  function handleItemClick(n: NotificationRow) {
    if (n.read_at) return;
    // Optimistic: bajamos el contador local; el server action queda en flight.
    setCount((c) => Math.max(0, c - 1));
    setItems((rows) =>
      rows.map((r) =>
        r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r,
      ),
    );
    startTransition(async () => {
      await markNotificationRead(n.id);
      void fetchCount();
    });
  }

  function handleMarkAll() {
    setCount(0);
    setItems((rows) =>
      rows.map((r) =>
        r.read_at ? r : { ...r, read_at: new Date().toISOString() },
      ),
    );
    startTransition(async () => {
      await markAllNotificationsRead();
      void fetchCount();
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Notificaciones${count > 0 ? ` (${count} sin leer)` : ""}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <BellIcon />
        {count > 0 && (
          <span
            className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-bg"
            aria-hidden
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-md border border-border bg-bg-elevated shadow-card"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-fg">Notificaciones</span>
            {count > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="text-xs text-fg-muted hover:text-fg"
              >
                Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-fg-subtle">
                Cargando…
              </p>
            )}
            {!loading && items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-fg-subtle">
                Sin notificaciones.
              </p>
            )}
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={
                      "block w-full px-3 py-2 text-left transition-colors hover:bg-surface " +
                      (n.read_at ? "" : "bg-accent/5")
                    }
                  >
                    <div className="flex items-baseline gap-2">
                      <SeverityDot severity={n.severity} />
                      <span className="flex-1 truncate text-sm font-medium text-fg">
                        {n.title}
                      </span>
                      {!n.read_at && (
                        <span className="text-[10px] uppercase tracking-wide text-accent">
                          nuevo
                        </span>
                      )}
                    </div>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-fg-subtle">
                      {formatRelative(n.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function SeverityDot({ severity }: { readonly severity: NotificationRow["severity"] }) {
  const cls =
    severity === "error"
      ? "bg-error"
      : severity === "warning"
        ? "bg-warning"
        : "bg-accent";
  return (
    <span
      aria-hidden
      className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
    />
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/**
 * Formato relativo simple ("hace 5 min", "hace 2 h", "hace 3 días").
 * Sin depender de `Intl.RelativeTimeFormat` por compat — el panel renderea
 * en client y el rendering depende del navegador del usuario.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} ${d === 1 ? "día" : "días"}`;
  return new Date(iso).toLocaleDateString();
}
