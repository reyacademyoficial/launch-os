import { describe, it, expect } from "vitest";

import { mergeDailyData, type AdsDailyRow } from "./merge";
import type { LaunchDailyRow } from "./types";

function manualRow(date: string, overrides: Partial<LaunchDailyRow> = {}): LaunchDailyRow {
  return {
    id: "manual-" + date,
    launch_id: "launch-1",
    date,
    meta_ads: 0,
    google_ads: 0,
    tiktok_ads: 0,
    organico: 0,
    whatsapp: 0,
    referidos: 0,
    otro: 0,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function adsRow(overrides: Partial<AdsDailyRow> & Pick<AdsDailyRow, "date" | "provider">): AdsDailyRow {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    ...overrides,
  };
}

describe("mergeDailyData — regla API gana sobre manual", () => {
  it("si hay manual + API para meta_ads en el mismo día, manda API", () => {
    const manual = [manualRow("2026-07-10", { meta_ads: 50, organico: 12 })];
    const ads = [adsRow({ date: "2026-07-10", provider: "meta", leads: 60, spend: 150 })];

    const merged = mergeDailyData(manual, ads);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.meta_ads).toBe(60); // API gana
    expect(merged[0]!.organico).toBe(12); // Manual para canal no-pago
    expect(merged[0]!.meta_spend).toBe(150);
  });

  it("si solo hay manual para un día, sale el manual completo", () => {
    const manual = [
      manualRow("2026-07-10", { meta_ads: 30, google_ads: 20, organico: 15 }),
    ];

    const merged = mergeDailyData(manual, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.meta_ads).toBe(30);
    expect(merged[0]!.google_ads).toBe(20);
    expect(merged[0]!.organico).toBe(15);
    expect(merged[0]!.meta_spend).toBe(0); // sin API → 0
  });

  it("si solo hay API para un día, sale la API + organico/etc en 0", () => {
    const ads = [
      adsRow({ date: "2026-07-10", provider: "meta", leads: 25, spend: 100 }),
    ];

    const merged = mergeDailyData([], ads);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.meta_ads).toBe(25);
    expect(merged[0]!.organico).toBe(0);
  });
});

describe("mergeDailyData — canales no-pagos siempre manual", () => {
  it("API en meta_ads no toca organico/whatsapp/referidos/otro", () => {
    const manual = [
      manualRow("2026-07-10", {
        meta_ads: 99, // se va a pisar
        organico: 5,
        whatsapp: 3,
        referidos: 2,
        otro: 1,
      }),
    ];
    const ads = [adsRow({ date: "2026-07-10", provider: "meta", leads: 60 })];

    const merged = mergeDailyData(manual, ads);
    expect(merged[0]!.meta_ads).toBe(60);
    expect(merged[0]!.organico).toBe(5);
    expect(merged[0]!.whatsapp).toBe(3);
    expect(merged[0]!.referidos).toBe(2);
    expect(merged[0]!.otro).toBe(1);
  });
});

describe("mergeDailyData — providers parciales", () => {
  it("si la API solo trae meta, los otros canales pagos quedan en manual", () => {
    const manual = [
      manualRow("2026-07-10", { meta_ads: 50, google_ads: 30, tiktok_ads: 20 }),
    ];
    const ads = [adsRow({ date: "2026-07-10", provider: "meta", leads: 70 })];

    const merged = mergeDailyData(manual, ads);
    expect(merged[0]!.meta_ads).toBe(70); // API
    expect(merged[0]!.google_ads).toBe(30); // manual
    expect(merged[0]!.tiktok_ads).toBe(20); // manual
  });
});

describe("mergeDailyData — orden y multidía", () => {
  it("devuelve días ordenados ascendente por fecha", () => {
    const manual = [
      manualRow("2026-07-12", { meta_ads: 5 }),
      manualRow("2026-07-10", { meta_ads: 3 }),
      manualRow("2026-07-11", { meta_ads: 4 }),
    ];

    const merged = mergeDailyData(manual, []);
    expect(merged.map((r) => r.date)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
  });

  it("días que existen solo en API o solo en manual aparecen ambos", () => {
    const manual = [manualRow("2026-07-10", { organico: 10 })];
    const ads = [adsRow({ date: "2026-07-11", provider: "meta", leads: 20 })];

    const merged = mergeDailyData(manual, ads);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.date).toBe("2026-07-10");
    expect(merged[0]!.organico).toBe(10);
    expect(merged[1]!.date).toBe("2026-07-11");
    expect(merged[1]!.meta_ads).toBe(20);
  });
});

describe("mergeDailyData — providers desconocidos", () => {
  it("ignora rows de ads con provider no mapeado", () => {
    // Casteamos a AdsDailyRow porque queremos validar el comportamiento
    // defensivo: aunque el adapter solo emite providers válidos, la DB
    // podría tener filas con un provider obsoleto y no querés que rompa.
    const ads: AdsDailyRow[] = [
      adsRow({ date: "2026-07-10", provider: "tiktok", leads: 8 }),
      {
        date: "2026-07-10",
        provider: "unknown_provider",
        spend: 0,
        impressions: 0,
        clicks: 0,
        leads: 99,
      },
    ];

    const merged = mergeDailyData([], ads);
    expect(merged[0]!.tiktok_ads).toBe(8);
    // No hay key para "unknown_provider", se descarta silencioso.
  });
});
