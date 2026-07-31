"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fMoney, fPct } from "@/lib/finance/format";
import {
  computeSettlement,
  type SettlementBreakdown,
} from "@/lib/settlements/calc";
import type {
  SettlementAppliesOn,
  SettlementRuleRow,
  SettlementRuleSnapshot,
} from "@/lib/settlements/types";

import type { LaunchAggregates } from "@/lib/settlements/aggregates";

import {
  fetchLaunchAggregates,
  rotateRule,
  type RotateRulePayload,
} from "./actions";

// ═══════════════════════════════════════════════════════════════════════════
// Props del formulario compartido new/edit
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectContext {
  readonly id: string;
  readonly name: string;
  readonly ownership: "propia" | "externa";
  readonly organizationId: string;
}

export interface LaunchOption {
  readonly id: string;
  readonly name: string;
}

export interface RuleFormProps {
  readonly mode: "new" | "edit";
  readonly project: ProjectContext;
  /** Todos los lanzamientos del proyecto — poblan el selector del simulador
   *  y (en modo new-override) el selector de scope. */
  readonly launches: readonly LaunchOption[];
  /** Reglas activas del proyecto — usadas para detectar qué queda desactivada
   *  cuando el scope elegido ya tiene una regla vigente. */
  readonly activeRules: readonly SettlementRuleRow[];
  /** Solo definido en modo edit: la regla que se está editando. */
  readonly editingRule: SettlementRuleRow | null;
  /** Modo new: si el URL indicó ?launchId=X, pre-seleccionamos. */
  readonly initialLaunchId: string | null;
  /** Modo new: si el URL indicó ?scope=override, el usuario tiene que elegir
   *  launch antes de continuar. Si es false, el nuevo es la regla default. */
  readonly isOverrideNew: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Componente
// ═══════════════════════════════════════════════════════════════════════════

export function RuleForm(props: RuleFormProps) {
  const router = useRouter();

  // ─── Estado de campos ────────────────────────────────────────────────────
  const [name, setName] = useState(props.editingRule?.name ?? "");
  const [appliesOn, setAppliesOn] = useState<SettlementAppliesOn>(
    props.editingRule?.applies_on ?? "collected",
  );
  const [percent, setPercent] = useState<string>(
    props.editingRule ? String(props.editingRule.percent_of_collected) : "",
  );
  const [fixedLaunch, setFixedLaunch] = useState<string>(
    props.editingRule ? String(props.editingRule.fixed_fee_per_launch) : "0",
  );
  const [fixedSale, setFixedSale] = useState<string>(
    props.editingRule ? String(props.editingRule.fixed_fee_per_sale) : "0",
  );
  const [minGuarantee, setMinGuarantee] = useState<string>(
    props.editingRule?.min_guarantee != null
      ? String(props.editingRule.min_guarantee)
      : "",
  );

  // ─── Scope: launch_id de la regla a persistir ────────────────────────────
  // En edit está fijo (la launch del rule original). En new-default es null.
  // En new-override el usuario elige.
  const initialScopeLaunchId =
    props.mode === "edit"
      ? props.editingRule?.launch_id ?? null
      : props.initialLaunchId;
  const [scopeLaunchId, setScopeLaunchId] = useState<string | null>(
    initialScopeLaunchId,
  );
  const scopeLocked = props.mode === "edit"; // no permitir cambiar el scope en edit

  // ─── Simulador ───────────────────────────────────────────────────────────
  const defaultSimLaunchId =
    scopeLaunchId ?? props.launches[0]?.id ?? null;
  const [simLaunchId, setSimLaunchId] = useState<string | null>(
    defaultSimLaunchId,
  );
  const [simAggregates, setSimAggregates] = useState<LaunchAggregates | null>(
    null,
  );
  const [simError, setSimError] = useState<string | null>(null);
  const [simPending, startSimTransition] = useTransition();

  const loadAggregates = useCallback(
    (launchId: string) => {
      setSimError(null);
      setSimAggregates(null);
      startSimTransition(async () => {
        try {
          const agg = await fetchLaunchAggregates(launchId);
          setSimAggregates(agg);
        } catch (e) {
          setSimError(
            e instanceof Error ? e.message : "Error trayendo los agregados.",
          );
        }
      });
    },
    [startSimTransition],
  );

  useEffect(() => {
    if (simLaunchId) loadAggregates(simLaunchId);
    else {
      setSimAggregates(null);
      setSimError(null);
    }
  }, [simLaunchId, loadAggregates]);

  // ─── Snapshot en borrador (para calc + confirmación) ────────────────────
  const draftSnapshot = useMemo<SettlementRuleSnapshot>(() => {
    return {
      name: name.trim(),
      percent_of_collected: numOrZero(percent),
      fixed_fee_per_launch: numOrZero(fixedLaunch),
      fixed_fee_per_sale: numOrZero(fixedSale),
      min_guarantee: minGuarantee.trim() === "" ? null : numOrZero(minGuarantee),
      applies_on: appliesOn,
    };
  }, [name, percent, fixedLaunch, fixedSale, minGuarantee, appliesOn]);

  const breakdown: SettlementBreakdown | null = useMemo(() => {
    if (!simAggregates) return null;
    return computeSettlement(draftSnapshot, simAggregates);
  }, [draftSnapshot, simAggregates]);

  // ─── Regla que quedaría desactivada al guardar ──────────────────────────
  // Se busca en activeRules por (project, scope). null en new sin conflicto.
  const willReplace: SettlementRuleRow | null = useMemo(() => {
    const target = props.activeRules.find(
      (r) => r.project_id === props.project.id && r.launch_id === scopeLaunchId,
    );
    if (!target) return null;
    // En modo edit, si el user no cambió el scope, la regla que "reemplaza"
    // es ella misma — mostrarla explícita igual, así la confirmación deja
    // claro qué queda inactivo.
    return target;
  }, [props.activeRules, props.project.id, scopeLaunchId]);

  // ─── Estado de guardado ─────────────────────────────────────────────────
  const [confirming, setConfirming] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitPending, startSubmitTransition] = useTransition();

