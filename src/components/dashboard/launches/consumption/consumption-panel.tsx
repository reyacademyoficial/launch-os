"use client";

import { useActionState, useMemo, useState } from "react";

import type { ConsumptionActionState } from "@/app/(app)/proyectos/[projectId]/launches/[launchId]/consumption-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildHourSlots } from "@/lib/launch-consumption/hours";
import { computeConsumptionMetrics } from "@/lib/launch-consumption/metrics";
import type {
  ConsumptionCells,
  ConsumptionConfig,
  ConsumptionState,
} from "@/lib/launch-consumption/types";

import { ConsumptionChart } from "./consumption-chart";

/**
 * Editor completo de la grilla de consumo. Todo el estado vive en client
 * hasta que el usuario aprieta "Guardar" — se serializa el payload entero
 * y se manda al server action `saveConsumption`.
 *
 * Estructura:
 *  1) Header + Guardar
 *  2) Config: start / end / interval / clases (agregar / renombrar / quitar)
 *  3) Grilla editable (filas = horas, columnas = clases, cells = number input)
 *  4) Métricas (total por clase, pico por hora, promedio por clase)
 *  5) Chart comparativo
 *
 * En modo readOnly se muestran los mismos widgets deshabilitados + el aviso.
 */

type FormAction = (
  prev: ConsumptionActionState,
  formData: FormData,
) => Promise<ConsumptionActionState>;

interface Props {
  readonly initialState: ConsumptionState;
  readonly action: FormAction;
  readonly readOnly: boolean;
  readonly readOnlyReason: string | null;
}

