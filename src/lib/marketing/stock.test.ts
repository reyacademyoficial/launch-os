import { describe, expect, it } from "vitest";

import {
  computeDaysOfCoverage,
  computeStockByOwnerPlatformFormat,
  minDaysOfCoverage,
  totalStock,
  type StockAssetInput,
  type StockCadenceInput,
  type StockUploadInput,
} from "./stock";

describe("computeStockByOwnerPlatformFormat", () => {
  it("assets sin edited_at no cuentan como stock", () => {
    const assets: StockAssetInput[] = [
      { id: "a1", contentOwnerId: "o1", format: "reel", editedAt: null },
      { id: "a2", contentOwnerId: "o1", format: "reel", editedAt: "2026-08-01" },
    ];
    const cadences: StockCadenceInput[] = [
      {
        contentOwnerId: "o1",
        platform: "instagram",
        format: "reel",
        postsPerDay: 1,
        allowRepeatAsset: false,
      },
    ];
    const buckets = computeStockByOwnerPlatformFormat(assets, [], cadences);
    expect(buckets).toEqual([
      { contentOwnerId: "o1", platform: "instagram", format: "reel", stockCount: 1 },
    ]);
  });

  it("devuelve un bucket por cada cadencia aunque el stock sea 0", () => {
    const cadences: StockCadenceInput[] = [
      { contentOwnerId: "o1", platform: "instagram", format: "reel", postsPerDay: 3, allowRepeatAsset: false },
      { contentOwnerId: "o1", platform: "youtube", format: "short", postsPerDay: 1, allowRepeatAsset: false },
    ];
    const buckets = computeStockByOwnerPlatformFormat([], [], cadences);
    expect(buckets).toHaveLength(2);
    expect(buckets.every((b) => b.stockCount === 0)).toBe(true);
  });

  it("allow_repeat_asset=false: assets ya subidos a esa platform no cuentan más", () => {
    const assets: StockAssetInput[] = [
      { id: "a1", contentOwnerId: "o1", format: "reel", editedAt: "2026-08-01" },
      { id: "a2", contentOwnerId: "o1", format: "reel", editedAt: "2026-08-01" },
    ];
    const uploads: StockUploadInput[] = [
      { contentAssetId: "a1", platform: "instagram", status: "subida" },
    ];
    const cadences: StockCadenceInput[] = [
      { contentOwnerId: "o1", platform: "instagram", format: "reel", postsPerDay: 1, allowRepeatAsset: false },
    ];
    const buckets = computeStockByOwnerPlatformFormat(assets, uploads, cadences);
    expect(buckets[0]?.stockCount).toBe(1); // a2 sigue disponible
  });

  it("allow_repeat_asset=true: assets ya subidos siguen contando", () => {
    const assets: StockAssetInput[] = [
      { id: "a1", contentOwnerId: "o1", format: "reel", editedAt: "2026-08-01" },
    ];
    const uploads: StockUploadInput[] = [
      { contentAssetId: "a1", platform: "instagram", status: "subida" },
    ];
    const cadences: StockCadenceInput[] = [
      { contentOwnerId: "o1", platform: "instagram", format: "reel", postsPerDay: 1, allowRepeatAsset: true },
    ];
    const buckets = computeStockByOwnerPlatformFormat(assets, uploads, cadences);
    expect(buckets[0]?.stockCount).toBe(1);
  });

  it("uploads en status distinto de 'subida' no consumen stock", () => {
    const assets: StockAssetInput[] = [
      { id: "a1", contentOwnerId: "o1", format: "reel", editedAt: "2026-08-01" },
    ];
    const uploads: StockUploadInput[] = [
      { contentAssetId: "a1", platform: "instagram", status: "planificada" },
      { contentAssetId: "a1", platform: "instagram", status: "fallida" },
      { contentAssetId: "a1", platform: "instagram", status: "cancelada" },
    ];
    const cadences: StockCadenceInput[] = [
      { contentOwnerId: "o1", platform: "instagram", format: "reel", postsPerDay: 1, allowRepeatAsset: false },
    ];
    const buckets = computeStockByOwnerPlatformFormat(assets, uploads, cadences);
    expect(buckets[0]?.stockCount).toBe(1);
  });

  it("un mismo asset cuenta para múltiples plataformas cuando hay cadencias distintas", () => {
    const assets: StockAssetInput[] = [
      { id: "a1", contentOwnerId: "o1", format: "reel", editedAt: "2026-08-01" },
    ];
    const cadences: StockCadenceInput[] = [
      { contentOwnerId: "o1", platform: "instagram", format: "reel", postsPerDay: 1, allowRepeatAsset: false },
      { contentOwnerId: "o1", platform: "facebook", format: "reel", postsPerDay: 1, allowRepeatAsset: false },
    ];
    const buckets = computeStockByOwnerPlatformFormat(assets, [], cadences);
    expect(buckets).toHaveLength(2);
    expect(buckets.every((b) => b.stockCount === 1)).toBe(true);
  });

  it("un asset consumido en IG sigue disponible en FB (repeat entre plataformas)", () => {
    const assets: StockAssetInput[] = [
      { id: "a1", contentOwnerId: "o1", format: "reel", editedAt: "2026-08-01" },
    ];
    const uploads: StockUploadInput[] = [
      { contentAssetId: "a1", platform: "instagram", status: "subida" },
    ];
    const cadences: StockCadenceInput[] = [
      { contentOwnerId: "o1", platform: "instagram", format: "reel", postsPerDay: 1, allowRepeatAsset: false },
      { contentOwnerId: "o1", platform: "facebook", format: "reel", postsPerDay: 1, allowRepeatAsset: false },
    ];
    const buckets = computeStockByOwnerPlatformFormat(assets, uploads, cadences);
    const ig = buckets.find((b) => b.platform === "instagram");
    const fb = buckets.find((b) => b.platform === "facebook");
    expect(ig?.stockCount).toBe(0);
    expect(fb?.stockCount).toBe(1);
  });
});