  const clientValidationError = useMemo(() => {
    if (name.trim().length === 0) return "El nombre de la regla es obligatorio.";
    const p = numOrZero(percent);
    if (p < 0 || p > 100) return "El porcentaje tiene que estar entre 0 y 100.";
    if (numOrZero(fixedLaunch) < 0 || numOrZero(fixedSale) < 0) {
      return "Los cargos fijos no pueden ser negativos.";
    }
    if (minGuarantee.trim() !== "" && numOrZero(minGuarantee) < 0) {
      return "La garantía mínima no puede ser negativa.";
    }
    if (props.mode === "new" && props.isOverrideNew && !scopeLaunchId) {
      return "Elegí a qué lanzamiento aplica el override.";
    }
    return null;
  }, [
    name,
    percent,
    fixedLaunch,
    fixedSale,
    minGuarantee,
    props.mode,
    props.isOverrideNew,
    scopeLaunchId,
  ]);

  function handleReview() {
    setSubmitError(null);
    if (clientValidationError) {
      setSubmitError(clientValidationError);
      return;
    }
    setConfirming(true);
  }

  function handleCancel() {
    setConfirming(false);
  }

  function handleConfirm() {
    if (clientValidationError) {
      setSubmitError(clientValidationError);
      return;
    }
    const payload: RotateRulePayload = {
      organizationId: props.project.organizationId,
      projectId: props.project.id,
      launchId: scopeLaunchId,
      name: draftSnapshot.name,
      percentOfCollected: draftSnapshot.percent_of_collected,
      fixedFeePerLaunch: draftSnapshot.fixed_fee_per_launch,
      fixedFeePerSale: draftSnapshot.fixed_fee_per_sale,
      minGuarantee: draftSnapshot.min_guarantee,
      appliesOn: draftSnapshot.applies_on,
    };
    startSubmitTransition(async () => {
      const state = await rotateRule(payload);
      if (state && "ok" in state && state.ok) {
        router.push("/organizacion/reglas-split");
        router.refresh();
      } else if (state && "error" in state) {
        setSubmitError(state.error);
        setConfirming(false);
      }
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Render
  // ═════════════════════════════════════════════════════════════════════════

  const scopeLabel =
    scopeLaunchId
      ? props.launches.find((l) => l.id === scopeLaunchId)?.name ??
        "Lanzamiento"
      : "Default del proyecto (aplica a todos los lanzamientos sin override)";

  return (
    <div className="space-y-6">
      <header className="rounded-md border border-border bg-surface p-4">
        <div className="text-xs uppercase tracking-wide text-fg-subtle">
          Proyecto
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <div className="text-lg font-semibold text-fg">{props.project.name}</div>
          <span className="text-xs text-fg-subtle">
            ownership: {props.project.ownership}
          </span>
        </div>
      </header>

      <fieldset disabled={confirming || submitPending} className="space-y-4">
        {/* ─── Alcance ─────────────────────────────────────────────────── */}
        <section className="rounded-md border border-border bg-surface p-4 space-y-3">
          <div className="text-sm font-semibold text-fg">Alcance</div>
          {scopeLocked ? (
            <div>
              <Label>Se aplica a</Label>
              <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg-muted">
                {scopeLabel}
              </div>
              <p className="mt-1 text-xs text-fg-subtle">
                El alcance no es editable. Para mover la regla a otro
                lanzamiento, creá una nueva regla y desactivá esta.
              </p>
            </div>
          ) : props.isOverrideNew ? (
            <div>
              <Label htmlFor="scope-launch">Se aplica al lanzamiento</Label>
              <Select
                id="scope-launch"
                value={scopeLaunchId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setScopeLaunchId(v === "" ? null : v);
                  if (simLaunchId == null && v !== "") setSimLaunchId(v);
                }}
              >
                <option value="" disabled>
                  Elegí un lanzamiento…
                </option>
                {props.launches.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
              {scopeLaunchId && (
                <ScopeConflictHint willReplace={willReplace} mode="override" />
              )}
            </div>
          ) : (
            <div>
              <Label>Se aplica a</Label>
              <div className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg-muted">
                Default del proyecto — cualquier lanzamiento sin override.
              </div>
              <ScopeConflictHint willReplace={willReplace} mode="default" />
            </div>
          )}
        </section>

        {/* ─── Datos de la regla ───────────────────────────────────────── */}
        <section className="rounded-md border border-border bg-surface p-4 space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-semibold text-fg">Regla</div>
            <button
              type="button"
              onClick={() => {
                if (name.trim().length === 0) setName("Kingrow retiene el 100%");
                setAppliesOn("collected");
                setPercent("100");
                setFixedLaunch("0");
                setFixedSale("0");
                setMinGuarantee("");
              }}
              className="text-xs font-medium text-fg-muted hover:text-fg underline underline-offset-2"
            >
              Aplicar preset: Kingrow retiene el 100%
            </button>
          </div>

          <div>
            <Label htmlFor="rule-name">Nombre</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Kingrow 30% s/cobrado"
              required
            />
          </div>

          <div>
            <Label>Base del porcentaje</Label>
            <div className="space-y-2">
              <RadioOption
                name="applies_on"
                value="collected"
                current={appliesOn}
                onChange={setAppliesOn}
                label="Sobre lo cobrado"
                hint="El porcentaje se aplica a la plata que efectivamente entró (Σ pagos)."
              />
              <RadioOption
                name="applies_on"
                value="sold"
                current={appliesOn}
                onChange={setAppliesOn}
                label="Sobre lo vendido"
                hint="Se aplica al total pactado en las ventas, esté cobrado o no."
              />
            </div>
            <AppliesOnExample
              appliesOn={appliesOn}
              breakdown={breakdown}
              aggregates={simAggregates}
              percent={numOrZero(percent)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="rule-percent">Porcentaje (%)</Label>
              <Input
                id="rule-percent"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max="100"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="rule-fixed-launch">Cargo fijo por liquidación</Label>
              <Input
                id="rule-fixed-launch"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={fixedLaunch}
                onChange={(e) => setFixedLaunch(e.target.value)}
                placeholder="0"
              />
              <p className="mt-1 text-xs text-fg-subtle">
                Monto único que se retiene una vez por liquidación.
              </p>
            </div>
            <div>
              <Label htmlFor="rule-fixed-sale">Cargo fijo por venta</Label>
              <Input
                id="rule-fixed-sale"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={fixedSale}
                onChange={(e) => setFixedSale(e.target.value)}
                placeholder="0"
              />
              <p className="mt-1 text-xs text-fg-subtle">
                Multiplicado por cantidad de ventas del lanzamiento.
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="rule-min-guarantee">Garantía mínima</Label>
            <Input
              id="rule-min-guarantee"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={minGuarantee}
              onChange={(e) => setMinGuarantee(e.target.value)}
              placeholder="Dejá vacío para no aplicar piso"
            />
            <p className="mt-1 text-xs text-fg-subtle">
              Piso para la retención de Kingrow. Si la aritmética diera menos
              que este número, se retiene la garantía. Nunca se retiene más de
              lo cobrado, aunque la garantía lo supere.
            </p>
          </div>
        </section>

        {/* ─── Simulador ─────────────────────────────────────────────────── */}
        <Simulator
          launches={props.launches}
          simLaunchId={simLaunchId}
          onSelectLaunch={setSimLaunchId}
          aggregates={simAggregates}
          breakdown={breakdown}
          pending={simPending}
          error={simError}
        />
      </fieldset>

      {/* ─── Acciones + confirmación ──────────────────────────────────── */}
      {!confirming && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <a
            href="/organizacion/reglas-split"
            className="text-sm font-medium text-fg-muted hover:text-fg"
          >
            Cancelar
          </a>
          <Button type="button" onClick={handleReview}>
            Revisar y guardar
          </Button>
        </div>
      )}

      {confirming && (
        <ConfirmationCard
          project={props.project}
          scopeLabel={scopeLabel}
          willReplace={willReplace}
          draft={draftSnapshot}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          pending={submitPending}
        />
      )}

      {submitError && <FieldError>{submitError}</FieldError>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Piezas auxiliares
// ═══════════════════════════════════════════════════════════════════════════

function RadioOption({
  name,
  value,
  current,
  onChange,
  label,
  hint,
}: {
  readonly name: string;
  readonly value: SettlementAppliesOn;
  readonly current: SettlementAppliesOn;
  readonly onChange: (v: SettlementAppliesOn) => void;
  readonly label: string;
  readonly hint: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        className="mt-1 accent-accent"
      />
      <div>
        <div className="text-sm font-medium text-fg">{label}</div>
        <div className="text-xs text-fg-subtle">{hint}</div>
      </div>
    </label>
  );
}

function AppliesOnExample({
  appliesOn,
  breakdown,
  aggregates,
  percent,
}: {
  readonly appliesOn: SettlementAppliesOn;
  readonly breakdown: SettlementBreakdown | null;
  readonly aggregates: LaunchAggregates | null;
  readonly percent: number;
}) {
  if (!aggregates || !breakdown) return null;
  const otherBase =
    appliesOn === "collected" ? aggregates.totalSold : aggregates.collectedTotal;
  const otherPercent = (percent / 100) * otherBase;
  const delta = Math.abs(breakdown.percentPart - otherPercent);
  if (delta === 0) return null;
  return (
    <p className="mt-2 text-xs text-fg-muted">
      Con estos números, "sobre lo {appliesOn === "collected" ? "cobrado" : "vendido"}"
      retiene <strong>{fMoney(breakdown.percentPart)}</strong> por el componente
      porcentual; "sobre lo {appliesOn === "collected" ? "vendido" : "cobrado"}"
      retendría <strong>{fMoney(otherPercent)}</strong>. Diferencia:{" "}
      <strong>{fMoney(delta)}</strong>.
    </p>
  );
}

function ScopeConflictHint({
  willReplace,
  mode,
}: {
  readonly willReplace: SettlementRuleRow | null;
  readonly mode: "default" | "override";
}) {
  if (!willReplace) return null;
  return (
    <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-fg">
      Ya hay una regla vigente para este {mode === "default" ? "proyecto (default)" : "override"}
      : <strong>{willReplace.name}</strong>. Al guardar quedará desactivada y
      esta la reemplazará. El histórico se conserva.
    </div>
  );
}

function Simulator({
  launches,
  simLaunchId,
  onSelectLaunch,
  aggregates,
  breakdown,
  pending,
  error,
}: {
  readonly launches: readonly LaunchOption[];
  readonly simLaunchId: string | null;
  readonly onSelectLaunch: (id: string | null) => void;
  readonly aggregates: LaunchAggregates | null;
  readonly breakdown: SettlementBreakdown | null;
  readonly pending: boolean;
  readonly error: string | null;
}) {
  return (
    <section className="rounded-md border border-border bg-surface p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-semibold text-fg">Simulador</div>
          <div className="text-xs text-fg-subtle">
            Corre <code>calc.ts</code> con los valores del formulario contra los
            agregados reales del lanzamiento elegido. No escribe nada.
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="sim-launch">Lanzamiento de prueba</Label>
        <Select
          id="sim-launch"
          value={simLaunchId ?? ""}
          onChange={(e) => onSelectLaunch(e.target.value === "" ? null : e.target.value)}
        >
          <option value="" disabled>
            Elegí un lanzamiento…
          </option>
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      {pending && (
        <p className="text-xs text-fg-subtle">Trayendo agregados…</p>
      )}
      {error && <FieldError>{error}</FieldError>}

      {aggregates && breakdown && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatBlock label="Cobrado (Σ pagos)" value={fMoney(aggregates.collectedTotal)} />
            <StatBlock label="Vendido (Σ ventas)" value={fMoney(aggregates.totalSold)} />
            <StatBlock label="Cantidad de ventas" value={String(aggregates.salesCount)} />
          </div>

          <div className="rounded-md border border-border bg-bg-elevated p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">
              Desglose del cálculo
            </div>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <BreakdownLine
                label={`Base (${breakdown.base === aggregates.collectedTotal ? "cobrado" : "vendido"})`}
                value={fMoney(breakdown.base)}
              />
              <BreakdownLine
                label="+ Porcentual"
                value={fMoney(breakdown.percentPart)}
                dim={breakdown.percentPart === 0}
              />
              <BreakdownLine
                label="+ Fijo por liquidación"
                value={fMoney(breakdown.fixedLaunchPart)}
                dim={breakdown.fixedLaunchPart === 0}
              />
              <BreakdownLine
                label="+ Fijo por venta"
                value={fMoney(breakdown.fixedSalePart)}
                dim={breakdown.fixedSalePart === 0}
              />
              <BreakdownLine
                label="= Retención bruta"
                value={fMoney(breakdown.rawRetention)}
              />
              <BreakdownLine
                label={
                  breakdown.retainedAfterGuarantee !== breakdown.rawRetention
                    ? "Piso de garantía aplicado"
                    : "Piso de garantía"
                }
                value={
                  breakdown.retainedAfterGuarantee !== breakdown.rawRetention
                    ? fMoney(breakdown.retainedAfterGuarantee)
                    : "no aplica"
                }
                dim={breakdown.retainedAfterGuarantee === breakdown.rawRetention}
              />
              <BreakdownLine
                label={
                  breakdown.kingrowRetained < breakdown.retainedAfterGuarantee
                    ? "Cap por lo cobrado aplicado"
                    : "Cap por lo cobrado"
                }
                value={
                  breakdown.kingrowRetained < breakdown.retainedAfterGuarantee
                    ? fMoney(breakdown.kingrowRetained)
                    : "no aplica"
                }
                dim={
                  breakdown.kingrowRetained === breakdown.retainedAfterGuarantee
                }
              />
            </dl>

            <hr className="my-3 border-border" />

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TotalLine
                label="Retiene Kingrow"
                value={fMoney(breakdown.kingrowRetained)}
                percent={
                  aggregates.collectedTotal > 0
                    ? breakdown.kingrowRetained / aggregates.collectedTotal
                    : null
                }
              />
              <TotalLine
                label="Queda al cliente"
                value={fMoney(breakdown.owedToClient)}
                percent={
                  aggregates.collectedTotal > 0
                    ? breakdown.owedToClient / aggregates.collectedTotal
                    : null
                }
              />
            </div>
          </div>
        </div>
      )}

      {!aggregates && !pending && !error && (
        <p className="text-xs text-fg-subtle">
          Elegí un lanzamiento para ver la simulación.
        </p>
      )}
    </section>
  );
}

function StatBlock({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-elevated p-3">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1 text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}

function BreakdownLine({
  label,
  value,
  dim,
}: {
  readonly label: string;
  readonly value: string;
  readonly dim?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={dim ? "text-fg-subtle" : "text-fg-muted"}>{label}</dt>
      <dd className={dim ? "text-fg-subtle" : "text-fg font-medium"}>{value}</dd>
    </div>
  );
}

function TotalLine({
  label,
  value,
  percent,
}: {
  readonly label: string;
  readonly value: string;
  readonly percent: number | null;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="text-xs uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="mt-1 text-lg font-bold text-fg">{value}</div>
      {percent != null && (
        <div className="text-xs text-fg-subtle">{fPct(percent)} del cobrado</div>
      )}
    </div>
  );
}

function ConfirmationCard({
  project,
  scopeLabel,
  willReplace,
  draft,
  onCancel,
  onConfirm,
  pending,
}: {
  readonly project: ProjectContext;
  readonly scopeLabel: string;
  readonly willReplace: SettlementRuleRow | null;
  readonly draft: SettlementRuleSnapshot;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly pending: boolean;
}) {
  return (
    <section className="rounded-md border border-accent bg-accent/5 p-5 space-y-4">
      <div className="text-sm font-semibold text-fg">Revisá antes de guardar</div>
      <div className="text-xs text-fg-muted">
        Se aplica al proyecto <strong>{project.name}</strong>, scope:{" "}
        <strong>{scopeLabel}</strong>.
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-3">
          <div className="text-xs uppercase tracking-wide text-fg-subtle">
            Regla que quedará desactivada
          </div>
          {willReplace ? (
            <RuleSummary
              name={willReplace.name}
              appliesOn={willReplace.applies_on}
              percent={willReplace.percent_of_collected}
              fixedLaunch={willReplace.fixed_fee_per_launch}
              fixedSale={willReplace.fixed_fee_per_sale}
              minGuarantee={willReplace.min_guarantee}
            />
          ) : (
            <p className="mt-2 text-sm text-fg-subtle">
              Ninguna — este scope no tenía regla activa.
            </p>
          )}
        </div>

        <div className="rounded-md border border-accent/40 bg-bg-elevated p-3">
          <div className="text-xs uppercase tracking-wide text-fg-subtle">
            Nueva regla vigente
          </div>
          <RuleSummary
            name={draft.name}
            appliesOn={draft.applies_on}
            percent={draft.percent_of_collected}
            fixedLaunch={draft.fixed_fee_per_launch}
            fixedSale={draft.fixed_fee_per_sale}
            minGuarantee={draft.min_guarantee}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          Volver a editar
        </Button>
        <Button type="button" onClick={onConfirm} disabled={pending}>
          {pending ? "Guardando…" : "Confirmar y guardar"}
        </Button>
      </div>
    </section>
  );
}

function RuleSummary({
  name,
  appliesOn,
  percent,
  fixedLaunch,
  fixedSale,
  minGuarantee,
}: {
  readonly name: string;
  readonly appliesOn: SettlementAppliesOn;
  readonly percent: number;
  readonly fixedLaunch: number;
  readonly fixedSale: number;
  readonly minGuarantee: number | null;
}) {
  return (
    <div className="mt-2 space-y-1 text-sm">
      <div className="font-medium text-fg">{name || "(sin nombre)"}</div>
      <div className="text-fg-muted">
        {fPct(percent / 100)} sobre lo {appliesOn === "collected" ? "cobrado" : "vendido"}
      </div>
      {fixedLaunch > 0 && (
        <div className="text-xs text-fg-muted">
          + {fMoney(fixedLaunch)} fijo por liquidación
        </div>
      )}
      {fixedSale > 0 && (
        <div className="text-xs text-fg-muted">
          + {fMoney(fixedSale)} fijo por venta
        </div>
      )}
      {minGuarantee != null && (
        <div className="text-xs text-fg-muted">
          Garantía mínima: {fMoney(minGuarantee)}
        </div>
      )}
    </div>
  );
}

function numOrZero(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
