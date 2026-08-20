import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import { NewLiabilityButton } from "./new-liability-button";
import { PasivosView, type LiabilityRowData } from "./pasivos-view";

export const metadata: Metadata = { title: "Pasivos · Financiero" };

// Pasivos son SNAPSHOTS — sin filtro de período. Filtro por estado
// (vigentes / saldados / todos) — un pasivo saldado sigue en la tabla como
// histórico pero no aparece en `computeNetWorth` (settled_at IS NOT NULL).
type StateParam = "vigentes" | "saldados" | "todos";

const STATE_OPTIONS: ReadonlyArray<{ value: StateParam; label: string }> = [
  { value: "vigentes", label: "Vigentes" },
  { value: "saldados", label: "Saldados" },
  { value: "todos", label: "Todos" },
];

interface LiabilityDbRow {
  readonly id: string;
  readonly name: string;
  readonly liability_type: string;
  readonly description: string | null;
  readonly amount: number;
  readonly currency: string | null;
  readonly incurred_at: string | null;
  readonly due_date: string | null;
  readonly settled_at: string | null;
  readonly active: boolean;
  readonly notes: string | null;
}

export default async function PasivosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const stateParam = parseState(sp.state);

  const supabase = await createClient();
  let query = supabase
    .from("liabilities")
    .select(
      "id, name, liability_type, description, amount, currency, incurred_at, due_date, settled_at, active, notes",
    )
    .order("amount", { ascending: false });

  if (stateParam === "vigentes") {
    query = query.eq("active", true).is("settled_at", null);
  } else if (stateParam === "saldados") {
    query = query.not("settled_at", "is", null);
  }

  const res = await query;
  const liabilities = (res.data ?? []) as unknown as LiabilityDbRow[];

  const totalCount = liabilities.length;
  const totalVigente = liabilities
    .filter((l) => l.active && l.settled_at == null)
    .reduce((acc, l) => acc + Number(l.amount), 0);

  const rows: LiabilityRowData[] = liabilities.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.liability_type,
    description: l.description,
    amount: Number(l.amount),
    currency: l.currency ?? "ARS",
    incurredAt: l.incurred_at,
    dueDate: l.due_date,
    settledAt: l.settled_at,
    notes: l.notes,
    active: l.active,
  }));

  function buildHref(state: StateParam): string {
    if (state === "vigentes") return "/financiero/pasivos";
    return `/financiero/pasivos?state=${state}`;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconFin size={16} />}
        title="Pasivos"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Deuda vigente", v: fMoney(totalVigente) },
        ]}
      />

      <div style={{ display: "flex", gap: 10 }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={STATE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref(o.value),
            active: stateParam === o.value,
          }))}
        />
      </div>

      <Panel
        title="Pasivos"
        pad={false}
        fillHeight
        actions={<NewLiabilityButton />}
      >
        <PasivosView rows={rows} totalCount={totalCount} />
      </Panel>
    </div>
  );
}

function parseState(v: string | string[] | undefined): StateParam {
  if (typeof v !== "string") return "vigentes";
  const allowed: StateParam[] = ["vigentes", "saldados", "todos"];
  return (allowed as string[]).includes(v) ? (v as StateParam) : "vigentes";
}
