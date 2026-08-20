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
import { Drawer } from "./drawer";

/**
 * KG · Filtros de página (mobile bottom-sheet + desktop lateral drawer).
 *
 * Los filtros de cada página (PeriodPicker, pills de estado, etc.) NO se
 * renderizan inline. Se registran vía `<KgPageFilters>` en un contexto global
 * y aparecen únicamente cuando el usuario abre el sheet/drawer desde el botón
 * "Filtros" en el ContextBar.
 *
 * Motivo: liberar espacio vertical del layout para que la tabla se vea
 * completa sin scroll de página.
 *
 * BREAKPOINTS
 *   - Mobile (<md): bottom-sheet — desliza desde abajo, 85dvh máx.
 *   - Desktop (≥md): lateral drawer derecho, 400px de ancho.
 *   Los dos coexisten en el árbol; Tailwind los hidea según viewport.
 *
 * Multi-registro: una página puede tener varios bloques de filtros. Cada
 * `<KgPageFilters>` obtiene su `id` (via `useId`) y aporta al `activeCount`
 * total que la button badge muestra.
 *
 * Split de contexts (actions/state) para que las páginas que solo LLAMAN a
 * los setters no re-rendericen cuando el sheet abre/cierra.
 */

export interface FilterGroup {
  readonly id: string;
  readonly node: ReactNode;
  /**
   * Cuántos filtros DEL GRUPO están activos (no en su valor default). Sumado
   * de todos los grupos alimenta el badge del botón "Filtros".
   */
  readonly activeCount: number;
}

/**
 * Tabs de módulo (Dashboard, Proyectos, Tareas, …). Se registran desde el
 * layout de cada módulo y se renderizan pegadas al Topbar — así el header
 * concentra "en qué módulo estoy" y "qué sección" sin ocupar una franja
 * separada. Ver KgModuleNav / KgTopbar.
 */
export interface ModuleTabItem {
  readonly href: string;
  readonly label: string;
}

export interface PageMenuState {
  readonly open: boolean;
  readonly filterGroups: readonly FilterGroup[];
  /** Tabs del módulo activo, o `null` si el layout no registró ninguna. */
  readonly moduleTabs: readonly ModuleTabItem[] | null;
}

export interface PageMenuActions {
  readonly openSheet: () => void;
  readonly closeSheet: () => void;
  /** `null` desregistra el grupo. */
  readonly setFilterGroup: (
    id: string,
    node: ReactNode | null,
    activeCount: number,
  ) => void;
  /** `null` desregistra las tabs del módulo. */
  readonly setModuleTabs: (tabs: readonly ModuleTabItem[] | null) => void;
}

const StateCtx = createContext<PageMenuState | null>(null);
const ActionsCtx = createContext<PageMenuActions | null>(null);

export function PageMenuProvider({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [filterGroups, setFilterGroupsState] = useState<readonly FilterGroup[]>([]);
  const [moduleTabs, setModuleTabsState] = useState<
    readonly ModuleTabItem[] | null
  >(null);

  const actions = useMemo<PageMenuActions>(
    () => ({
      openSheet: () => setOpen(true),
      closeSheet: () => setOpen(false),
      setFilterGroup: (id, node, activeCount) => {
        setFilterGroupsState((prev) => {
          const rest = prev.filter((g) => g.id !== id);
          return node == null ? rest : [...rest, { id, node, activeCount }];
        });
      },
      setModuleTabs: (tabs) => setModuleTabsState(tabs),
    }),
    [],
  );

  const state = useMemo<PageMenuState>(
    () => ({ open, filterGroups, moduleTabs }),
    [open, filterGroups, moduleTabs],
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
 *
 * `activeCount` = cuántos filtros del grupo tienen valor distinto al default.
 * Alimenta el badge del botón "Filtros".
 */
export function useRegisterPageFilters(
  node: ReactNode | null,
  activeCount: number = 0,
): void {
  const { setFilterGroup } = usePageMenuActions();
  const id = useId();
  useEffect(() => {
    setFilterGroup(id, node, activeCount);
    return () => setFilterGroup(id, null, 0);
  }, [id, node, activeCount, setFilterGroup]);
}

/**
 * Envuelve un bloque de filtros de página. NO se renderiza inline (ni mobile
 * ni desktop) — el bloque se registra en el sheet/drawer que se dispara
 * desde el botón "Filtros" del ContextBar.
 *
 * `activeCount` = cuántos filtros del bloque tienen valor no-default (para
 * el badge del botón).
 *
 * Uso típico:
 *
 *   <KgPageFilters activeCount={statusActive + priorityActive}>
 *     <KgParamPills ... />
 *     <RangePills ... />
 *   </KgPageFilters>
 */
export function KgPageFilters({
  children,
  activeCount = 0,
}: {
  readonly children: ReactNode;
  readonly activeCount?: number;
}) {
  useRegisterPageFilters(children, activeCount);
  return null;
}

/**
 * Registra las tabs del módulo activo. Se limpia al desmontar (cambio de
 * módulo → layout viejo desmontar → tabs vuelven a null hasta que el
 * layout nuevo se monte y las registre).
 */
export function useRegisterModuleTabs(
  tabs: readonly ModuleTabItem[] | null,
): void {
  const { setModuleTabs } = usePageMenuActions();
  useEffect(() => {
    setModuleTabs(tabs);
    return () => setModuleTabs(null);
  }, [tabs, setModuleTabs]);
}

/**
 * Overlay de filtros — se dispara desde el botón "Filtros" del ContextBar.
 * En mobile es un bottom-sheet (KgBottomSheet ya trae `md:hidden`). En
 * desktop es un Drawer lateral derecho (con `overlayClassName="max-md:hidden"`
 * para que no aparezca en mobile).
 */
export function PageMenuSheet() {
  const state = usePageMenuState();
  const actions = usePageMenuActions();

  const body =
    state.filterGroups.length === 0 ? (
      <div style={{ color: "var(--kg-text-3)" }}>Sin filtros</div>
    ) : (
      state.filterGroups.map((g) => (
        <div
          key={g.id}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {g.node}
        </div>
      ))
    );

  return (
    <>
      {/* Mobile — bottom sheet. KgBottomSheet trae `md:hidden` propio. */}
      <KgBottomSheet
        open={state.open}
        onClose={actions.closeSheet}
        ariaLabel="Filtros de la página"
      >
        {body}
      </KgBottomSheet>

      {/* Desktop — lateral drawer derecho. `max-md:hidden` esconde en mobile. */}
      <Drawer
        open={state.open}
        onClose={actions.closeSheet}
        title="Filtros"
        subtitle="Se aplican al instante al elegir"
        width={400}
        overlayClassName="max-md:hidden"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {body}
        </div>
      </Drawer>
    </>
  );
}
