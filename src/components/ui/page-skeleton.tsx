import type { CSSProperties } from "react";

import { Skeleton } from "@/components/kg/skeleton";

/**
 * Variantes de skeleton para `loading.tsx` de cada página del app router.
 *
 * Todas asumen que el shell (sidebar + topbar) ya está renderizado por el
 * layout padre — el skeleton ocupa solo el área de contenido. Estructura
 * cerca del layout real de la página que reemplazan, para evitar layout
 * shift al swap real ↔ skeleton.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * MIGRACIÓN A TOKENS KG (por qué este archivo y no los 15 `loading.tsx`)
 * ───────────────────────────────────────────────────────────────────────────
 * Este es el único archivo detrás de los ~33 `loading.tsx` del repo, así que
 * migrarlo acá arregla de una todos los árboles sin tocar ninguna ruta.
 *
 * Cambios:
 *   · Tokens VIEJOS fuera: `border-border`, `bg-surface`, `bg-bg-elevated`,
 *     `shadow-card` → CSS vars `--kg-*` en inline styles, como el resto de
 *     `components/kg/**`.
 *   · `Skeleton` ahora viene de `@/components/kg/skeleton` — el shimmer real
 *     del design system (`.kg-skel`, linear-gradient + `kg-shim`), en vez del
 *     `animate-pulse` sobre `bg-surface` del `Skeleton` de `components/ui`.
 *     No se duplica la animación: la primitiva KG es la única fuente.
 *   · La API de la primitiva KG es `{h, w, r, mb}` (números / strings CSS),
 *     no `className`. Por eso las medidas que antes eran clases Tailwind
 *     (`h-7 w-48`) ahora son props numéricas equivalentes.
 *
 * Se conserva Tailwind SÓLO para las grillas responsive (`sm:`/`lg:`), que es
 * lo que inline styles no puede expresar. Todo lo demás es inline.
 *
 * Los cuatro exports mantienen nombre y firma exactos —
 * `DashboardPageSkeleton({cards, tableRows})`, `TablePageSkeleton({rows})`,
 * `ListPageSkeleton({items})`, `FormPageSkeleton({fields})`— porque los
 * consumen `loading.tsx` de `(app)/(kg)/**`, `(cliente)/portal/**`,
 * `(admin)/**` y `(auth)/**`, y ninguno de esos se toca en esta etapa.
 *
 * `aria-hidden` + `role="presentation"` viven acá, a nivel sección: la
 * primitiva KG (a diferencia de la vieja de `components/ui`) no los trae, y
 * un skeleton nunca debe anunciarse al lector de pantalla — el browser ya
 * muestra su indicador de navegación.
 */

/** Columna con separación vertical estándar entre bloques de la página. */
const stack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

/** Caja glass: la misma receta que `Panel` (kg-glass + radio + sombra). */
const card: CSSProperties = {
  borderRadius: "var(--kg-r-20)",
  border: "1px solid var(--kg-border-subtle)",
  background: "var(--kg-surface-1)",
  boxShadow: "var(--kg-shadow-amb)",
  overflow: "hidden",
};

/** Fila de tabla: alto y padding equivalentes a los del `DataTable` KG. */
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "12px 14px",
};

function PageHeaderSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Skeleton h={28} w={192} r={8} />
      <Skeleton h={16} w="100%" r={6} />
    </div>
  );
}

/**
 * Header + barra de filtros + tabla. Cubre ventas, cobros, comisiones,
 * productos, métodos-pago, bancos, equipo, audit log, admin/usuarios,
 * admin/proyectos, cliente/leads, etc.
 */
export function TablePageSkeleton({ rows = 8 }: { readonly rows?: number }) {
  return (
    <section style={stack} aria-hidden role="presentation">
      <PageHeaderSkeleton />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 12px",
          borderRadius: "var(--kg-r-12)",
          border: "1px solid var(--kg-border-subtle)",
          background: "var(--kg-surface-1)",
        }}
      >
        <div style={{ flex: 1, minWidth: 224 }}>
          <Skeleton h={32} w="100%" />
        </div>
        <Skeleton h={32} w={160} />
        <Skeleton h={32} w={160} />
        <Skeleton h={32} w={160} />
      </div>

      <div style={card}>
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--kg-border-subtle)",
            background: "var(--kg-surface-2)",
          }}
        >
          <Skeleton h={16} w={128} r={6} />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              ...row,
              borderTop: i === 0 ? undefined : "1px solid var(--kg-border-subtle)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton h={16} w="100%" r={6} />
            </div>
            <Skeleton h={16} w={96} r={6} />
            <Skeleton h={16} w={80} r={6} />
            <Skeleton h={16} w={80} r={6} />
            <Skeleton h={16} w={64} r={6} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Header + KPI cards + tabla. Cubre overview del proyecto, leaderboard,
 * launch detail, launch KPI, launch calendario, launch IA, analítica.
 */
export function DashboardPageSkeleton({
  cards = 6,
  tableRows = 5,
}: {
  readonly cards?: number;
  readonly tableRows?: number;
}) {
  return (
    <section style={stack} aria-hidden role="presentation">
      <PageHeaderSkeleton />

      {/* Grilla responsive: única cosa que queda en Tailwind. Mobile primero
          — 2 columnas en 390px, 3 en sm, 6 en lg. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            style={{
              ...card,
              borderRadius: "var(--kg-r-16)",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <Skeleton h={12} w={80} r={6} />
            <Skeleton h={24} w={96} />
          </div>
        ))}
      </div>

      <div style={card}>
        {Array.from({ length: tableRows }).map((_, i) => (
          <div
            key={i}
            style={{
              ...row,
              borderTop: i === 0 ? undefined : "1px solid var(--kg-border-subtle)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton h={16} w="100%" r={6} />
            </div>
            <Skeleton h={16} w={96} r={6} />
            <Skeleton h={16} w={80} r={6} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Header + card con inputs. Cubre login, set-password, configuración,
 * calculadora, admin/proyectos/new, admin/proyectos/[id]/edit,
 * launch/integraciones, cliente/calculadora, cliente/configuración.
 */
export function FormPageSkeleton({ fields = 5 }: { readonly fields?: number }) {
  return (
    <section style={stack} aria-hidden role="presentation">
      <PageHeaderSkeleton />

      <div
        style={{
          ...card,
          background: "var(--kg-surface-2)",
          boxShadow: "var(--kg-shadow-float)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {Array.from({ length: fields }).map((_, i) => (
          <div
            key={i}
            style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 448 }}
          >
            <Skeleton h={12} w={96} r={6} />
            <Skeleton h={36} w="100%" />
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 8 }}>
          <Skeleton h={36} w={128} r={999} />
          <Skeleton h={12} w={80} r={6} />
        </div>
      </div>
    </section>
  );
}

/**
 * Header + grid de cards. Cubre listado de lanzamientos, project picker,
 * portal del cliente, portal listado de launches.
 */
export function ListPageSkeleton({ items = 6 }: { readonly items?: number }) {
  return (
    <section style={stack} aria-hidden role="presentation">
      <PageHeaderSkeleton />

      {/* Grilla responsive: 1 columna en mobile, 2 en sm, 3 en lg. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: items }).map((_, i) => (
          <div
            key={i}
            style={{
              ...card,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Skeleton h={20} w="60%" r={6} />
              <Skeleton h={16} w={56} r={999} />
            </div>
            <Skeleton h={12} w="50%" r={6} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
              <Skeleton h={12} w="100%" r={6} />
              <Skeleton h={12} w="66%" r={6} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
