"use client";

import { useActionState } from "react";

import type { LaunchActionState } from "@/app/(app)/proyectos/[projectId]/launches/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { LaunchRow } from "@/lib/launches/types";

const TYPES = ["En Vivo", "Automatizado", "Replay"] as const;
const STATUSES = ["Activo", "Escalando", "Finalizado", "Evergreen"] as const;
const PLATFORMS = ["Facebook", "Instagram", "Tiktok", "Youtube", "Email"] as const;

type FormState = LaunchActionState;
type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

export function LaunchForm({
  action,
  initial,
  submitLabel,
}: {
  readonly action: FormAction;
  readonly initial?: LaunchRow;
  readonly submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-10">
      <Section title="Datos básicos">
        <FieldsGrid>
          <Field className="sm:col-span-2">
            <Label htmlFor="name">Nombre *</Label>
            <Input id="name" name="name" required defaultValue={initial?.name ?? ""} />
          </Field>
          <Field>
            <Label htmlFor="date_start">Fecha de inicio</Label>
            <Input
              id="date_start"
              name="date_start"
              type="date"
              defaultValue={initial?.date_start ?? ""}
            />
          </Field>
          <Field>
            <Label htmlFor="date_end">Fecha de fin</Label>
            <Input
              id="date_end"
              name="date_end"
              type="date"
              defaultValue={initial?.date_end ?? ""}
            />
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
        {state?.error && <FieldError>{state.error}</FieldError>}
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
