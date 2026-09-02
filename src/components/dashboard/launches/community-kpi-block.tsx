"use client";

import { Breakdown } from "@/components/kg/breakdown";
import { IconCli } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { SectionHeader } from "@/components/kg/section-header";
import { SupportKpi } from "@/components/kg/support-kpi";
import { fmtNumber, fmtPercent } from "@/lib/format";
import type { LaunchKPIs } from "@/lib/kpis";

/**
 * Bloque "Comunidad (SendFlow)". Se renderiza abajo del KpiGrid principal,
 * separado conceptualmente de las métricas de ads.
 *
 * POR QUÉ ES CLIENT
 * `SupportKpi` y `Breakdown` reciben el formateador como FUNCIÓN (`format` /
 * `fmtFn`) y las funciones no cruzan el boundary RSC. Su único consumidor es
 * `kpi/page.tsx`, que es una page SERVER: sin este `"use client"` el payload
 * RSC intentaría serializar `fmtNumber` y explotaría en runtime. Mismo corte
 * y misma razón que `kpi-grid.tsx` — y sin costo, porque lo que entra
 * (`LaunchKPIs`) ya era un objeto plano de números.
 *
 * QUÉ REEMPLAZÓ A QUÉ
 *   - Las 3 cards a mano (`rounded-md border-border bg-surface p-4` con
 *     label uppercase + número + hint) → `SupportKpi`. Mismo nivel visual que
 *     el resto de los KPIs del launch: antes este bloque tenía tipografía y
 *     cajas propias y leía como si viniera de otro producto.
 *   - Los `hint` que colgaban debajo de cada número → `help` (el ⓘ), igual
 *     que en `kpi-grid.tsx`. Son la cuenta detrás de la métrica; quien la
 *     necesita la abre.
 *   - El par "X entraron · Y salieron", que era texto suelto dentro del hint
 *     de Retención, ahora es un `Breakdown` de verdad: la retención es
 *     exactamente altas − bajas, y verlo como dos barras dice de un vistazo
 *     si la comunidad creció o se vació. `Breakdown` pinta lo negativo en
 *     gris y lo positivo en carmesí — acá el signo SÍ es la información.
 *   - El `<header>` con `h2 text-fg` + `p text-fg-subtle` → `SectionHeader`
 *     (no sticky, a diferencia del ContextBar de la page). La bajada se
 *     mudó a las acciones del Panel, como el "Solo lectura" de `audit`.
 *
 * Reglas de visibilidad (decisión "B + C") — SIN CAMBIOS:
 *  - `enteredCommunity === 0` → NO se renderiza. Si no hay sync de SendFlow
 *    no queremos sumar ruido vacío al dashboard. Por eso este bloque NO usa
 *    `EmptyState`: el vacío acá se resuelve no existiendo, y un card de
 *    onboarding aparecería en todos los lanzamientos que no usan SendFlow.
 *  - rates `null` (denominador 0) → mostramos "—" en vez de "0.0%". Indica
 *    que no se pudo calcular, NO que dio cero.
 */

/** Formateador tolerante a rates sin denominador (`null` → NaN → "—"). */
function pctOrDash(n: number): string {
  return Number.isFinite(n) ? fmtPercent(n) : "—";
}

export function CommunityKpiBlock({ kpi }: { readonly kpi: LaunchKPIs }) {
  if (kpi.enteredCommunity === 0) return null;

  const retentionHelp = `${fmtNumber(kpi.enteredCommunity)} entraron · ${fmtNumber(kpi.leftCommunity)} salieron.`;
  const enteredRateHelp =
    kpi.enteredCommunityRate === null
      ? "Sin leads de ads para usar como base."
      : `${fmtNumber(kpi.enteredCommunity)} sobre ${fmtNumber(Math.round(kpi.enteredCommunity / (kpi.enteredCommunityRate / 100)))} leads totales.`;

  // Neto = los que quedaron adentro. Es el mismo numerador que usa
  // `retentionRate` en `lib/kpis.ts`; acá se muestra en absoluto.
  const netCommunity = kpi.enteredCommunity - kpi.leftCommunity;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHeader
        icon={<IconCli size={16} />}
        title="Comunidad (SendFlow)"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SupportKpi
          label="Retención"
          value={kpi.retentionRate ?? Number.NaN}
          format={pctOrDash}
          help={retentionHelp}
        />
        <SupportKpi
          label="% leads que entraron"
          value={kpi.enteredCommunityRate ?? Number.NaN}
          format={pctOrDash}
          help={enteredRateHelp}
        />
        <SupportKpi
          label="Clicks"
          value={kpi.communityClicks}
          format={fmtNumber}
          help="Clicks sobre links enviados a la comunidad."
        />
      </div>

      <Panel
        title="Movimiento de la comunidad"
        actions={
          <span className="kg-t6" style={{ color: "var(--kg-text-3)" }}>
            Grupo de WhatsApp del lanzamiento
          </span>
        }
      >
        <Breakdown
          total={netCommunity}
          totalLabel="Quedaron adentro"
          // Las bajas van en negativo a propósito: `Breakdown` las dibuja en
          // gris y con el signo, así la barra se lee como resta y no como
          // "otra categoría más" del total.
          parts={[
            { l: "Entraron", v: kpi.enteredCommunity },
            { l: "Salieron", v: -kpi.leftCommunity },
          ]}
          fmtFn={fmtNumber}
        />
      </Panel>
    </section>
  );
}