export function ConsumptionPanel({
  initialState,
  action,
  readOnly,
  readOnlyReason,
}: Props) {
  const [config, setConfig] = useState<ConsumptionConfig>(initialState.config);
  const [cells, setCells] = useState<ConsumptionCells>(initialState.cells);
  const [state, formAction, pending] = useActionState<
    ConsumptionActionState,
    FormData
  >(action, null);

  // Slots derivados del config actual — se recalculan sin efecto extra en
  // cada render. Los inputs de grilla se identifican por (hora, clase).
  const hourSlots = useMemo(() => buildHourSlots(config), [config]);
  const metrics = useMemo(
    () => computeConsumptionMetrics(config, cells),
    [config, cells],
  );

  // Feedback visual: mostramos el badge "Guardado" cuando el último save
  // resolvió ok. Se limpia al próximo intento (state pasa a null durante el
  // pending o error en el siguiente submit).
  const savedFlash = state !== null && "ok" in state && state.ok;
  const errorMsg = state && "error" in state ? state.error : null;

  const disabled = readOnly || pending;

  function updateCell(hour: string, className: string, raw: string) {
    const n = raw === "" ? null : parseInt(raw, 10);
    setCells((prev) => {
      const row = { ...(prev[hour] ?? {}) };
      if (n === null || !Number.isFinite(n) || n < 0) {
        delete row[className];
      } else {
        row[className] = Math.trunc(n);
      }
      const next = { ...prev };
      if (Object.keys(row).length === 0) delete next[hour];
      else next[hour] = row;
      return next;
    });
  }

  function handleAddClass() {
    // Nombre único: "Clase N" con N = siguiente índice libre.
    let idx = config.classes.length + 1;
    let candidate = `Clase ${idx}`;
    const existing = new Set(config.classes);
    while (existing.has(candidate)) {
      idx += 1;
      candidate = `Clase ${idx}`;
    }
    setConfig((c) => ({ ...c, classes: [...c.classes, candidate] }));
  }

  function handleRenameClass(oldName: string, newNameRaw: string) {
    const newName = newNameRaw.trim();
    if (!newName || newName === oldName) return;
    if (config.classes.includes(newName)) return; // silencioso — otro row ya lo tiene
    setConfig((c) => ({
      ...c,
      classes: c.classes.map((n) => (n === oldName ? newName : n)),
    }));
    // Reindexar cells para preservar los valores cargados bajo el nombre viejo.
    setCells((prev) => {
      const next: ConsumptionCells = {};
      for (const [hour, row] of Object.entries(prev)) {
        const cleanRow: Record<string, number> = { ...row };
        const carried = cleanRow[oldName];
        if (carried !== undefined) {
          cleanRow[newName] = carried;
          delete cleanRow[oldName];
        }
        next[hour] = cleanRow;
      }
      return next;
    });
  }

  function handleRemoveClass(name: string) {
    if (config.classes.length <= 1) return; // guardarraíl UI — el server también valida
    setConfig((c) => ({ ...c, classes: c.classes.filter((n) => n !== name) }));
    setCells((prev) => {
      const next: ConsumptionCells = {};
      for (const [hour, row] of Object.entries(prev)) {
        const clean: Record<string, number> = { ...row };
        delete clean[name];
        if (Object.keys(clean).length > 0) next[hour] = clean;
      }
      return next;
    });
  }

  function handleReset() {
    setConfig(initialState.config);
    setCells(initialState.cells);
  }

  const payload = useMemo(
    () => JSON.stringify({ config, cells }),
    [config, cells],
  );

  const startInvalid = config.endTime <= config.startTime;
  const intervalInvalid =
    !Number.isFinite(config.intervalMinutes) ||
    config.intervalMinutes < 1 ||
    config.intervalMinutes > 240;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-fg">
            Consumo por clase
          </h2>
          <p className="text-xs text-fg-subtle">
            Cargá cuántas personas hubo en cada clase por hora. El gráfico
            compara la evolución.
          </p>
        </div>

        {!readOnly && (
          <form action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="payload" value={payload} />
            <Button
              type="button"
              variant="secondary"
              onClick={handleReset}
              disabled={pending}
            >
              Descartar
            </Button>
            <Button
              type="submit"
              disabled={pending || startInvalid || intervalInvalid}
            >
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </form>
        )}
      </header>

      {readOnlyReason && (
        <p className="rounded-md border border-border bg-surface/50 px-3 py-2 text-xs text-fg-muted">
          {readOnlyReason}
        </p>
      )}

      {savedFlash && (
        <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
          Grilla guardada.
        </p>
      )}
      {errorMsg && <FieldError>{errorMsg}</FieldError>}

      {/* ── Config ──────────────────────────────────────────────────────── */}
      <section className="grid gap-4 rounded-md border border-border bg-surface/40 p-4 md:grid-cols-[repeat(3,minmax(0,1fr))_2fr]">
        <div>
          <Label htmlFor="cons-start">Hora inicio</Label>
          <Input
            id="cons-start"
            type="time"
            value={config.startTime}
            onChange={(e) =>
              setConfig((c) => ({ ...c, startTime: e.target.value }))
            }
            disabled={disabled}
          />
        </div>
        <div>
          <Label htmlFor="cons-end">Hora fin</Label>
          <Input
            id="cons-end"
            type="time"
            value={config.endTime}
            onChange={(e) =>
              setConfig((c) => ({ ...c, endTime: e.target.value }))
            }
            disabled={disabled}
          />
          {startInvalid && (
            <FieldError>La hora de fin debe ser mayor a la de inicio.</FieldError>
          )}
        </div>
        <div>
          <Label htmlFor="cons-interval">Intervalo (min)</Label>
          <Input
            id="cons-interval"
            type="number"
            min="1"
            max="240"
            step="1"
            value={String(config.intervalMinutes)}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setConfig((c) => ({
                ...c,
                intervalMinutes: Number.isFinite(n) ? n : c.intervalMinutes,
              }));
            }}
            disabled={disabled}
          />
          {intervalInvalid && (
            <FieldError>Entre 1 y 240 minutos.</FieldError>
          )}
        </div>

        <div>
          <Label>Clases</Label>
          <div className="space-y-2">
            {config.classes.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <Input
                  defaultValue={name}
                  onBlur={(e) => handleRenameClass(name, e.target.value)}
                  disabled={disabled}
                  aria-label={`Renombrar ${name}`}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleRemoveClass(name)}
                  disabled={disabled || config.classes.length <= 1}
                  aria-label={`Quitar ${name}`}
                  className="px-2"
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={handleAddClass}
              disabled={disabled}
            >
              + Agregar clase
            </Button>
          </div>
        </div>
      </section>

      {/* ── Grilla ─────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">Asistentes por hora</h3>
        {hourSlots.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-fg-muted">
            Config inválida — la ventana no genera ningún slot horario.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-fit border-collapse text-sm">
              <thead className="bg-bg-elevated">
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 border-b border-border bg-bg-elevated px-3 py-2 text-left font-semibold text-fg-muted"
                  >
                    Hora
                  </th>
                  {config.classes.map((className) => (
                    <th
                      key={className}
                      scope="col"
                      className="border-b border-border px-3 py-2 text-left font-semibold text-fg-muted"
                    >
                      {className}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hourSlots.map((hour) => (
                  <tr key={hour} className="odd:bg-surface/30">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-border bg-surface/50 px-3 py-1 text-left font-medium text-fg"
                    >
                      {hour}
                    </th>
                    {config.classes.map((className) => {
                      const value = cells[hour]?.[className];
                      return (
                        <td
                          key={className}
                          className="border-b border-border px-2 py-1"
                        >
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            aria-label={`${className} a las ${hour}`}
                            value={value === undefined ? "" : String(value)}
                            onChange={(e) =>
                              updateCell(hour, className, e.target.value)
                            }
                            disabled={disabled}
                            className="w-24"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Métricas ───────────────────────────────────────────────────── */}
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Total por clase"
          body={
            metrics.perClass.length === 0 ? (
              <span className="text-fg-muted">Sin clases</span>
            ) : (
              <ul className="space-y-1 text-sm">
                {metrics.perClass.map((c) => (
                  <li key={c.className} className="flex justify-between gap-2">
                    <span className="text-fg-muted">{c.className}</span>
                    <span className="font-semibold text-fg">{c.total}</span>
                  </li>
                ))}
              </ul>
            )
          }
        />
        <MetricCard
          label="Pico por hora"
          body={
            metrics.peak === null ? (
              <span className="text-fg-muted">Sin datos cargados</span>
            ) : (
              <div>
                <div className="text-2xl font-bold text-fg">
                  {metrics.peak.total}
                </div>
                <div className="text-xs text-fg-subtle">
                  a las {metrics.peak.hour} (suma de todas las clases)
                </div>
              </div>
            )
          }
        />
        <MetricCard
          label="Promedio por clase"
          body={
            metrics.perClass.length === 0 || metrics.slotCount === 0 ? (
              <span className="text-fg-muted">Sin datos</span>
            ) : (
              <ul className="space-y-1 text-sm">
                {metrics.perClass.map((c) => (
                  <li key={c.className} className="flex justify-between gap-2">
                    <span className="text-fg-muted">{c.className}</span>
                    <span className="font-semibold text-fg">
                      {c.averagePerSlot.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        />
      </section>

      {/* ── Chart ──────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">
          Comparativa por clase
        </h3>
        <div className="rounded-md border border-border bg-surface/40 p-4">
          <ConsumptionChart
            config={config}
            cells={cells}
            hourSlots={hourSlots}
          />
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  body,
}: {
  readonly label: string;
  readonly body: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface/40 p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      {body}
    </div>
  );
}
