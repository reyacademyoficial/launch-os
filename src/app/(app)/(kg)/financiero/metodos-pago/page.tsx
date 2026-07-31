import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { listBanks } from "@/lib/banks/list";
import { fCount } from "@/lib/finance/format";
import { effectiveCurrency, fmtArs, fmtUsd } from "@/lib/money";
import { listAllPaymentMethods } from "@/lib/payment-methods/list";
import { listAccessibleProjects } from "@/lib/projects/list";
import { createClient } from "@/lib/supabase/server";

import type {
  BankOption,
  ProjectOption,
} from "./payment-method-form-drawer";
import {
  MetodosPagoView,
  type PaymentMethodRowData,
} from "./metodos-pago-view";

export const metadata: Metadata = { title: "Métodos de pago · Financiero" };

// Métodos de pago son estructurales, no eventos — sin filtro de período.
// Filtro por estado (activos/inactivos/todos) + filtro por proyecto.
type ActiveParam = "activos" | "inactivos" | "todos";

const ACTIVE_OPTIONS: ReadonlyArray<{ value: ActiveParam; label: string }> = [
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Dados de baja" },
  { value: "todos", label: "Todos" },
];

interface PaymentRow {
  readonly amount: number;
  readonly payment_method_id: string | null;
}

export default async function MetodosPagoPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeParam = parseActive(sp.state);
  const projectFilter =
    typeof sp.project === "string" && sp.project.trim().length > 0
      ? sp.project
      : null;

  const supabase = await createClient();

  const [methods, banks, projects, paymentsRes] = await Promise.all([
    listAllPaymentMethods(),
    listBanks(),
    listAccessibleProjects(),
    // Cobros totales por método — para mostrar cuánto ingresó por cada uno.
    supabase.from("payments").select("amount, payment_method_id"),
  ]);
  const payments = (paymentsRes.data ?? []) as unknown as PaymentRow[];

  // Índice de agregación por método.
  const collectedByMethod = new Map<string, number>();
  for (const p of payments) {
    if (!p.payment_method_id) continue;
    collectedByMethod.set(
      p.payment_method_id,
      (collectedByMethod.get(p.payment_method_id) ?? 0) + Number(p.amount ?? 0),
    );
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const bankById = new Map(banks.map((b) => [b.id, b]));

  // ─── Filtrar + serializar ─────────────────────────────────────────────
  const filtered = methods.filter((m) => {
    if (activeParam === "activos" && !m.active) return false;
    if (activeParam === "inactivos" && m.active) return false;
    if (projectFilter && m.project_id !== projectFilter) return false;
    return true;
  });

  const rows: PaymentMethodRowData[] = filtered.map((m) => {
    const project = projectById.get(m.project_id);
    const bank = m.bank_id ? bankById.get(m.bank_id) ?? null : null;
    return {
      id: m.id,
      projectId: m.project_id,
      projectName: project?.name ?? "—",
      name: m.name,
      bankId: m.bank_id,
      bankName: bank?.name ?? null,
      bankActive: bank?.active ?? null,
      effectiveCurrency: effectiveCurrency(m, bank),
      currency: m.currency,
      amountCollected: collectedByMethod.get(m.id) ?? 0,
      active: m.active,
    };
  });

  const totalCount = rows.length;
  // Sumamos separado por moneda — sumar ARS + USD no tiene sentido físico.
  // El total consolidado en USD sale en el dashboard financiero (task #8).
  const totalCollectedARS = rows
    .filter((r) => r.effectiveCurrency === "ARS")
    .reduce((a, r) => a + r.amountCollected, 0);
  const totalCollectedUSD = rows
    .filter((r) => r.effectiveCurrency === "USD")
    .reduce((a, r) => a + r.amountCollected, 0);
  const withoutBank = rows.filter((r) => !r.bankId).length;

  // ─── Opciones para el drawer ──────────────────────────────────────────
  const projectsForDrawer: ProjectOption[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));
  const banksForDrawer: BankOption[] = banks.map((b) => ({
    id: b.id,
    name: b.name,
    currency: b.currency,
    active: b.active,
  }));

  // ─── Pills de proyecto (filtro) ────────────────────────────────────────
  const projectsWithMethods = new Set(methods.map((m) => m.project_id));
  const projectPillOptions = [
    {
      label: "Todos los proyectos",
      href: buildHref({ state: activeParam, project: null }),
      active: projectFilter == null,
    },
    ...projects
      .filter((p) => projectsWithMethods.has(p.id))
      .map((p) => ({
        label: p.name,
        href: buildHref({ state: activeParam, project: p.id }),
        active: projectFilter === p.id,
      })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Métodos de pago"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Cobrado ARS", v: fmtArs(totalCollectedARS) },
          { l: "Cobrado USD", v: fmtUsd(totalCollectedUSD) },
          {
            l: "Sin banco asignado",
            v: fCount(withoutBank),
            c: withoutBank > 0 ? "#FFB800" : undefined,
          },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={ACTIVE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ state: o.value, project: projectFilter }),
            active: activeParam === o.value,
          }))}
        />
        {projectPillOptions.length > 1 && (
          <KgParamPills
            ariaLabel="Filtrar por proyecto"
            options={projectPillOptions}
          />
        )}
      </div>

      <Panel title="Métodos de pago" pad={false}>
        <MetodosPagoView
          rows={rows}
          totalCount={totalCount}
          projects={projectsForDrawer}
          banks={banksForDrawer}
        />
      </Panel>
    </div>
  );
}

function parseActive(v: string | string[] | undefined): ActiveParam {
  if (typeof v !== "string") return "activos";
  const allowed: ActiveParam[] = ["activos", "inactivos", "todos"];
  return (allowed as string[]).includes(v) ? (v as ActiveParam) : "activos";
}

function buildHref(overrides: {
  state: ActiveParam;
  project: string | null;
}): string {
  const params = new URLSearchParams();
  if (overrides.state !== "activos") params.set("state", overrides.state);
  if (overrides.project) params.set("project", overrides.project);
  const qs = params.toString();
  return qs ? `/financiero/metodos-pago?${qs}` : "/financiero/metodos-pago";
}
