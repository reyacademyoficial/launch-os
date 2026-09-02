"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

// ═══════════════════════════════════════════════════════════════════════════
// KG · Kanban. Primitiva de tablero: columnas con header + contador, cards
// arrastrables y drop-zone por columna.
//
// POR QUÉ EXISTE
// El design system no tenía NINGUNA primitiva de board. El único tablero del
// producto (`dashboard/leads/kanban-board.tsx`) se armó a mano con tokens
// viejos: `bg-surface/40`, `border-accent`, `w-72`, y su propio manejo de
// `dragOverCol`. Esta primitiva se derivó leyendo ese consumidor —no al
// revés—, así que su API es exactamente lo que ese board necesita y nada más.
//
// ───────────────────────────────────────────────────────────────────────────
// DECISIÓN 1 · CONTROLADA (el dato vive en el caller, siempre)
// ───────────────────────────────────────────────────────────────────────────
// La primitiva NO guarda los items. Recibe `items` planos + `columnOf` y
// bucketea en cada render; mover una card es un AVISO (`onMove`), nunca una
// mutación local. Mismo criterio que la selección de `KgDataTable` (ver su
// cabecera), y acá el motivo es todavía más fuerte:
//
//   - El consumidor mueve leads con `useOptimistic`. El setter de
//     `useOptimistic` SOLO se puede llamar dentro de un `startTransition` del
//     scope del caller, y su valor se re-deriva del prop en cada render que
//     llega del server. Si el board guardara los items adentro, tendría que
//     re-adoptar el prop en cada revalidación → `useEffect` + `setState`, que
//     es exactamente lo que `react-hooks/set-state-in-effect` prohíbe en este
//     repo (regla en ERROR).
//   - El caller ya filtra client-side (búsqueda + setter) ANTES de bucketear.
//     Una copia interna quedaría desincronizada del filtro.
//
// Lo único que SÍ es estado interno es el estado transitorio de interacción
// —qué columna está en hover de drop, qué card está tomada por teclado, cuál
// se está arrastrando— porque no sobrevive a la interacción ni le sirve a
// nadie afuera.
//
// GATE DE PERMISOS: es la PRESENCIA de `onMove` la que habilita el drag, el
// drop y el teclado (igual que `selection` en KgDataTable). Un solo concepto
// en vez de `canEdit` + `onMove` redundantes: `onMove={canEdit ? fn : undefined}`.
//
// ───────────────────────────────────────────────────────────────────────────
// DECISIÓN 2 · DRAG & DROP HTML5 NATIVO + GRAB MODE POR TECLADO
// ───────────────────────────────────────────────────────────────────────────
// Se mantiene HTML5 nativo (`draggable` + dataTransfer "text/plain" con el id)
// tal como estaba: sin dependencias nuevas, y las cards son livianas.
//
// El teclado SÍ era barato, así que está implementado (no documentado como
// pendiente): con foco en una card, Espacio/Enter la "toma", ←/→ la mueven a
// la columna anterior/siguiente, Escape suelta. Cada paso se anuncia en una
// región `aria-live`.
//
// Dos detalles que hacen que funcione de verdad:
//   1. Las cards contienen botones propios (abrir venta, editar, borrar). El
//      handler sólo atiende teclas cuando `e.target === e.currentTarget`, o
//      sea con el foco en la card misma — si no, un Enter sobre "Borrar"
//      tomaría la tarjeta en vez de borrar.
//   2. Al moverse, la card se desmonta de una columna y se monta en otra: el
//      foco se perdería. Se restituye desde el `ref` callback del nodo nuevo
//      (`refocusRef`), no desde un `useEffect` — el efecto correría antes de
//      que el update optimista del caller haya reubicado la card.
//
// Cada card es un tab stop (`tabIndex={0}`). Con muchas cards eso alarga el
// recorrido de Tab; el patrón fino sería roving tabindex con ↑/↓ dentro de la
// columna. No se hizo porque las cards YA contienen botones tabulables (venta,
// editar, borrar) y un roving parcial confunde más de lo que ayuda. Queda
// anotado como el próximo paso de a11y, no como algo resuelto.
//
// NO CUBIERTO (a propósito, y sin fingir que está): TOUCH. HTML5 DnD no emite
// `dragstart` con eventos táctiles en ningún navegador móvil; en un teléfono
// la card no se arrastra. Es la misma limitación que ya tenía el board a mano
// —no es una regresión— y arreglarla implica un sensor de pointer events o
// una librería. Cuando se aborde, la salida natural es un menú "Mover a…" por
// card, que además le daría al touch la misma ruta que hoy tiene el teclado.
//
// ───────────────────────────────────────────────────────────────────────────
// DECISIÓN 3 · 390px = CARRUSEL CON SCROLL-SNAP
// ───────────────────────────────────────────────────────────────────────────
// Cinco columnas de 288px no entran en 390px. El board pasa a ser un carrusel
// horizontal con `scroll-snap` por columna: cada columna mide `86vw` (tope
// 320px), así queda visible una franja de la siguiente —la misma señal
// implícita de "hay más" que usa el carrusel de pills de `module-nav.tsx`— y
// el snap deja cada columna encuadrada al soltar el dedo. En `md+` vuelve al
// ancho fijo de siempre (288px = el `w-72` original) y el snap se apaga: en
// desktop varias columnas entran juntas y encuadrar una sola sería molesto.
//
// El scroll vive en el track, no en el body, así que la página no se ensancha.
// A diferencia de `.kg-tabs`, la scrollbar NO se oculta: en un board es la
// única pista de cuánto queda a la derecha.
//
// Tailwind aparece SÓLO donde hace falta una media query (anchos y toggle del
// snap). Todo el resto es inline style + vars `--kg-*`, según la doctrina.
//
// ───────────────────────────────────────────────────────────────────────────
// COLOR
// ───────────────────────────────────────────────────────────────────────────
// La columna en hover de drop y la card tomada se marcan con el HALO DE
// ACENTO (`--kg-accent-halo` + `--kg-border-accent`), no con un tono
// semántico: estar por soltar algo es un modo de la UI, no un estado del
// dato. Mismo razonamiento que la fila seleccionada de `KgDataTable`. El
// estado del dato, si hay que mostrarlo, va adentro de la card con
// `StatusPill`/`StateDot`.
//
// ───────────────────────────────────────────────────────────────────────────
// EJEMPLO REAL — forma de datos de `dashboard/leads/kanban-board.tsx`
// ───────────────────────────────────────────────────────────────────────────
//
//   "use client";
//   const [optimistic, setOptimistic] = useOptimistic(
//     leads,
//     (current, a: { id: string; status: LeadStatus }) =>
//       current.map((l) => (l.id === a.id ? { ...l, status: a.status } : l)),
//   );
//   const [, startTransition] = useTransition();
//   const filtered = optimistic.filter(matchesQuery);   // filtro client-side
//
//   <KgKanban
//     items={filtered}
//     itemKey={(l) => l.id}
//     columnOf={(l) => l.status}                        // ← infiere ColId
//     itemLabel={(l) => l.name}                         // sólo para anuncios
//     columns={LEAD_STATUSES.map((s) => ({
//       id: s,
//       label: LEAD_STATUS_LABELS[s],
//     }))}
//     emptyText="Sin leads"
//     ariaLabel="Pipeline de leads"
//     toolbar={<FiltrosDelBoard />}
//     // Sin permiso de edición se pasa `undefined`: board de sólo lectura.
//     onMove={canEdit
//       ? (leadId, status) => {
//           startTransition(async () => {
//             setOptimistic({ id: leadId, status });
//             await moveAction(leadId, status);
//           });
//         }
//       : undefined}
//     renderItem={(lead) => <ContenidoDeLaCard lead={lead} />}
//   />
//
// `columnOf` devuelve `LeadStatus`, así que `ColId` se infiere y el `status`
// que llega a `onMove` YA viene tipado como `LeadStatus` — sin guardas de
// runtime ni casts en el consumidor.
//
// ───────────────────────────────────────────────────────────────────────────
// FUERA DE ALCANCE (lo que el board real resuelve por su cuenta)
// ───────────────────────────────────────────────────────────────────────────
//   - El CONTENIDO de la card: la primitiva dibuja el chasis (borde, fondo,
//     padding, asa de arrastre) y `renderItem` pone adentro lo que sea.
//   - Reordenar DENTRO de una columna: el board de leads no tiene orden
//     manual (el orden sale de la query), así que no se modela drop entre
//     cards. Si algún día hace falta, entra como `onReorder` aparte.
//   - Scroll interno por columna / `fillHeight`: hoy scrollea la página, igual
//     que antes. No se agrega hasta que un consumidor lo pida.
//   - Items cuyo `columnOf` no matchea ninguna columna declarada: se omiten en
//     silencio. El caller define el universo de columnas.
// ═══════════════════════════════════════════════════════════════════════════

