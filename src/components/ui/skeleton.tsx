import type { HTMLAttributes } from "react";

/**
 * Bloque pulsante base. Server component — la animación es 100% CSS
 * (`animate-pulse` de Tailwind), no necesita JS ni marcar "use client".
 *
 * Es puramente decorativo: `aria-hidden` + `role="presentation"` para que
 * los lectores de pantalla lo ignoren. El skeleton no debe anunciar
 * "cargando" — para eso el navegador ya muestra su indicador de nav.
 */
export function Skeleton({
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="presentation"
      aria-hidden
      className={`animate-pulse rounded-md bg-surface ${className}`}
      {...rest}
    />
  );
}
