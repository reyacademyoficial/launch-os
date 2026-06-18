import { describe, it, expect } from "vitest";

import type {
  CommissionRuleRow,
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
    team_member_id: null,
    payment_modality_id: "mod-1",
    total_amount: 1000,
    closed_at: "2026-06-10T00:00:00Z",
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
    created_at: TS,
    updated_at: TS,
  };
}

const RULE_10_PERCENT: CommissionRuleRow = {
  id: "r-1",
  project_id: "p-1",
  payment_modality_id: "mod-1",
  launch_id: null,
  type: "percent",
  value: 10,
  created_at: TS,
  updated_at: TS,
};

describe("aggregateLeaderboard — sin filtros", () => {
  it("cuenta leads, sales y comisión por miembro", () => {
    const closer = tm("tm-1", "Closer");
    const teamMembers = [closer];
    const leads = [
      lead("l-1", { team_member_id: "tm-1" }),
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
    expect(rows[0]!.conversionRate).toBeCloseTo(1 / 3);
    expect(rows[0]!.revenueCollected).toBe(500);
    expect(rows[0]!.commissionAccrued).toBe(50); // 500 * 10%
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
    expect(rows[0]!.commissionAccrued).toBe(0);
  });

  it("sale sin team_member queda excluida (no se imputa a nadie)", () => {
    const closer = tm("tm-1", "Closer");
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [lead("l-1", { team_member_id: "tm-1" })],
      sales: [sale("s-1", { lead_id: "l-1", team_member_id: null })],
      payments: [payment("s-1", 100)],
      rules: [RULE_10_PERCENT],
      filters: {},
    });
    expect(rows[0]!.closed).toBe(0);
    expect(rows[0]!.revenueCollected).toBe(0);
  });
});

describe("aggregateLeaderboard — filtro launch", () => {
  it("filtra leads y sales por launch_id (heredando de lead)", () => {
    const closer = tm("tm-1", "Closer");
    const leads = [
      lead("l-A", { team_member_id: "tm-1", launch_id: "launch-A" }),
      lead("l-B", { team_member_id: "tm-1", launch_id: "launch-B" }),
    ];
    const sales = [
      sale("s-A", { lead_id: "l-A", team_member_id: "tm-1", total_amount: 1000 }),
      sale("s-B", { lead_id: "l-B", team_member_id: "tm-1", total_amount: 2000 }),
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
    expect(rows[0]!.commissionAccrued).toBe(100);
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
    const closer = tm("tm-1", "Closer");
    const leads = [lead("l-1", { team_member_id: "tm-1" })];
    const sales = [
      sale("s-jun", {
        lead_id: "l-1",
        team_member_id: "tm-1",
        total_amount: 1000,
        closed_at: "2026-06-05T00:00:00Z",
      }),
      sale("s-jul", {
        lead_id: "l-1",
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

    expect(rows[0]!.closed).toBe(1);
    expect(rows[0]!.revenueCollected).toBe(2000);
    expect(rows[0]!.commissionAccrued).toBe(200);
  });

  it("sin filtro de fecha → todas las épocas suman", () => {
    const closer = tm("tm-1", "Closer");
    const leads = [lead("l-1", { team_member_id: "tm-1" })];
    const sales = [
      sale("s-2025", {
        lead_id: "l-1",
        team_member_id: "tm-1",
        total_amount: 500,
        closed_at: "2025-01-01T00:00:00Z",
      }),
      sale("s-2026", {
        lead_id: "l-1",
        team_member_id: "tm-1",
        total_amount: 1500,
        closed_at: "2026-06-01T00:00:00Z",
      }),
    ];
    // Una sola venta por lead — ok porque acá no testeamos el UNIQUE, solo
    // el agregador (no toca la DB). En producción la UNIQUE de leads lo
    // impide.
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
      rules: [], // sin reglas
      filters: {},
    });
    expect(rows[0]!.revenueCollected).toBe(1000);
    expect(rows[0]!.commissionAccrued).toBe(0);
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
      payments: [payment("s-1", 1000)], // 1000 cobrado × 10% = 100 comisión
      rules: [RULE_10_PERCENT],
      payouts: [
        payout("tm-1", "launch-A", 30),
        payout("tm-1", "launch-A", 20),
      ],
      filters: {},
    });
    expect(rows[0]!.commissionAccrued).toBe(100);
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
        sale("s-A", { lead_id: "l-A", team_member_id: "tm-1", total_amount: 1000 }),
        sale("s-B", { lead_id: "l-B", team_member_id: "tm-1", total_amount: 1000 }),
      ],
      payments: [payment("s-A", 1000), payment("s-B", 1000)],
      rules: [RULE_10_PERCENT],
      payouts: [
        payout("tm-1", "launch-A", 70), // dentro del filtro
        payout("tm-1", "launch-B", 40), // fuera del filtro
      ],
      filters: { launchId: "launch-A" },
    });
    expect(rows[0]!.commissionAccrued).toBe(100); // solo launch-A
    expect(rows[0]!.paidOut).toBe(70); // solo payout del launch-A
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
      payments: [payment("s-1", 500)], // 500 × 10% = 50 comisión
      rules: [RULE_10_PERCENT],
      payouts: [payout("tm-1", "launch-A", 200)],
      filters: {},
    });
    expect(rows[0]!.commissionAccrued).toBe(50);
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
        payout("tm-1", "launch-A", 50, "2026-07-15"), // dentro
        payout("tm-1", "launch-A", 999, "2026-06-15"), // fuera
      ],
      filters: { dateFrom: "2026-07-01", dateTo: "2026-07-31" },
    });
    expect(rows[0]!.paidOut).toBe(50);
  });
});

describe("aggregateLeaderboard — launch override", () => {
  it("usa la regla override del launch del lead, no la default", () => {
    const closer = tm("tm-1", "Closer");
    const ruleDefault: CommissionRuleRow = {
      ...RULE_10_PERCENT,
      id: "r-default",
      launch_id: null,
      value: 10,
    };
    const ruleOverride: CommissionRuleRow = {
      ...RULE_10_PERCENT,
      id: "r-override",
      launch_id: "launch-X",
      value: 25,
    };
    const rows = aggregateLeaderboard({
      teamMembers: [closer],
      leads: [
        lead("l-1", { team_member_id: "tm-1", launch_id: "launch-X" }),
      ],
      sales: [
        sale("s-1", {
          lead_id: "l-1",
          team_member_id: "tm-1",
          total_amount: 1000,
        }),
      ],
      payments: [payment("s-1", 1000)],
      rules: [ruleDefault, ruleOverride],
      filters: {},
    });
    expect(rows[0]!.commissionAccrued).toBe(250); // 25% del cobrado
  });
});
