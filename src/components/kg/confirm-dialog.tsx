"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { inputStyle, secondaryBtn } from "./form-primitives";
import { TONE_VAR } from "./tone";

// ═══════════════════════════════════════════════════════════════════════════
// KG · ConfirmDialog. Confirmación de acciones destructivas.
//
// POR QUÉ EXISTE
// El módulo Lanzamientos tiene ~6 confirmaciones y cada una se resolvió por su
// cuenta: `delete-button.tsx` monta un modal propio con `z-[2100]` y
// type-to-confirm, `daily-delete-button.tsx` hace un two-step inline, y
// `alertas/row-actions.tsx` cae directo a `window.confirm()` (que no se puede
// estilar, no respeta el tema y bloquea el hilo). Tres UX distintas para la
// misma pregunta. Este componente es la única.
//
// ─────────────────────────────────────────────────────────────────────────
// DECISIÓN: overlay propio, NO construido sobre `Drawer` ni `KgBottomSheet`
// ─────────────────────────────────────────────────────────────────────────
// Se evaluaron los dos. Ninguno sirve de base, por cuatro razones concretas:
//
//  1. z-index no parametrizable. `Drawer` y `KgBottomSheet` hardcodean
//     `zIndex: 2000`. Pero el disparador natural de un confirm es el
//     `dangerBtn` que vive DENTRO de un form-drawer ("Borrar" en el footer
//     del drawer de edición). Un confirm a 2000 sobre un drawer a 2000 queda
//     resuelto por orden de DOM — o sea, a la suerte. El confirm necesita
//     estar estrictamente por encima.
//  2. `KgBottomSheet` trae `md:hidden` en su className. Es mobile-only por
//     diseño (es el contenedor del menú de página). Un confirm tiene que
//     existir en desktop.
//  3. `Drawer` es un panel lateral de altura completa con header + body
//     scrolleable + footer. Un confirm es una caja centrada y chica; heredar
//     ese chrome obligaría a pelearse con él.
//  4. Ninguno de los dos bloquea el cierre. Sus backdrops y su Esc cierran
//     siempre. Un confirm NO puede cerrarse mientras la Server Action está
//     corriendo — si se cierra a mitad, el usuario pierde el feedback de
//     pending y puede re-disparar la acción.
//
// Lo que sí se reusa: `inputStyle` y `secondaryBtn` de `form-primitives`, y
// `TONE_VAR` de `tone.ts` para el color destructivo. Cero estilo duplicado.
//
// ─────────────────────────────────────────────────────────────────────────
// ESCALERA DE z-index (sin números nuevos)
// ─────────────────────────────────────────────────────────────────────────
//    20   ContextBar sticky                (context-bar.tsx)
//    40   drawer mobile del sidebar        (shell)
//  2000   Drawer lateral / KgBottomSheet   (drawer.tsx, bottom-sheet.tsx)
//  2100   ESTE confirm                     ← ya era el valor de `z-[2100]` en
//                                            `delete-button.tsx`; no se
//                                            inventa un número, se le pone
//                                            nombre al que ya existía.
// Se exporta como `KG_Z_CONFIRM` para que el próximo overlay que necesite
// apilarse lea la escalera en vez de tantear.
//
// ─────────────────────────────────────────────────────────────────────────
// EJEMPLO DE LLAMADA REAL
// ─────────────────────────────────────────────────────────────────────────
// Reemplazo 1:1 de `src/components/dashboard/launches/delete-button.tsx`
// (mismo shape de datos: `launchName: string` + una Server Action bindeada
// `onConfirm: () => Promise<void>`), incluido el type-to-confirm "DELETE":
//
//   const [open, setOpen] = useState(false);
//
//   <button type="button" style={dangerBtn} onClick={() => setOpen(true)}>
//     Borrar
//   </button>
//
//   <KgConfirmDialog
//     open={open}
//     onClose={() => setOpen(false)}
//     title="Borrar lanzamiento"
//     description={
//       <>
//         Vas a borrar <b style={{ color: "var(--kg-text-1)" }}>{launchName}</b>.
//         Esta acción no se puede deshacer.
//       </>
//     }
//     confirmWord="DELETE"
//     confirmLabel="Borrar definitivamente"
//     pendingLabel="Borrando…"
//     onConfirm={onConfirm}
//   />
//
// Reemplazo de `alertas/row-actions.tsx` (hoy `window.confirm`) — sin
// `confirmWord`, porque borrar una regla de alerta es barato:
//
//   <KgConfirmDialog
//     open={askDelete}
//     onClose={() => setAskDelete(false)}
//     title="Borrar regla"
//     description="La regla deja de disparar. No se pierden datos históricos."
//     confirmLabel="Borrar"
//     onConfirm={() => deleteAlertRule(projectId, launchId, ruleId)}
//   />
//
// `daily-delete-button.tsx` (two-step inline) queda fuera a propósito: ahí el
// patrón inline es deliberado y más liviano que un modal. Ver nota al pie.
// ═══════════════════════════════════════════════════════════════════════════

