/**
 * Estado persistido del colapso de la sidebar en desktop.
 *
 * Va en cookie (no localStorage) para que el SSR ya renderice el shell con o
 * sin sidebar y no haya flash de 236px que desaparecen al hidratar. A
 * diferencia del tema, el toggle NO usa Server Action + revalidatePath: el
 * estado vive en React y la cookie se escribe desde el cliente
 * (`writeSidebarCookie`) sólo para que el próximo SSR arranque igual. Colapsar
 * un panel tiene que ser instantáneo, no un round-trip al server.
 */
export const SIDEBAR_COOKIE = "kg-sidebar";

/** Valor de cookie que significa "colapsada". Ausente = expandida. */
const COLLAPSED = "collapsed";

export function isSidebarCollapsedValue(value: unknown): boolean {
  return value === COLLAPSED;
}

/**
 * Escribe la preferencia desde el cliente. `max-age` de un año y `path=/`
 * para que aplique a todo el árbol `(app)`.
 */
export function writeSidebarCookie(collapsed: boolean): void {
  const maxAge = collapsed ? 60 * 60 * 24 * 365 : 0;
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? COLLAPSED : ""}; path=/; max-age=${maxAge}; samesite=lax`;
}
