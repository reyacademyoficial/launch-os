"use client";

import { useActionState, useEffect, useState } from "react";

import type { LaunchActionState } from "@/app/(app)/proyectos/[projectId]/launches/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  DEFAULT_DURATIONS,
  tryComputeLaunchCalendar,
} from "@/lib/launches/calendar";
import type { LaunchRow } from "@/lib/launches/types";

import { LaunchCalendarTable } from "./launch-calendar-table";

const TYPES = ["En Vivo", "Automatizado", "Replay"] as const;
const STATUSES = ["Activo", "Escalando", "Finalizado", "Evergreen"] as const;
const PLATFORMS = ["Facebook", "Instagram", "Tiktok", "Youtube", "Email"] as const;

type FormState = LaunchActionState;
type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

function dur(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

export function LaunchForm({
  action,
  initial,
  submitLabel,
  onSuccess,
  copyableLaunches,
  recycleTargetOptions,
}: {
  readonly action: FormAction;
  readonly initial?: LaunchRow;
  readonly submitLabel: string;
  /**
   * Llamado cuando la action devuelve `{ ok: true }` (caso update). Lo usa
   * `LaunchFormModal` para cerrarse. En create el flujo es distinto: la
   * action redirige a la URL del nuevo launch y el componente se desmonta,
   * así que onSuccess no se dispara — y eso está bien.
   */
  readonly onSuccess?: () => void;
  /**
   * Lista de launches del mismo proyecto desde los que se pueden copiar
   * conexiones (token + integration_config). Solo se muestra el select en
   * modo create (initial === undefined). Si no se pasa o está vacía, no
   * aparece la opción.
   */
  readonly copyableLaunches?: ReadonlyArray<{ id: string; name: string }>;
  /**
   * Lanzamientos del mismo proyecto válidos como destino de reciclado para
   * un evergreen — todos menos el actual. Se renderizan en el select de
   * `recycle_target_launch_id` cuando el checkbox de evergreen está activo.
   */
  readonly recycleTargetOptions?: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  // Estado controlado para los inputs que alimentan la preview del calendario.
  // Otros inputs siguen como uncontrolled (defaultValue) — no nos importa
  // recomputar UI con cada keystroke fuera de la sección Calendario.
  const [launchDate, setLaunchDate] = useState<string>(initial?.launch_date ?? "");
  const [durCaptacion, setDurCaptacion] = useState<number>(
    dur(initial?.dur_captacion, DEFAULT_DURATIONS.durCaptacion),
  );
  const [durCalentamiento, setDurCalentamiento] = useState<number>(
    dur(initial?.dur_calentamiento, DEFAULT_DURATIONS.durCalentamiento),
  );
  const [durCompra, setDurCompra] = useState<number>(
    dur(initial?.dur_compra, DEFAULT_DURATIONS.durCompra),
  );
  const [durCierre, setDurCierre] = useState<number>(
    dur(initial?.dur_cierre, DEFAULT_DURATIONS.durCierre),
  );

  // Estado controlado para evergreen: el select del target se renderiza solo
  // cuando el flag está prendido. El check del DB exige `is_evergreen=true`
  // cuando `recycle_target_launch_id` está seteado, así que en la action
  // forzamos `target=null` si el flag está apagado — esto es coherente.
  const [isEvergreen, setIsEvergreen] = useState<boolean>(
    initial?.is_evergreen ?? false,
  );

  const calendar = tryComputeLaunchCalendar({
    launchDate: launchDate || undefined,
    durCaptacion,
    durCalentamiento,
    durCompra,
    durCierre,
  });

  const showCopyFrom =
    !initial && copyableLaunches !== undefined && copyableLaunches.length > 0;

  return (
    <form action={formAction} className="space-y-10">
      {showCopyFrom && (
        <Section title="Copiar conexiones de">
          <div className="space-y-1">
            <Label htmlFor="copy_from_launch_id">
              Lanzamiento de origen (opcional)
            </Label>
            <Select
              id="copy_from_launch_id"
              name="copy_from_launch_id"
              defaultValue=""
            >
              <option value="">— No copiar nada —</option>
              {copyableLaunches!.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-fg-subtle">
              Copia el token + ad_account_id + campañas. Editable después desde
              la sección Integraciones del lanzamiento nuevo.
            </p>
          </div>
        </Section>
      )}

      <Section title="Datos básicos">
        <FieldsGrid>
          <Field className="sm:col-span-2">
            <Label htmlFor="name">Nombre *</Label>
            <Input id="name" name="name" required defaultValue={initial?.name ?? ""} />
          </Field>
          <Field>
            <Label htmlFor="type">Tipo</Label>
            <Select id="type" name="type" defaultValue={initial?.type ?? ""}>
              <option value="">—</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={initial?.status ?? ""}>
              <option value="">—</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </FieldsGrid>
        <Field className="mt-4">
          <Label>Plataformas</Label>
          <div className="flex flex-wrap gap-3 pt-1">
            {PLATFORMS.map((p) => (
              <label
                key={p}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg-muted has-[input:checked]:border-accent has-[input:checked]:bg-accent/10 has-[input:checked]:text-accent"
              >
                <input
                  type="checkbox"
                  name="platforms"
                  value={p}
                  defaultChecked={initial?.platforms?.includes(p)}
                  className="accent-accent"
                />
                {p}
              </label>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Calendario del lanzamiento">
        <p className="text-xs text-fg-subtle">
          La fecha del lanzamiento es la fecha de la Clase 1. Las 4 duraciones
          son configurables por lanzamiento — defaults <b>21/14/5/3</b> días.
          <code className="ml-1 rounded bg-surface px-1 py-0.5 text-fg">date_start</code>
          {" "}y{" "}
          <code className="rounded bg-surface px-1 py-0.5 text-fg">date_end</code>
          {" "}quedan derivadas automáticamente (las usa el sync engine).
        </p>
        <FieldsGrid>
          <Field>
            <Label htmlFor="launch_date">Fecha de lanzamiento (Clase 1)</Label>
            <Input
              id="launch_date"
              name="launch_date"
              type="date"
              value={launchDate}
              onChange={(e) => setLaunchDate(e.target.value)}
            />
          </Field>
          <DurField
            id="dur_captacion"
            label="Días de captación"
            value={durCaptacion}
            onChange={setDurCaptacion}
          />
          <DurField
            id="dur_calentamiento"
            label="Días de calentamiento"
            value={durCalentamiento}
            onChange={setDurCalentamiento}
          />
          <DurField
            id="dur_compra"
            label="Días de compra"
            value={durCompra}
            onChange={setDurCompra}
          />
          <DurField
            id="dur_cierre"
            label="Días de cierre"
            value={durCierre}
            onChange={setDurCierre}
          />
        </FieldsGrid>

        {calendar ? (
          <div className="mt-4 rounded-md border border-border bg-surface/40 p-4">
            <h3 className="mb-3 text-sm font-semibold text-fg">
              Preview en vivo
            </h3>
            <LaunchCalendarTable calendar={calendar} />
          </div>
        ) : (
          <p className="mt-4 text-xs text-fg-subtle">
            Elegí la fecha de lanzamiento para ver el calendario calculado.
          </p>
        )}
      </Section>

      <Section title="Evergreen">
        <p className="text-xs text-fg-subtle">
          Un evergreen es un lanzamiento normal que corre constantemente. Al
          cerrarlo, los leads que <b>no</b> compraron se transfieren al
          lanzamiento destino para que sigan en pipeline.
        </p>
        <label className="mt-3 inline-flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            name="is_evergreen"
            checked={isEvergreen}
            onChange={(e) => setIsEvergreen(e.target.checked)}
            className="accent-accent"
          />
          Este lanzamiento es evergreen
        </label>
        {isEvergreen && (
          <Field className="mt-3 max-w-md">
            <Label htmlFor="recycle_target_launch_id">
              Lanzamiento destino al cerrar
            </Label>
            <Select
              id="recycle_target_launch_id"
              name="recycle_target_launch_id"
              defaultValue={initial?.recycle_target_launch_id ?? ""}
            >
              <option value="">— Sin destino —</option>
              {(recycleTargetOptions ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-fg-subtle">
              Sin destino, al cerrar no se reciclan leads y queda un aviso al
              equipo en la campanita.
            </p>
          </Field>
        )}
      </Section>

      <ChannelSection
        title="Meta Ads"
        prefix="meta"
        initial={initial}
      />
      <ChannelSection
        title="Google Ads"
        prefix="google"
        initial={initial}
      />
      <ChannelSection
        title="TikTok Ads"
        prefix="tiktok"
        initial={initial}
      />

      <Section title="Webinar / lifecycle">
        <FieldsGrid>
          <NumberField name="registrados" label="Registrados" initial={initial} />
          <NumberField name="asistentes" label="Asistentes" initial={initial} />
          <NumberField name="hasta_pitch" label="Hasta el pitch" initial={initial} />
          <NumberField name="contactos_api" label="Contactos via API" initial={initial} />
        </FieldsGrid>
      </Section>

      <Section title="Conversión + revenue">
        <FieldsGrid>
          <NumberField name="ventas_total" label="Ventas totales" initial={initial} />
          <NumberField name="ventas_mensuales" label="Ventas mensuales" initial={initial} />
          <NumberField name="ventas_anuales" label="Ventas anuales" initial={initial} />
          <NumberField
            name="revenue"
            label="Revenue"
            step="0.01"
            initial={initial}
          />
          <NumberField
            name="ingresos_whatsapp"
            label="Ingresos via WhatsApp"
            step="0.01"
            initial={initial}
          />
        </FieldsGrid>
      </Section>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </Button>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}

// ─── presentational helpers ───────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function FieldsGrid({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

function Field({
  children,
  className = "",
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return <div className={className}>{children}</div>;
}

function DurField({
  id,
  label,
  value,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly onChange: (next: number) => void;
}) {
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="number"
        min="0"
        step="1"
        value={String(value)}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10);
          onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
        }}
      />
    </Field>
  );
}

function ChannelSection({
  title,
  prefix,
  initial,
}: {
  readonly title: string;
  readonly prefix: "meta" | "google" | "tiktok";
  readonly initial?: LaunchRow;
}) {
  return (
    <Section title={title}>
      <FieldsGrid>
        <NumberField
          name={`${prefix}_investment`}
          label="Inversión"
          step="0.01"
          initial={initial}
        />
        <NumberField name={`${prefix}_clicks`} label="Clicks" initial={initial} />
        <NumberField name={`${prefix}_leads`} label="Leads" initial={initial} />
      </FieldsGrid>
    </Section>
  );
}

function NumberField({
  name,
  label,
  step,
  initial,
}: {
  readonly name: string;
  readonly label: string;
  readonly step?: string;
  readonly initial?: LaunchRow;
}) {
  const raw = initial?.[name as keyof LaunchRow];
  const defaultValue = typeof raw === "number" ? String(raw) : "";
  return (
    <Field>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="number"
        step={step ?? "1"}
        min="0"
        defaultValue={defaultValue}
        placeholder="0"
      />
    </Field>
  );
}