/** Nivel de apilado del confirm. Ver la escalera documentada arriba. */
export const KG_Z_CONFIRM = 2100;

/** Selector de lo enfocable dentro del panel — alimenta la trampa de foco. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface KgConfirmDialogProps {
  readonly open: boolean;
  /** Cerrar sin ejecutar. No se llama mientras la acción está corriendo. */
  readonly onClose: () => void;
  readonly title: string;
  /** Cuerpo. ReactNode para poder negritear el nombre del recurso. */
  readonly description: ReactNode;
  /**
   * La acción destructiva. Si devuelve una Promise, el diálogo entra solo en
   * estado pending mientras la espera — el caller no necesita `useTransition`
   * salvo que ya lo tenga (en ese caso, pasá `pending`).
   */
  readonly onConfirm: () => void | Promise<void>;
  /** Label del botón destructivo. */
  readonly confirmLabel?: string;
  /** Label mientras corre. */
  readonly pendingLabel?: string;
  readonly cancelLabel?: string;
  /**
   * Type-to-confirm: si se pasa, el botón destructivo queda deshabilitado
   * hasta que el usuario escriba exactamente este texto. Derivado del
   * `CONFIRM_WORD = "DELETE"` de `delete-button.tsx` — se usa sólo cuando la
   * pérdida es grande e irreversible (borrar un lanzamiento entero), nunca
   * para borrados baratos.
   */
  readonly confirmWord?: string;
  /**
   * Pending controlado desde afuera. Se OR-ea con el pending interno, así el
   * caller que ya tiene `useTransition` (el patrón actual de todos los
   * consumidores) lo enchufa sin cambiar nada.
   */
  readonly pending?: boolean;
}

export function KgConfirmDialog(props: KgConfirmDialogProps) {
  // Todo el estado vive en `ConfirmBody`, que sólo se monta con `open`. Así el
  // input del type-to-confirm se resetea por desmontaje en vez de por un
  // `setState` dentro de un `useEffect` (que el ESLint del repo prohíbe).
  if (!props.open) return null;
  return <ConfirmBody {...props} />;
}

