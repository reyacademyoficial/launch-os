"use client";

import { usePathname } from "next/navigation";

import { KgTabsBarView, type TabItem } from "./tabs-bar-view";

/**
 * KG · TabsBar. Barra de pestañas ligera para navegación intra-módulo, donde
 * cada pestaña es una RUTA.
 *
 * Cliente porque necesita `usePathname` para marcar la activa. Sin fetch, sin
 * estado de datos — el markup vive en `tabs-bar-view.tsx` y acá queda sólo el
 * resolvedor. Si tus pestañas NO son rutas sino valores de un query param
 * (`?view=`), usá `KgTabsBarView` directo y pasale el `activeHref`: te ahorrás
 * además el JS de cliente.
 *
 * Colocación: debajo del ContextBar de la página. NO es sticky por default
 * (el ContextBar sí lo es). Si en algún caso hace falta que quede pegada
 * al scroll también, se agrega el offset del ContextBar arriba del top.
 * Hoy con 8 pestañas no aporta.
 */

export type { TabItem };

export function KgTabsBar({ items }: { readonly items: readonly TabItem[] }) {
  const pathname = usePathname();
  return (
    <KgTabsBarView items={items} activeHref={resolveActiveHref(pathname, items)} />
  );
}

/**
 * Matching por prefijo con desempate por longitud — así "/financiero/facturas"
 * no matchea también "/financiero" (que es el índice del módulo). El item más
 * específico gana. Devuelve `null` si ninguno matchea.
 */
function resolveActiveHref(
  pathname: string,
  items: readonly TabItem[],
): string | null {
  const matches = items.filter(
    (t) => pathname === t.href || pathname.startsWith(`${t.href}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (b.href.length > a.href.length ? b : a)).href;
}