export interface KgKanbanColumn<ColId extends string = string> {
  readonly id: ColId;
  /** Título de la columna. También se usa en los anuncios de teclado. */
  readonly label: string;
  /**
   * Reemplaza el contador del header. Por defecto se muestra la cantidad de
   * items de la columna.
   */
  readonly badge?: ReactNode;
  /** Texto de columna vacía. Cae a `emptyText` del board. */
  readonly emptyText?: string;
}

export interface KgKanbanProps<Item, ColId extends string = string> {
  readonly columns: ReadonlyArray<KgKanbanColumn<ColId>>;
  /** Items YA filtrados por el caller. La primitiva sólo bucketea. */
  readonly items: ReadonlyArray<Item>;
  /** Id estable del item — viaja en el dataTransfer y es el key del nodo. */
  readonly itemKey: (item: Item) => string;
  /** A qué columna pertenece el item HOY (según el estado del caller). */
  readonly columnOf: (item: Item) => ColId;
  /** Contenido de la card. El chasis lo pone la primitiva. */
  readonly renderItem: (item: Item) => ReactNode;
  /**
   * Aviso de movimiento. Su PRESENCIA habilita drag, drop y teclado; sin él
   * el board es de sólo lectura. No se llama si la columna destino es la
   * actual.
   */
  readonly onMove?: (itemId: string, toColumnId: ColId, item: Item) => void;
  /** Nombre del item para los anuncios de teclado ("Juan tomado"). */
  readonly itemLabel?: (item: Item) => string;
  /** Texto por defecto de columna vacía. */
  readonly emptyText?: string;
  /** Slot sobre el track — filtros, búsqueda, contadores. */
  readonly toolbar?: ReactNode;
  /** aria-label del tablero. */
  readonly ariaLabel?: string;
}

