import { describe, expect, it } from "vitest";

import { classifyRunway } from "./runway";

describe("classifyRunway — política de UI del runway", () => {
  it("stale-snapshot tiene precedencia sobre burn — no publicar runway sobre caja vieja", () => {
    const r = classifyRunway({
      cashOnHand: 500_000,
      monthlyBurn: 100_000,
      snapshotStale: true,
    });
    expect(r.months).toBeNull();
    expect(r.reason).toBe("stale-snapshot");
  });

  it("stale-snapshot gana incluso si burn = 0 (no mostrar '∞' sobre caja vieja)", () => {
    const r = classifyRunway({
      cashOnHand: 500_000,
      monthlyBurn: 0,
      snapshotStale: true,
    });
    expect(r.reason).toBe("stale-snapshot");
  });

  it("burn = 0 sin snapshot stale → 'no-burn-data' (NUNCA ∞)", () => {
    const r = classifyRunway({
      cashOnHand: 500_000,
      monthlyBurn: 0,
      snapshotStale: false,
    });
    expect(r.months).toBeNull();
    expect(r.reason).toBe("no-burn-data");
  });

  it("burn negativo (edge case defensivo) → 'no-burn-data'", () => {
    const r = classifyRunway({
      cashOnHand: 500_000,
      monthlyBurn: -1,
      snapshotStale: false,
    });
    expect(r.reason).toBe("no-burn-data");
  });

  it("caso ok con caja y burn positivos: mesas = caja / burn", () => {
    const r = classifyRunway({
      cashOnHand: 1_200_000,
      monthlyBurn: 100_000,
      snapshotStale: false,
    });
    expect(r.reason).toBe("ok");
    expect(r.months).toBe(12);
  });

  it("caja agotada con burn real → months = 0, reason = 'ok'", () => {
    // El selector devolvería 0 (no null) — es un "runway válido de valor 0".
    const r = classifyRunway({
      cashOnHand: 0,
      monthlyBurn: 100_000,
      snapshotStale: false,
    });
    expect(r.reason).toBe("ok");
    expect(r.months).toBe(0);
  });

  it("caja negativa (deuda de caja) con burn real → months = 0, reason = 'ok'", () => {
    const r = classifyRunway({
      cashOnHand: -50_000,
      monthlyBurn: 100_000,
      snapshotStale: false,
    });
    expect(r.reason).toBe("ok");
    expect(r.months).toBe(0);
  });
});
