import { describe, it, expect } from "vitest";

import type {
  CommissionRuleRow,
  CommissionRuleTierRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import type { LeadRow } from "@/lib/leads/types";
import type { TeamMemberPayoutRow } from "@/lib/payouts/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { aggregateLeaderboard } from "./aggregate";

const TS = "2026-06-10T00:00:00Z";

function tm(id: string, name: string): TeamMemberRow {
  return {
    id,
    project_id: "p-1",
    name,
    role: "closer",
    commission_rate: null,
    active: true,
    created_at: TS,
    updated_at: TS,
  };
}

function lead(
  id: string,
  overrides: Partial<LeadRow> = {},
): LeadRow {
  return {
    id,
    project_id: "p-1",
    launch_id: null,
    team_member_id: null,
    name: id,
    contact: null,
    email: null,
    phone_normalized: null,
    external_id: null,
    pinned_to_kanban: false,
    source: "manual",
    status: "frio",
    notes: null,
    recycled_from_launch_id: null,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

function sale(
  id: string,
  overrides: Partial<SaleRow> = {},
): SaleRow {
  return {
    id,
    project_id: "p-1",
    lead_id: "lead-x",
    launch_id: null,
    team_member_id: null,
    payment_modality_id: "mod-1",
    product_id: "prod-1",
    total_amount: 1000,
    currency: "ARS",
    closed_at: "2026-06-10T00:00:00Z",
    installment_count: 1,
    installment_frequency: "single",
    grace_days: 5,
    commission_rule_snapshot: null,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

function payment(saleId: string, amount: number): PaymentRow {
  return {
    id: `pay-${Math.random()}`,
    sale_id: saleId,
    amount,
    paid_at: "2026-06-11",
    notes: null,
    installment_id: null,
    payment_method_id: null,
    original_currency: null,
    created_at: TS,
    updated_at: TS,
  };
}

function tier(overrides: Partial<CommissionRuleTierRow> = {}): CommissionRuleTierRow {
  return {
    id: `tier-${Math.random()}`,
    rule_id: "r-1",
    min_count: 0,
    max_count: null,
    type: "percent",
    value: 10,
    currency: "ARS",
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

function ruleSingleTier(overrides: {
  id?: string;
  launch_id?: string | null;
  product_id?: string | null;
  modality_ids?: string[];
  type?: "percent" | "fixed";
  value?: number;
} = {}): CommissionRuleRow {
  return {
    id: overrides.id ?? "r-1",
    project_id: "p-1",
    launch_id: overrides.launch_id ?? null,
    product_id: overrides.product_id ?? null,
    accrual_mode: "proportional",
    threshold_type: null,
    threshold_value: null,
    modality_ids: overrides.modality_ids ?? ["mod-1"],
    tiers: [
      tier({
        type: overrides.type ?? "percent",
        value: overrides.value ?? 10,
      }),
    ],
    created_at: TS,
    updated_at: TS,
  };
}

const RULE_10_PERCENT = ruleSingleTier();

describe("aggregateLeaderboard — sin filtros", () => {
  it("cuenta leads, sales y comisión por miembro", () => {
    const closer = tm("tm-1", "Closer");
    const teamMembers = [closer];
    const leads = [
      lead("l-1", { team_member_id: "tm-1", status: "cerrado" }),
      lead("l-2", { team_member_id: "tm-1" }),
      lead("l-3", { team_member_id: "tm-1" }),
    ];
    const sales = [
      sale("s-1", { lead_id: "l-1", team_member_id: "tm-1", total_amount: 1000 }),
    ];
    const payments = [payment("s-1", 500)];

    const rows = aggregateLeaderboard({
      teamMembers,
      leads,
      sales,
      payments,
      rules: [RULE_10_PERCENT],
      filters: {},
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.leadsWorked).toBe(3);
    expect(rows[0]!.closed).toBe(1);
    expect(rows[0]!.conversionRate).toBeCloseTo((1 / 3) * 100);
    expect(rows[0]!.revenueCollected).toBe(500);
    expect(rows[0]!.commissionAccruedArs).toBe(50);
  });

  it("miembro sin leads ni sales devuelve fila con ceros", () => {
    const rows = aggregateLeaderboard({
      teamMembers: [tm("tm-1", "Solo")],
      leads: [],
      sales: [],
      payments: [],
      rules: [],
      filters: {},
    });
    expect(rows[0]!.leadsWorked).toBe(0);
    expect(rows[0]!.closed).toBe(0);
    expect(rows[0]!.conversionRate).toBe(0);
    expect(rows[0]!.revenueCollected).toBe(0);
    expect(rows[0]!.commissionAccruedArs).toBe(0);
  });

  it("sale con team_member_id distinto del lead se imputa al dueño del lead", () => {
    // Antes del fix 0036 esto era el bug raíz: una sale con sale.team_member_id
    // desalineado quedaba excluida o atribuida a otro. Ahora la atribución
    // viene 100% de lead.team_member_id; `sale.team_member_id` se ignora acá.
    const closer = tm("tm-1", "Closer");
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [
        lead("l-1", { team_member_id: "tm-1", status: "cerrado" }),
      ],
      sales: [sale("s-1", { lead_id: "l-1", team_member_id: null })],
      payments: [payment("s-1", 100)],
      rules: [RULE_10_PERCENT],
      filters: {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.teamMember?.id).toBe("tm-1");
    expect(rows[0]!.closed).toBe(1);
    expect(rows[0]!.revenueCollected).toBe(100);
    expect(rows[0]!.commissionAccruedArs).toBe(10);
  });

  it("aparece fila 'Sin asignar' cuando hay leads o sales sin dueño", () => {
    const closer = tm("tm-1", "Closer");
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [
        lead("l-1", { team_member_id: "tm-1", status: "cerrado" }),
        lead("l-orphan", { team_member_id: null, status: "cerrado" }),
      ],
      sales: [
        sale("s-1", { lead_id: "l-1", team_member_id: "tm-1", total_amount: 1000 }),
        sale("s-orphan", { lead_id: "l-orphan", team_member_id: null, total_amount: 500 }),
      ],
      payments: [payment("s-1", 1000), payment("s-orphan", 500)],
      rules: [RULE_10_PERCENT],
      filters: {},
    });
    expect(rows).toHaveLength(2);
    const named = rows.find((r) => r.teamMember?.id === "tm-1")!;
    const unassigned = rows.find((r) => r.teamMember === null)!;
    expect(named.closed).toBe(1);
    expect(named.revenueCollected).toBe(1000);
    expect(unassigned.closed).toBe(1);
    expect(unassigned.revenueCollected).toBe(500);
    // El total reconcilia: cobrado del proyecto = 1500.
    expect(named.revenueCollected + unassigned.revenueCollected).toBe(1500);
  });

  it("no agrega fila 'Sin asignar' si no hay leads ni sales huérfanos", () => {
    const closer = tm("tm-1", "Closer");
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [lead("l-1", { team_member_id: "tm-1" })],
      sales: [],
      payments: [],
      rules: [],
      filters: {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.teamMember?.id).toBe("tm-1");
  });
});

describe("aggregateLeaderboard — filtro launch", () => {
  it("filtra leads y sales por launch_id (heredando de lead)", () => {
    const closer = tm("tm-1", "Closer");
    const leads = [
      lead("l-A", { team_member_id: "tm-1", launch_id: "launch-A", status: "cerrado" }),
      lead("l-B", { team_member_id: "tm-1", launch_id: "launch-B", status: "cerrado" }),
    ];
    const sales = [
      sale("s-A", { lead_id: "l-A", launch_id: "launch-A", team_member_id: "tm-1", total_amount: 1000 }),
      sale("s-B", { lead_id: "l-B", launch_id: "launch-B", team_member_id: "tm-1", total_amount: 2000 }),
    ];
    const payments = [payment("s-A", 1000), payment("s-B", 2000)];

    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads,
      sales,
      payments,
      rules: [RULE_10_PERCENT],
      filters: { launchId: "launch-A" },
    });

    expect(rows[0]!.leadsWorked).toBe(1);
    expect(rows[0]!.closed).toBe(1);
    expect(rows[0]!.revenueCollected).toBe(1000);
    expect(rows[0]!.commissionAccruedArs).toBe(100);
  });

  it("leads sin launch quedan afuera cuando hay filtro de launch", () => {
    const closer = tm("tm-1", "Closer");
    const leads = [
      lead("l-A", { team_member_id: "tm-1", launch_id: null }),
    ];
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads,
      sales: [],
      payments: [],
      rules: [],
      filters: { launchId: "launch-A" },
    });
    expect(rows[0]!.leadsWorked).toBe(0);
  });
});

describe("aggregateLeaderboard — filtro fechas", () => {
  it("dateFrom/dateTo filtran por sale.closed_at (inclusive)", () => {
    // El filtro de fecha NO esconde leads, solo sales. Por eso ponemos los
    // dos leads cerrados: `closed` cuenta leads (=2), pero el período acota
    // qué sales suman a revenue/comisión (solo s-jul).
    const closer = tm("tm-1", "Closer");
    const leads = [
      lead("l-jun", { team_member_id: "tm-1", status: "cerrado" }),
      lead("l-jul", { team_member_id: "tm-1", status: "cerrado" }),
    ];
    const sales = [
      sale("s-jun", {
        lead_id: "l-jun",
        team_member_id: "tm-1",
        total_amount: 1000,
        closed_at: "2026-06-05T00:00:00Z",
      }),
      sale("s-jul", {
        lead_id: "l-jul",
        team_member_id: "tm-1",
        total_amount: 2000,
        closed_at: "2026-07-05T00:00:00Z",
      }),
    ];
    const payments = [payment("s-jun", 1000), payment("s-jul", 2000)];

    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads,
      sales,
      payments,
      rules: [RULE_10_PERCENT],
      filters: { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
    });

    // `closed` = leads del miembro con status='cerrado' (no se filtran por
    // fecha). Las dos sales tienen leads cerrados → closed = 2.
    expect(rows[0]!.closed).toBe(2);
    // El revenue del período: solo s-jul cae adentro.
    expect(rows[0]!.revenueCollected).toBe(2000);
    expect(rows[0]!.commissionAccruedArs).toBe(200);
  });

  it("sin filtro de fecha → todas las épocas suman", () => {
    const closer = tm("tm-1", "Closer");
    const leads = [
      lead("l-old", { team_member_id: "tm-1", status: "cerrado" }),
      lead("l-new", { team_member_id: "tm-1", status: "cerrado" }),
    ];
    const sales = [
      sale("s-2025", {
        lead_id: "l-old",
        team_member_id: "tm-1",
        total_amount: 500,
        closed_at: "2025-01-01T00:00:00Z",
      }),
      sale("s-2026", {
        lead_id: "l-new",
        team_member_id: "tm-1",
        total_amount: 1500,
        closed_at: "2026-06-01T00:00:00Z",
      }),
    ];
    const payments = [payment("s-2025", 500), payment("s-2026", 1500)];

    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads,
      sales,
      payments,
      rules: [RULE_10_PERCENT],
      filters: {},
    });
    expect(rows[0]!.closed).toBe(2);
    expect(rows[0]!.revenueCollected).toBe(2000);
  });
});

