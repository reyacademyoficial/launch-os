"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// Filtros persistentes de listado — Fase H · task #6.
//
// Los filtros de las páginas de academia son URL-based (searchParams). Esto
// componente-cliente:
//   1) Al primer mount, si localStorage tiene una query guardada distinta
//      de la actual → router.replace hacia el URL con los filtros
//      restaurados.
//   2) Cada vez que cambia el URL, escribe el search string al localStorage
//      (o borra la key si el filtro está en su valor default).
//
// Uso: `<PersistentFilterSync storageKey="academia:filters:estudiantes" />`
// dropeado como sibling del listado (dentro del server component).
//
// Este componente NO renderiza nada visible.
//
// ⚠ Sin SSR — el estado del filtro que ve el server puede diferir del que
// el user tenía guardado; el replace corrige en client. Puede haber un
// pequeño flash del listado default antes del rerender.
// ═══════════════════════════════════════════════════════════════════════════

export function PersistentFilterSync({
  storageKey,
}: {
  readonly storageKey: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const restoredRef = useRef(false);

  // 1) Restauración one-shot al primer mount.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved == null) return;
      if (saved === currentSearch) return;
      // Solo restaurar si el URL actual está "en default" (sin params).
      // Evita pisar filtros que el user pegó manualmente en el URL.
      if (currentSearch.length === 0 && saved.length > 0) {
        router.replace(`?${saved}`);
      }
    } catch {
      // ignorar
    }
    // Solo dispara una vez, en mount inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Persistir al cambiar searchParams.
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      if (currentSearch.length === 0) {
        window.localStorage.removeItem(storageKey);
      } else {
        window.localStorage.setItem(storageKey, currentSearch);
      }
    } catch {
      // ignorar
    }
  }, [currentSearch, storageKey]);

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Botón "Limpiar filtros" — resetea la URL a base y borra la key de storage.
// ═══════════════════════════════════════════════════════════════════════════

export function ClearFiltersButton({
  storageKey,
  basePath,
}: {
  readonly storageKey: string;
  readonly basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasFilters = searchParams.toString().length > 0;

  if (!hasFilters) return null;

  function handleClick() {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignorar
    }
    router.replace(basePath);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="kg-focus"
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        background: "transparent",
        border: "1px solid var(--kg-border-subtle)",
        color: "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Limpiar filtros
    </button>
  );
}
