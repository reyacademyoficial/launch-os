"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

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

  const isFiltered = !!(initial.launchId || initial.dateFrom || initial.dateTo);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface/40 p-4">
      <div className="flex flex-col">
        <label
          htmlFor="lb-launch"
          className="mb-1 text-xs font-medium text-fg-muted"
        >
          Lanzamiento
        </label>
        <Select
          id="lb-launch"
          value={initial.launchId}
          onChange={(e) => update({ launchId: e.target.value })}
          disabled={pending}
          className="!w-auto !min-w-[180px]"
        >
          <option value="">Todos</option>
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col">
        <label
          htmlFor="lb-from"
          className="mb-1 text-xs font-medium text-fg-muted"
        >
          Desde
        </label>
        <input
          id="lb-from"
          type="date"
          value={initial.dateFrom}
          onChange={(e) => update({ dateFrom: e.target.value })}
          disabled={pending}
          className="rounded-md border border-border bg-input px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div className="flex flex-col">
        <label
          htmlFor="lb-to"
          className="mb-1 text-xs font-medium text-fg-muted"
        >
          Hasta
        </label>
        <input
          id="lb-to"
          type="date"
          value={initial.dateTo}
          onChange={(e) => update({ dateTo: e.target.value })}
          disabled={pending}
          className="rounded-md border border-border bg-input px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      {isFiltered && (
        <Button
          type="button"
          variant="secondary"
          onClick={clearAll}
          disabled={pending}
          className="!px-3 !py-2 !text-xs"
        >
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