describe("aggregateLeaderboard — sin regla aplicable", () => {
  it("sale sin regla → revenue cuenta, comisión = 0", () => {
    const closer = tm("tm-1", "Closer");
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [lead("l-1", { team_member_id: "tm-1" })],
      sales: [
        sale("s-1", {
          lead_id: "l-1",
          team_member_id: "tm-1",
          payment_modality_id: "mod-sin-regla",
          total_amount: 1000,
        }),
      ],
      payments: [payment("s-1", 1000)],
      rules: [],
      filters: {},
    });
    expect(rows[0]!.revenueCollected).toBe(1000);
    expect(rows[0]!.commissionAccruedArs).toBe(0);
  });
});

function payout(
  teamMemberId: string,
  launchId: string,
  amount: number,
  paidAt = "2026-06-15",
): TeamMemberPayoutRow {
  return {
    id: `payout-${Math.random()}`,
    project_id: "p-1",
    team_member_id: teamMemberId,
    launch_id: launchId,
    amount,
    paid_at: paidAt,
    notes: null,
    created_at: TS,
    updated_at: TS,
  };
}

describe("aggregateLeaderboard — payouts", () => {
  it("paidOut = suma de payouts del miembro, pending = comisión - pagado", () => {
    const closer = tm("tm-1", "Closer");
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [lead("l-1", { team_member_id: "tm-1", launch_id: "launch-A" })],
      sales: [
        sale("s-1", {
          lead_id: "l-1",
          team_member_id: "tm-1",
          total_amount: 1000,
        }),
      ],
      payments: [payment("s-1", 1000)],
      rules: [RULE_10_PERCENT],
      payouts: [
        payout("tm-1", "launch-A", 30),
        payout("tm-1", "launch-A", 20),
      ],
      filters: {},
    });
    expect(rows[0]!.commissionAccruedArs).toBe(100);
    expect(rows[0]!.paidOut).toBe(50);
    expect(rows[0]!.pending).toBe(50);
  });

  it("filtro de launch — solo cuenta payouts de ese launch", () => {
    const closer = tm("tm-1", "Closer");
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [
        lead("l-A", { team_member_id: "tm-1", launch_id: "launch-A" }),
        lead("l-B", { team_member_id: "tm-1", launch_id: "launch-B" }),
      ],
      sales: [
        sale("s-A", { lead_id: "l-A", launch_id: "launch-A", team_member_id: "tm-1", total_amount: 1000 }),
        sale("s-B", { lead_id: "l-B", launch_id: "launch-B", team_member_id: "tm-1", total_amount: 1000 }),
      ],
      payments: [payment("s-A", 1000), payment("s-B", 1000)],
      rules: [RULE_10_PERCENT],
      payouts: [
        payout("tm-1", "launch-A", 70),
        payout("tm-1", "launch-B", 40),
      ],
      filters: { launchId: "launch-A" },
    });
    expect(rows[0]!.commissionAccruedArs).toBe(100);
    expect(rows[0]!.paidOut).toBe(70);
    expect(rows[0]!.pending).toBe(30);
  });

  it("pending negativo cuando se pagó de más", () => {
    const closer = tm("tm-1", "Closer");
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [lead("l-1", { team_member_id: "tm-1", launch_id: "launch-A" })],
      sales: [
        sale("s-1", {
          lead_id: "l-1",
          team_member_id: "tm-1",
          total_amount: 1000,
        }),
      ],
      payments: [payment("s-1", 500)],
      rules: [RULE_10_PERCENT],
      payouts: [payout("tm-1", "launch-A", 200)],
      filters: {},
    });
    expect(rows[0]!.commissionAccruedArs).toBe(50);
    expect(rows[0]!.paidOut).toBe(200);
    expect(rows[0]!.pending).toBe(-150);
  });

  it("filtro de fecha aplica sobre payout.paid_at", () => {
    const closer = tm("tm-1", "Closer");
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [lead("l-1", { team_member_id: "tm-1", launch_id: "launch-A" })],
      sales: [
        sale("s-1", {
          lead_id: "l-1",
          team_member_id: "tm-1",
          total_amount: 1000,
          closed_at: "2026-07-05T00:00:00Z",
        }),
      ],
      payments: [payment("s-1", 1000)],
      rules: [RULE_10_PERCENT],
      payouts: [
        payout("tm-1", "launch-A", 50, "2026-07-15"),
        payout("tm-1", "launch-A", 999, "2026-06-15"),
      ],
      filters: { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
    });
    expect(rows[0]!.paidOut).toBe(50);
  });
});

