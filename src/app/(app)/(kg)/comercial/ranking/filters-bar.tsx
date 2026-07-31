"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Filtros del leaderboard. La fuente de verdad es la URL — los queries del
 * server component leen los searchParams. Eso permite compartir/bookmarkear
 * filtros y que el back-button funcione natural.
 *
 * useTransition + router.push: el cambio dispara un re-fetch del server y
 * mantiene el form interactivo mientras llega la respuesta.
 */
export function FiltersBar({
  launches,
  initial,
}: {
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly initial: {
    launchId: string;
    dateFrom: string;
    dateTo: string;
  };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(patch: Partial<typeof initial>) {
    const next = new URLSearchParams(params.toString());
    const fresh = { ...initial, ...patch };
    if (fresh.launchId) next.set("launchId", fresh.launchId);
    else next.delete("launchId");
    if (fresh.dateFrom) next.set("from", fresh.dateFrom);
    else next.delete("from");
    if (fresh.dateTo) next.set("to", fresh.dateTo);
    else next.delete("to");

    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `?${qs}` : "?");
    });
  }

  function clearAll() {
    startTransition(() => {
      router.push("?");
    });
  }

  const isFiltered = !!(
    initial.launchId ||
    initial.dateFrom ||
    initial.dateTo
  );

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <label
          htmlFor="lb-launch"
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
        >
          Lanzamiento
        </label>
        <select
          id="lb-launch"
          value={initial.launchId}
          onChange={(e) => update({ launchId: e.target.value })}
          disabled={pending}
          style={{
            ...inputStyle,
            minWidth: 200,
            opacity: pending ? 0.7 : 1,
          }}
        >
          <option value="">Todos</option>
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <label
          htmlFor="lb-from"
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
        >
          Desde
        </label>
        <input
          id="lb-from"
          type="date"
          value={initial.dateFrom}
          onChange={(e) => update({ dateFrom: e.target.value })}
          disabled={pending}
          style={{ ...inputStyle, opacity: pending ? 0.7 : 1 }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <label
          htmlFor="lb-to"
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
        >
          Hasta
        </label>
        <input
          id="lb-to"
          type="date"
          value={initial.dateTo}
          onChange={(e) => update({ dateTo: e.target.value })}
          disabled={pending}
          style={{ ...inputStyle, opacity: pending ? 0.7 : 1 }}
        />
      </div>
      {isFiltered && (
        <button
          type="button"
          onClick={clearAll}
          disabled={pending}
          className="kg-focus"
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            background: "transparent",
            border: "1px solid var(--kg-border-subtle)",
            color: "var(--kg-text-2)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12.5,
};