describe("computeDaysOfCoverage", () => {
  it("suma stock y dailyRate a través de formats para el mismo (owner, platform)", () => {
    const stock = [
      { contentOwnerId: "o1", platform: "instagram" as const, format: "reel" as const, stockCount: 10 },
      { contentOwnerId: "o1", platform: "instagram" as const, format: "carousel" as const, stockCount: 6 },
    ];
    const cadences: StockCadenceInput[] = [
      { contentOwnerId: "o1", platform: "instagram", format: "reel", postsPerDay: 2, allowRepeatAsset: false },
      { contentOwnerId: "o1", platform: "instagram", format: "carousel", postsPerDay: 1, allowRepeatAsset: false },
    ];
    const cov = computeDaysOfCoverage(stock, cadences);
    expect(cov).toHaveLength(1);
    expect(cov[0]).toEqual({
      contentOwnerId: "o1",
      platform: "instagram",
      stockCount: 16,
      dailyRate: 3,
      daysOfCoverage: 5, // 16/3 = 5.33 → floor = 5
    });
  });

  it("stock cero devuelve 0 días", () => {
    const cadences: StockCadenceInput[] = [
      { contentOwnerId: "o1", platform: "instagram", format: "reel", postsPerDay: 3, allowRepeatAsset: false },
    ];
    const cov = computeDaysOfCoverage([], cadences);
    expect(cov[0]?.daysOfCoverage).toBe(0);
    expect(cov[0]?.stockCount).toBe(0);
  });

  it("pares sin cadencia no aparecen en la cobertura", () => {
    const stock = [
      { contentOwnerId: "o1", platform: "tiktok" as const, format: "reel" as const, stockCount: 5 },
    ];
    const cov = computeDaysOfCoverage(stock, []);
    expect(cov).toHaveLength(0);
  });
});

describe("totalStock", () => {
  it("suma stockCount de todos los buckets", () => {
    expect(
      totalStock([
        { contentOwnerId: "o1", platform: "instagram", format: "reel", stockCount: 5 },
        { contentOwnerId: "o1", platform: "facebook", format: "reel", stockCount: 3 },
        { contentOwnerId: "o2", platform: "instagram", format: "reel", stockCount: 7 },
      ]),
    ).toBe(15);
  });
});

describe("minDaysOfCoverage", () => {
  it("devuelve el mínimo entre pares", () => {
    expect(
      minDaysOfCoverage([
        { contentOwnerId: "o1", platform: "instagram", stockCount: 10, dailyRate: 2, daysOfCoverage: 5 },
        { contentOwnerId: "o1", platform: "youtube", stockCount: 2, dailyRate: 1, daysOfCoverage: 2 },
      ]),
    ).toBe(2);
  });
  it("devuelve null si no hay pares", () => {
    expect(minDaysOfCoverage([])).toBe(null);
  });
});