describe("aggregateLeaderboard — launch override", () => {
  it("usa la regla override del launch del lead, no la default", () => {
    const closer = tm("tm-1", "Closer");
    const ruleDefault = ruleSingleTier({ id: "r-default", launch_id: null, value: 10 });
    const ruleOverride = ruleSingleTier({ id: "r-override", launch_id: "launch-X", value: 25 });
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [
        lead("l-1", { team_member_id: "tm-1", launch_id: "launch-X" }),
      ],
      sales: [
        sale("s-1", {
          lead_id: "l-1",
          launch_id: "launch-X",
          team_member_id: "tm-1",
          total_amount: 1000,
        }),
      ],
      payments: [payment("s-1", 1000)],
      rules: [ruleDefault, ruleOverride],
      filters: {},
    });
    expect(rows[0]!.commissionAccruedArs).toBe(250);
  });
});

describe("aggregateLeaderboard — tiers marginales por launch", () => {
  it("rankea por closed_at asc dentro de (member, launch) y aplica tier marginal", () => {
    const closer = tm("tm-1", "Closer");
    // Regla escalonada: ventas 1-2 al 10%, 3+ al 20%.
    const ruleTiered: CommissionRuleRow = {
      id: "r-tiered",
      project_id: "p-1",
      launch_id: null,
      product_id: null,
      accrual_mode: "proportional",
      threshold_type: null,
      threshold_value: null,
      modality_ids: ["mod-1"],
      tiers: [
        tier({ id: "t-low", min_count: 0, max_count: 1, type: "percent", value: 10 }),
        tier({ id: "t-high", min_count: 2, max_count: null, type: "percent", value: 20 }),
      ],
      created_at: TS,
      updated_at: TS,
    };

    const leads = [
      lead("l-A", { team_member_id: "tm-1", launch_id: "launch-A" }),
      lead("l-B", { team_member_id: "tm-1", launch_id: "launch-A" }),
      lead("l-C", { team_member_id: "tm-1", launch_id: "launch-A" }),
    ];
    const sales = [
      sale("s-1st", {
        lead_id: "l-A",
        team_member_id: "tm-1",
        total_amount: 1000,
        closed_at: "2026-06-01T00:00:00Z",
      }),
      sale("s-2nd", {
        lead_id: "l-B",
        team_member_id: "tm-1",
        total_amount: 1000,
        closed_at: "2026-06-02T00:00:00Z",
      }),
      sale("s-3rd", {
        lead_id: "l-C",
        team_member_id: "tm-1",
        total_amount: 1000,
        closed_at: "2026-06-03T00:00:00Z",
      }),
    ];
    const payments = [
      payment("s-1st", 1000),
      payment("s-2nd", 1000),
      payment("s-3rd", 1000),
    ];

    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads,
      sales,
      payments,
      rules: [ruleTiered],
      filters: {},
    });
    // 1ra venta: 10% × 1000 = 100
    // 2da venta: 10% × 1000 = 100
    // 3ra venta: 20% × 1000 = 200
    // total = 400
    expect(rows[0]!.commissionAccruedArs).toBe(400);
  });

  it("el rank usa el histórico aun cuando dateFrom esconde ventas previas", () => {
    const closer = tm("tm-1", "Closer");
    const ruleTiered: CommissionRuleRow = {
      id: "r-tiered",
      project_id: "p-1",
      launch_id: null,
      product_id: null,
      accrual_mode: "proportional",
      threshold_type: null,
      threshold_value: null,
      modality_ids: ["mod-1"],
      tiers: [
        tier({ min_count: 0, max_count: 1, type: "percent", value: 10 }),
        tier({ min_count: 2, max_count: null, type: "percent", value: 20 }),
      ],
      created_at: TS,
      updated_at: TS,
    };
    const leads = [
      lead("l-A", { team_member_id: "tm-1", launch_id: "launch-A" }),
      lead("l-B", { team_member_id: "tm-1", launch_id: "launch-A" }),
      lead("l-C", { team_member_id: "tm-1", launch_id: "launch-A" }),
    ];
    // 2 ventas en mayo (ranks 0, 1) — escondidas por el filtro.
    // 1 venta en julio (rank 2) — visible y debería usar tier alto.
    const sales = [
      sale("s-may1", {
        lead_id: "l-A",
        team_member_id: "tm-1",
        total_amount: 1000,
        closed_at: "2026-05-01T00:00:00Z",
      }),
      sale("s-may2", {
        lead_id: "l-B",
        team_member_id: "tm-1",
        total_amount: 1000,
        closed_at: "2026-05-15T00:00:00Z",
      }),
      sale("s-jul", {
        lead_id: "l-C",
        team_member_id: "tm-1",
        total_amount: 1000,
        closed_at: "2026-07-01T00:00:00Z",
      }),
    ];
    const payments = [
      payment("s-may1", 1000),
      payment("s-may2", 1000),
      payment("s-jul", 1000),
    ];
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads,
      sales,
      payments,
      rules: [ruleTiered],
      filters: { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
    });
    // Solo s-jul entra al resumen, pero su rank es 2 → tier alto (20%).
    expect(rows[0]!.commissionAccruedArs).toBe(200);
  });
});

