import { describe, expect, it } from "vitest";

import {
  computeChurnRate,
  isAtRisk,
  isChurned,
  type ChurnCohortEntry,
} from "./churn";
import type { ProjectHealthRow, RenewalRow } from "./types";

function health(
  overrides: Partial<ProjectHealthRow> = {},
): Pick<ProjectHealthRow, "client_id" | "relationship_status"> {
  return {
    client_id: "cli-a",
    relationship_status: "activa",
    ...overrides,
  };
}

function renewal(overrides: Partial<RenewalRow> = {}): RenewalRow {
  return {
    client_id: "cli-a",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    amount: 1000,
    status: "cobrada",
    collected_at: "2026-02-01",
    ...overrides,
  };
}

describe("isChurned", () => {
  it("relationship_status='perdida' → churned aunque no haya renewals", () => {
    expect(
      isChurned({
        health: health({ relationship_status: "perdida" }),
        renewals: [],
      }),
    ).toBe(true);
  });

  it("renewal más reciente perdida → churned aunque health esté activa", () => {
    expect(
      isChurned({
        health: health({ relationship_status: "activa" }),
        renewals: [
          renewal({ period_end: "2026-01-31", status: "cobrada" }),
          renewal({ period_end: "2026-06-30", status: "perdida" }), // más nueva
        ],
      }),
    ).toBe(true);
  });

  it("la renewal antigua perdida NO churnea si la nueva está cobrada", () => {
    expect(
      isChurned({
        health: health({ relationship_status: "activa" }),
        renewals: [
          renewal({ period_end: "2026-01-31", status: "perdida" }), // vieja
          renewal({ period_end: "2026-06-30", status: "cobrada" }), // nueva
        ],
      }),
    ).toBe(false);
  });

  it("sin health y sin renewals → no churn (no hay evidencia)", () => {
    expect(isChurned({ health: null, renewals: [] })).toBe(false);
  });

  it("activa + renewal cobrada → sano", () => {
    expect(
      isChurned({
        health: health({ relationship_status: "activa" }),
        renewals: [renewal({ status: "cobrada" })],
      }),
    ).toBe(false);
  });
});

describe("isAtRisk", () => {
  it("true solo para en_riesgo", () => {
    expect(isAtRisk({ relationship_status: "en_riesgo" })).toBe(true);
    expect(isAtRisk({ relationship_status: "activa" })).toBe(false);
    expect(isAtRisk({ relationship_status: "onboarding" })).toBe(false);
    expect(isAtRisk({ relationship_status: "perdida" })).toBe(false);
    expect(isAtRisk(null)).toBe(false);
  });
});

describe("computeChurnRate", () => {
  it("cohort vacío → todo null (no dividir por cero)", () => {
    const r = computeChurnRate([]);
    expect(r.totalClients).toBe(0);
    expect(r.churnRate).toBeNull();
    expect(r.atRiskRate).toBeNull();
  });

  it("cohort de 4: 1 perdida + 1 en_riesgo + 2 activas", () => {
    const cohort: ChurnCohortEntry[] = [
      {
        clientId: "c1",
        input: {
          health: health({ relationship_status: "perdida" }),
          renewals: [],
        },
      },
      {
        clientId: "c2",
        input: {
          health: health({ relationship_status: "en_riesgo" }),
          renewals: [],
        },
      },
      {
        clientId: "c3",
        input: {
          health: health({ relationship_status: "activa" }),
          renewals: [renewal({ status: "cobrada" })],
        },
      },
      {
        clientId: "c4",
        input: {
          health: health({ relationship_status: "activa" }),
          renewals: [],
        },
      },
    ];
    const r = computeChurnRate(cohort);
    expect(r.totalClients).toBe(4);
    expect(r.churnedClients).toBe(1);
    expect(r.atRiskClients).toBe(1);
    expect(r.churnRate).toBe(0.25);
    expect(r.atRiskRate).toBe(0.25);
  });

  it("un cliente churneado por renewal cuenta aunque health esté activa", () => {
    const r = computeChurnRate([
      {
        clientId: "c1",
        input: {
          health: health({ relationship_status: "activa" }),
          renewals: [renewal({ status: "perdida" })],
        },
      },
    ]);
    expect(r.churnedClients).toBe(1);
    expect(r.churnRate).toBe(1);
  });

  it("perdida + en_riesgo NO se doble-cuentan: churned excluye at_risk", () => {
    const r = computeChurnRate([
      {
        clientId: "c1",
        input: {
          // perdida (el operador ya lo marcó perdida)
          health: health({ relationship_status: "perdida" }),
          renewals: [],
        },
      },
    ]);
    expect(r.churnedClients).toBe(1);
    expect(r.atRiskClients).toBe(0); // NO se cuenta también acá
  });
});