/** Región sólo para lectores de pantalla (anuncios del grab mode). */
const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function KgKanban<Item, ColId extends string = string>({
  columns,
  items,
  itemKey,
  columnOf,
  renderItem,
  onMove,
  itemLabel,
  emptyText = "Sin elementos",
  toolbar,
  ariaLabel = "Tablero",
}: KgKanbanProps<Item, ColId>) {
  const interactive = onMove != null;

  // Estado TRANSITORIO de interacción. Nada de esto es dato: no sobrevive al
  // gesto ni le sirve al caller. Ver "DECISIÓN 1" en la cabecera.
  const [dragOverColumnId, setDragOverColumnId] = useState<ColId | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Id de la card a re-enfocar cuando el caller la reubique. Va en un ref y
  // no en state: el foco se restituye desde el `ref` callback del nodo NUEVO
  // (la card se desmonta al cambiar de columna). Un `useEffect` correría con
  // el árbol viejo todavía montado.
  const refocusRef = useRef<string | null>(null);

  // ─── Bucketing (en cada render, desde los props) ─────────────────────────
  const buckets = new Map<ColId, Item[]>();
  for (const col of columns) buckets.set(col.id, []);
  for (const item of items) {
    const bucket = buckets.get(columnOf(item));
    // Item de una columna no declarada: se omite. El caller manda.
    if (bucket) bucket.push(item);
  }
  const indexByColumnId = new Map<ColId, number>(
    columns.map((c, i) => [c.id, i] as const),
  );
  const itemsById = new Map<string, Item>(
    items.map((i) => [itemKey(i), i] as const),
  );

  function labelOf(item: Item): string {
    return itemLabel?.(item) ?? "Tarjeta";
  }

  /**
   * Único camino de salida hacia el caller. Filtra los no-movimientos (misma
   * columna, columna inexistente, item desconocido) para que `onMove` sólo
   * reciba cambios reales — igual que hacía el `handleDrop` original.
   */
  function commitMove(itemId: string, toColumnId: ColId, viaKeyboard: boolean) {
    if (!onMove) return;
    const item = itemsById.get(itemId);
    if (!item) return;
    if (!indexByColumnId.has(toColumnId)) return;
    if (columnOf(item) === toColumnId) return;

    if (viaKeyboard) {
      // Se pide el foco ANTES de avisar: el nodo nuevo puede montarse en el
      // mismo commit en que el caller aplica el update optimista.
      refocusRef.current = itemId;
      const target = columns.find((c) => c.id === toColumnId);
      setAnnouncement(`${labelOf(item)} movido a ${target?.label ?? toColumnId}.`);
    }
    onMove(itemId, toColumnId, item);
  }

  // ─── Drag & drop HTML5 (mismo contrato que el board original) ────────────
  function handleDragStart(e: DragEvent<HTMLDivElement>, itemId: string) {
    e.dataTransfer.setData("text/plain", itemId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(itemId);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDragOverColumnId(null);
  }

  function handleDragOver(e: DragEvent<HTMLElement>, columnId: ColId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverColumnId !== columnId) setDragOverColumnId(columnId);
  }

  function handleDragLeave(columnId: ColId) {
    if (dragOverColumnId === columnId) setDragOverColumnId(null);
  }

  function handleDrop(e: DragEvent<HTMLElement>, columnId: ColId) {
    e.preventDefault();
    setDragOverColumnId(null);
    setDraggingId(null);
    const itemId = e.dataTransfer.getData("text/plain");
    if (!itemId) return;
    commitMove(itemId, columnId, false);
  }

  // ─── Grab mode por teclado ───────────────────────────────────────────────
  function handleCardKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, item: Item) {
    if (!interactive) return;
    // Sólo con el foco en la card misma. Adentro viven botones propios y sus
    // teclas les pertenecen. Ver "DECISIÓN 2" en la cabecera.
    if (e.target !== e.currentTarget) return;

    const id = itemKey(item);
    const isGrabbed = grabbedId === id;

    if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
      e.preventDefault();
      if (isGrabbed) {
        setGrabbedId(null);
        setAnnouncement(`${labelOf(item)} soltado.`);
      } else {
        setGrabbedId(id);
        setAnnouncement(
          `${labelOf(item)} tomado. Flechas izquierda y derecha para cambiarlo de columna, Escape para soltarlo.`,
        );
      }
      return;
    }

    if (e.key === "Escape") {
      if (!isGrabbed) return;
      // No propaga: la card puede estar dentro de un drawer o modal y un Esc
      // que suelta la tarjeta no tiene que cerrar además el contenedor.
      e.preventDefault();
      e.stopPropagation();
      setGrabbedId(null);
      setAnnouncement(`${labelOf(item)} soltado sin moverlo.`);
      return;
    }

    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (!isGrabbed) return;
    e.preventDefault();

    const from = indexByColumnId.get(columnOf(item));
    if (from === undefined) return;
    // `noUncheckedIndexedAccess`: el índice fuera de rango da `undefined`, que
    // acá es justo lo que queremos (no hay columna, no hay movimiento).
    const target = columns[e.key === "ArrowLeft" ? from - 1 : from + 1];
    if (!target) {
      setAnnouncement(
        e.key === "ArrowLeft"
          ? "Ya está en la primera columna."
          : "Ya está en la última columna.",
      );
      return;
    }
    commitMove(id, target.id, true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {toolbar}

      {/*
        Track del carrusel. `snap-x snap-mandatory` sólo en mobile: en md+ el
        board entra de a varias columnas y encuadrar una sola estorbaría.
        Tailwind acá porque es literalmente una media query.
      */}
      <div
        role="group"
        aria-label={ariaLabel}
        className="snap-x snap-mandatory md:snap-none"
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          paddingBottom: 8,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {columns.map((col) => {
          const list = buckets.get(col.id) ?? [];
          const isOver = interactive && dragOverColumnId === col.id;
          return (
            <section
              key={col.id}
              aria-label={`${col.label}: ${list.length}`}
              onDragOver={
                interactive ? (e) => handleDragOver(e, col.id) : undefined
              }
              onDragLeave={interactive ? () => handleDragLeave(col.id) : undefined}
              onDrop={interactive ? (e) => handleDrop(e, col.id) : undefined}
              // 86vw deja asomar la columna siguiente en 390px; en md+ vuelve
              // al ancho fijo de 288px (el `w-72` histórico del board).
              className="w-[86vw] max-w-[320px] shrink-0 snap-start md:w-72 md:max-w-none"
              style={{
                display: "flex",
                flexDirection: "column",
                borderRadius: "var(--kg-r-16)",
                // Halo de acento = modo de la UI ("vas a soltar acá"), no tono
                // semántico. Ver "COLOR" en la cabecera.
                border: `1px solid ${
                  isOver ? "var(--kg-border-accent)" : "var(--kg-border-subtle)"
                }`,
                background: isOver
                  ? "var(--kg-accent-halo)"
                  : "var(--kg-surface-1)",
                transition:
                  "background var(--kg-dur) var(--kg-ease), border-color var(--kg-dur) var(--kg-ease)",
              }}
            >
              <header
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--kg-border-subtle)",
                  flexShrink: 0,
                }}
              >
                <h3
                  className="kg-t7"
                  style={{ margin: 0, color: "var(--kg-text-2)" }}
                >
                  {col.label}
                </h3>
                <span
                  className="kg-num"
                  style={{
                    color: "var(--kg-text-3)",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {col.badge ?? list.length}
                </span>
              </header>

              <div
                // `role="list"` sólo cuando hay cards: el texto de vacío no es
                // un listitem y ensuciaría el árbol de accesibilidad.
                role={list.length > 0 ? "list" : undefined}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 10,
                }}
              >
                {list.length === 0 ? (
                  <p
                    style={{
                      margin: 0,
                      padding: "24px 8px",
                      textAlign: "center",
                      color: "var(--kg-text-3)",
                      fontSize: 11,
                    }}
                  >
                    {col.emptyText ?? emptyText}
                  </p>
                ) : (
                  list.map((item) => {
                    const id = itemKey(item);
                    const isGrabbed = grabbedId === id;
                    const isDragging = draggingId === id;
                    return (
                      <div
                        key={id}
                        role="listitem"
                        ref={(el) => {
                          // Restitución del foco tras un movimiento por
                          // teclado: la card se remontó en la columna nueva.
                          if (el && refocusRef.current === id) {
                            refocusRef.current = null;
                            el.focus();
                          }
                        }}
                        tabIndex={interactive ? 0 : undefined}
                        aria-roledescription={
                          interactive ? "Tarjeta movible" : undefined
                        }
                        draggable={interactive}
                        onDragStart={
                          interactive ? (e) => handleDragStart(e, id) : undefined
                        }
                        onDragEnd={interactive ? handleDragEnd : undefined}
                        onKeyDown={
                          interactive
                            ? (e) => handleCardKeyDown(e, item)
                            : undefined
                        }
                        className={interactive ? "kg-focus" : undefined}
                        style={{
                          borderRadius: "var(--kg-r-12)",
                          border: `1px solid ${
                            isGrabbed
                              ? "var(--kg-border-accent)"
                              : "var(--kg-border-subtle)"
                          }`,
                          background: isGrabbed
                            ? "var(--kg-accent-halo)"
                            : "var(--kg-surface-2-solid)",
                          padding: 12,
                          // La card entera es el asa: en touch/mouse no hay
                          // que apuntar a un handle de 12px.
                          minHeight: 36,
                          cursor: interactive
                            ? isDragging
                              ? "grabbing"
                              : "grab"
                            : undefined,
                          opacity: isDragging ? 0.55 : 1,
                          transition:
                            "opacity var(--kg-dur-fast) var(--kg-ease), border-color var(--kg-dur) var(--kg-ease)",
                        }}
                      >
                        {renderItem(item)}
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Los anuncios del grab mode. `polite` para no pisar al usuario. */}
      <div aria-live="polite" style={SR_ONLY}>
        {announcement}
      </div>
    </div>
  );
}