describe("aggregateLeaderboard — threshold_full", () => {
  it("no devenga hasta cuota 3, después libera 4% del total", () => {
    const closer = tm("tm-1", "Closer");
    const rule: CommissionRuleRow = {
      id: "r-th",
      project_id: "p-1",
      launch_id: null,
      product_id: null,
      accrual_mode: "threshold_full",
      threshold_type: "payment_count",
      threshold_value: 3,
      modality_ids: ["mod-1"],
      tiers: [tier({ type: "percent", value: 4 })],
      created_at: TS,
      updated_at: TS,
    };
    const leads = [lead("l-1", { team_member_id: "tm-1" })];
    const sales = [
      sale("s-1", {
        lead_id: "l-1",
        team_member_id: "tm-1",
        total_amount: 1800,
      }),
    ];
    // Solo 2 cobros — no llega al umbral.
    const rowsBefore = aggregateLeaderboard({
      teamMembers: [closer],
      leads,
      sales,
      payments: [payment("s-1", 300), payment("s-1", 300)],
      rules: [rule],
      filters: {},
    });
    expect(rowsBefore[0]!.commissionAccruedArs).toBe(0);

    // 3 cobros — cruza el umbral, libera 4% × 1800 = 72.
    const rowsAfter = aggregateLeaderboard({
      teamMembers: [closer],
      leads,
      sales,
      payments: [payment("s-1", 300), payment("s-1", 300), payment("s-1", 300)],
      rules: [rule],
      filters: {},
    });
    expect(rowsAfter[0]!.commissionAccruedArs).toBe(72);
  });
});
