"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { KgBottomSheet } from "./bottom-sheet";

/**
 * KG · Filtros mobile.
 *
 * En mobile los filtros de cada página (PeriodPicker, pills de estado, etc.)
 * no caben cómodamente en pantalla. Cada bloque de filtros de la página se
 * envuelve con `<KgPageFilters>` — en desktop se renderiza inline (via
 * `md:contents`), en mobile queda oculto de la vista principal y aparece en
 * un bottom-sheet que se dispara desde el botón "Filtros" de la topbar.
 *
 * Multi-registro: una página puede tener varios bloques de filtros en zonas
 * distintas (ej. bancos tiene pills de estado arriba + range pills abajo).
 * Cada `<KgPageFilters>` obtiene su propio `id` (via `useId`) y el sheet
 * apila todos los bloques en el orden en que se registraron.
 *
 * Split de contexts (actions/state) para que las páginas que solo LLAMAN a los
 * setters no re-rendericen cuando el sheet abre/cierra. El sheet y el botón
 * consumen `usePageMenuState`; las páginas usan `usePageMenuActions`, cuyo
 * valor es estable (memoizado con deps vacías).
 */

export interface FilterGroup {
  readonly id: string;
  readonly node: ReactNode;
}

export interface PageMenuState {
  readonly open: boolean;
  readonly filterGroups: readonly FilterGroup[];
}

export interface PageMenuActions {
  readonly openSheet: () => void;
  readonly closeSheet: () => void;
  /** `null` desregistra el grupo. */
  readonly setFilterGroup: (id: string, node: ReactNode | null) => void;
}

const StateCtx = createContext<PageMenuState | null>(null);
const ActionsCtx = createContext<PageMenuActions | null>(null);

export function PageMenuProvider({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [filterGroups, setFilterGroupsState] = useState<readonly FilterGroup[]>([]);

  const actions = useMemo<PageMenuActions>(
    () => ({
      openSheet: () => setOpen(true),
      closeSheet: () => setOpen(false),
      setFilterGroup: (id, node) => {
        setFilterGroupsState((prev) => {
          const rest = prev.filter((g) => g.id !== id);
          return node == null ? rest : [...rest, { id, node }];
        });
      },
    }),
    [],
  );

  const state = useMemo<PageMenuState>(
    () => ({ open, filterGroups }),
    [open, filterGroups],
  );

  return (
    <ActionsCtx.Provider value={actions}>
      <StateCtx.Provider value={state}>{children}</StateCtx.Provider>
    </ActionsCtx.Provider>
  );
}

export function usePageMenuActions(): PageMenuActions {
  const ctx = useContext(ActionsCtx);
  if (!ctx)
    throw new Error("usePageMenuActions debe usarse dentro de <PageMenuProvider>");
  return ctx;
}

export function usePageMenuState(): PageMenuState {
  const ctx = useContext(StateCtx);
  if (!ctx)
    throw new Error("usePageMenuState debe usarse dentro de <PageMenuProvider>");
  return ctx;
}

/**
 * Registra un nodo de filtros de la página actual bajo un `id` propio. Se
 * limpia al desmontar. Podés llamarla varias veces por página (cada llamada
 * con su propio `useId`) — todos los grupos aparecen apilados en el sheet.
 */
export function useRegisterPageFilters(node: ReactNode | null): void {
  const { setFilterGroup } = usePageMenuActions();
  const id = useId();
  useEffect(() => {
    setFilterGroup(id, node);
    return () => setFilterGroup(id, null);
  }, [id, node, setFilterGroup]);
}

/**
 * Envuelve un bloque de filtros de página: en desktop renderiza inline
 * (via `md:contents`), en mobile lo esconde de la vista principal y lo
 * registra como grupo en el bottom-sheet. Un solo wrapper resuelve las dos
 * mitades del patrón — la página no necesita saber nada del sheet.
 *
 * Uso típico:
 *
 *   <KgPageFilters>
 *     <KgParamPills ... />
 *     <RangePills ... />
 *   </KgPageFilters>
 */
export function KgPageFilters({ children }: { readonly children: ReactNode }) {
  useRegisterPageFilters(children);
  return <div className="hidden md:contents">{children}</div>;
}

/**
 * Sheet visible mobile-only. Se dispara desde el botón "Filtros" de la
 * `KgTopbar` (que solo aparece cuando hay filtros registrados). El módulo
 * nav vive fuera (carrusel horizontal en `KgModuleNav`), no dentro del sheet.
 */
export function PageMenuSheet() {
  const state = usePageMenuState();
  const actions = usePageMenuActions();

  return (
    <KgBottomSheet
      open={state.open}
      onClose={actions.closeSheet}
      ariaLabel="Filtros de la página"
    >
      {state.filterGroups.length === 0 ? (
        <div style={{ color: "var(--kg-text-3)" }}>Sin filtros</div>
      ) : (
        state.filterGroups.map((g) => (
          <div key={g.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {g.node}
          </div>
        ))
      )}
    </KgBottomSheet>
  );
}
