import type { ReactNode } from "react";

import { ContextBarFiltersButton } from "./context-bar-filters-button";
import { StateDot } from "./state-dot";
import { toneOf } from "./tone";

export interface ContextBarStat {
  readonly l: string;
  readonly v: string | number;
  readonly c?: string;
}

/**
 * KG · ContextBar. Barra STICKY con el contexto de la vista mientras el
 * usuario scrollea.
 *
 * top=0: el scroll parent es `<main>` (ver `KingrowShell`), y la topbar vive
 * FUERA del main. Es decir, "arriba" del scroll parent es el borde superior
 * del main — que está pegado a la topbar. Antes usábamos `top: 62` asumiendo
 * que el scroll era del viewport; era incorrecto para el shell actual y hacía
 * que la barra "flotara" con un hueco por encima al scrollear.
 *
 * Fondo SÓLIDO: al ser sticky, si el fondo es semitransparente el contenido
 * scrolleado se ve borrosamente por detrás — se percibía como "pisar la
 * información". Con --kg-surface-1-solid la barra tapa limpio.
 *
 * z-index 20: tiene que quedar POR DEBAJO del drawer mobile (z-40) y de su
 * backdrop (z-30) para que en mobile no pise el menú al abrirse. Solo necesita
 * ganarle al contenido scrolleado del `<main>` (headers sticky de tablas van
 * en z-1), así que 20 sobra.
 */
export function ContextBar({
  icon,
  title,
  stats,
  top = 0,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly stats?: readonly ContextBarStat[];
  readonly top?: number;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top,
        zIndex: 20,
        background: "var(--kg-surface-1-solid)",
        borderRadius: "var(--kg-r-16)",
        border: "1px solid var(--kg-border-subtle)",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        boxShadow: "var(--kg-shadow-amb)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "var(--kg-r-8)",
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--kg-text-3)",
          }}
        >
          {icon}
        </div>
        <span
          className="kg-t5"
          style={{ color: "var(--kg-text-1)", fontWeight: 700 }}
        >
          {title}
        </span>
        {/*
          Botón "Filtros" mobile-only. Se auto-oculta cuando la página no
          registró filtros. Va junto al título para quedar visible en la
          primera fila del ContextBar aunque los stats wrappeen abajo.
        */}
        <ContextBarFiltersButton />
      </div>
      <div
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          marginLeft: "auto",
        }}
      >
        {(stats ?? []).map((s, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ fontSize: 11, color: "var(--kg-text-3)" }}>
              {s.l}
            </span>
            <strong
              className="kg-num"
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--kg-text-1)",
              }}
            >
              {s.v}
            </strong>
            <StateDot tone={toneOf(s.c)} size={4} />
          </div>
        ))}
      </div>
    </div>
  );
}