function ConfirmBody({
  onClose,
  title,
  description,
  onConfirm,
  confirmLabel = "Confirmar",
  pendingLabel = "Procesando…",
  cancelLabel = "Cancelar",
  confirmWord,
  pending = false,
}: KgConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(true);
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);

  const busy = pending || running;
  const canConfirm = !busy && (confirmWord == null || typed === confirmWord);

  const titleId = "kg-confirm-title";
  const descId = "kg-confirm-desc";
  const inputId = "kg-confirm-input";

  // Foco inicial + restitución al cerrar. Sólo llamadas al DOM, ningún
  // setState — no dispara `react-hooks/set-state-in-effect`.
  useEffect(() => {
    aliveRef.current = true;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    // Con type-to-confirm el foco va al input (es lo que el usuario tiene que
    // hacer). Sin él, al Cancelar: nunca autoenfocar el botón destructivo, un
    // Enter reflejo no puede borrar nada.
    const target =
      panel?.querySelector<HTMLElement>("[data-kg-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      null;
    target?.focus();
    return () => {
      aliveRef.current = false;
      previous?.focus();
    };
  }, []);

  function requestClose() {
    if (busy) return;
    onClose();
  }

  function handleConfirm() {
    if (!canConfirm) return;
    const result = onConfirm();
    if (!(result instanceof Promise)) return;
    setRunning(true);
    void result.finally(() => {
      // El caller suele cerrar el diálogo desde su propia revalidación, así
      // que para cuando la promesa resuelve puede estar desmontado.
      if (aliveRef.current) setRunning(false);
    });
  }

  // Esc + trampa de Tab. Se manejan acá (no con un listener en `window` como
  // hace `Drawer`) justamente porque el confirm puede estar montado ENCIMA de
  // un Drawer abierto: `stopPropagation` corta el evento antes de que llegue
  // al listener de `window` del Drawer y cierre los dos de un saque.
  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        // Sólo el backdrop cierra — un click que empezó dentro del panel y
        // terminó afuera (drag de selección de texto) no debe cerrar.
        if (e.target === e.currentTarget) requestClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      // Mobile primero: anclado abajo (pulgar) y centrado recién en ≥md.
      // display/align por className para no pisar utilidades responsive.
      className="flex items-end justify-center md:items-center"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        zIndex: KG_Z_CONFIRM,
        padding: 12,
        paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
      }}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="kg-glass-3"
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: "var(--kg-r-20)",
          border: "1px solid var(--kg-border-default)",
          boxShadow: "var(--kg-shadow-float)",
          padding: 20,
          animation: "kg-in var(--kg-dur-slow) var(--kg-ease)",
        }}
      >
        <h3
          id={titleId}
          className="kg-t4"
          style={{ margin: 0, color: "var(--kg-text-1)" }}
        >
          {title}
        </h3>

        <div
          id={descId}
          className="kg-t6"
          style={{ color: "var(--kg-text-2)", marginTop: 8, lineHeight: 1.5 }}
        >
          {description}
        </div>

        {confirmWord != null && (
          <div style={{ marginTop: 16 }}>
            <label
              htmlFor={inputId}
              className="kg-t7"
              style={{ display: "block", color: "var(--kg-text-3)", marginBottom: 6 }}
            >
              Escribí {confirmWord} para confirmar
            </label>
            <input
              id={inputId}
              data-kg-autofocus
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConfirm) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-describedby={descId}
              style={inputStyle}
            />
          </div>
        )}

        {/* En 390px los botones se apilan al revés (destructivo abajo, lejos
            del scroll) y en ≥md vuelven a la fila alineada a la derecha. */}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end md:gap-3" style={{ marginTop: 20 }}>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="kg-focus"
            style={{ ...secondaryBtn, opacity: busy ? 0.5 : 1 }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            aria-busy={busy}
            className="kg-focus"
            style={{
              ...destructiveBtn,
              opacity: canConfirm ? 1 : 0.5,
              cursor: canConfirm ? "pointer" : "not-allowed",
            }}
          >
            {busy ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Botón destructivo SÓLIDO. `dangerBtn` de form-primitives es el outline —
 * sirve para el disparador dentro de un form, pero la acción final de un
 * confirm tiene que leerse como el botón primario de la caja.
 */
const destructiveBtn: CSSProperties = {
  padding: "9px 16px",
  borderRadius: "var(--kg-r-full)",
  background: TONE_VAR.negative,
  border: "1px solid transparent",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

// ───────────────────────────────────────────────────────────────────────────
// NO CUBIERTO A PROPÓSITO
// `daily-delete-button.tsx` usa un two-step INLINE (el botón se convierte en
// "Cancelar / Confirmar" en la misma fila) y su propio comentario explica por
// qué: una fila diaria es barata de recrear, un modal sería UX de más. Ese
// patrón no se modela acá — si algún día se unifica, va como primitiva
// aparte (`KgInlineConfirm`), no como una variante de este diálogo.
// ───────────────────────────────────────────────────────────────────────────
