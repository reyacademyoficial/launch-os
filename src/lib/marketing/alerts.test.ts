import { describe, expect, it } from "vitest";

import {
  actionableAlerts,
  computeCoverageAlerts,
  DEFAULT_ALERT_THRESHOLDS,
  severityFor,
  toneForSeverity,
  type CoverageInput,
} from "./alerts";

describe("severityFor con umbrales default (3, 7)", () => {
  it("0-2 días → critical", () => {
    expect(severityFor(0)).toBe("critical");
    expect(severityFor(2)).toBe("critical");
  });
  it("3-6 días → warning", () => {
    expect(severityFor(3)).toBe("warning");
    expect(severityFor(6)).toBe("warning");
  });
  it("7+ días → ok", () => {
    expect(severityFor(7)).toBe("ok");
    expect(severityFor(30)).toBe("ok");
  });
  it("respeta umbrales custom", () => {
    expect(severityFor(5, { criticalUnderDays: 5, warningUnderDays: 10 })).toBe("warning");
    expect(severityFor(4, { criticalUnderDays: 5, warningUnderDays: 10 })).toBe("critical");
  });
});

describe("computeCoverageAlerts", () => {
  const rows: CoverageInput[] = [
    { contentOwnerId: "o1", platform: "instagram", daysOfCoverage: 10, stockCount: 20, dailyRate: 2 },
    { contentOwnerId: "o1", platform: "youtube", daysOfCoverage: 1, stockCount: 1, dailyRate: 1 },
    { contentOwnerId: "o2", platform: "tiktok", daysOfCoverage: 5, stockCount: 5, dailyRate: 1 },
  ];

  it("asigna severity a cada fila y ordena críticas primero", () => {
    const alerts = computeCoverageAlerts(rows);
    expect(alerts[0]).toMatchObject({
      contentOwnerId: "o1",
      platform: "youtube",
      severity: "critical",
    });
    expect(alerts[1]).toMatchObject({
      contentOwnerId: "o2",
      platform: "tiktok",
      severity: "warning",
    });
    expect(alerts[2]).toMatchObject({
      contentOwnerId: "o1",
      platform: "instagram",
      severity: "ok",
    });
  });

  it("preserva stockCount y dailyRate de la entrada", () => {
    const alerts = computeCoverageAlerts(rows);
    const yt = alerts.find((a) => a.platform === "youtube");
    expect(yt?.stockCount).toBe(1);
    expect(yt?.dailyRate).toBe(1);
  });

  it("dos warnings con días distintos → el menor primero", () => {
    const alerts = computeCoverageAlerts([
      { contentOwnerId: "o1", platform: "instagram", daysOfCoverage: 6, stockCount: 6, dailyRate: 1 },
      { contentOwnerId: "o1", platform: "facebook", daysOfCoverage: 3, stockCount: 3, dailyRate: 1 },
    ]);
    expect(alerts[0]?.platform).toBe("facebook");
    expect(alerts[1]?.platform).toBe("instagram");
  });
});

describe("actionableAlerts", () => {
  it("filtra las que están en 'ok'", () => {
    const alerts = computeCoverageAlerts([
      { contentOwnerId: "o1", platform: "instagram", daysOfCoverage: 10, stockCount: 20, dailyRate: 2 },
      { contentOwnerId: "o1", platform: "youtube", daysOfCoverage: 1, stockCount: 1, dailyRate: 1 },
    ]);
    const filtered = actionableAlerts(alerts);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.platform).toBe("youtube");
  });
});

describe("toneForSeverity", () => {
  it("critical → negative, warning → warning, ok → positive", () => {
    expect(toneForSeverity("critical")).toBe("var(--kg-negative-500)");
    expect(toneForSeverity("warning")).toBe("var(--kg-warning-500)");
    expect(toneForSeverity("ok")).toBe("var(--kg-positive-500)");
  });
});

describe("DEFAULT_ALERT_THRESHOLDS", () => {
  it("mantiene los valores esperados del plan (3, 7)", () => {
    expect(DEFAULT_ALERT_THRESHOLDS).toEqual({
      criticalUnderDays: 3,
      warningUnderDays: 7,
    });
  });
});
