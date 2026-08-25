/**
 * Selectores puros de stock de contenido.
 *
 * "Stock" = assets EDITADOS que todavía no se subieron (o que se pueden
 * subir de nuevo si la cadencia lo permite). La granularidad es
 * (owner × platform × format), porque el plan editorial pautó cadencias
 * a ese nivel — un IG-reel se cuenta distinto de un IG-carousel.
 *
 * "Días de cobertura" = stock ÷ cadencia diaria de esa (owner, platform).
 * Ejemplo: 12 reels y 3 por día → 4 días. Si no hay cadencia configurada
 * para ese par, devolvemos `null` (no podemos calcular).
 *
 * Reglas:
 *   - Un asset sin `edited_at` NO cuenta como stock (todavía está en cola).
 *   - Un asset con `edited_at` cuenta siempre; si `allow_repeat_asset=false`
 *     y ya fue subido en esa plataforma (status='subida'), NO cuenta más
 *     para esa plataforma.
 *   - Un asset editado sirve para TODAS las plataformas donde el owner tiene
 *     cadencia y donde el formato encaje con esa cadencia. Ej: un `reel`
 *     de Rey Academy cuenta para IG-reel y también para FB-reel si hay
 *     cadencias configuradas para ambos.
 *
 * Todo puro, sin efectos, tests colocados junto al archivo.
 */

import type { MarketingFormat, MarketingPlatform } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Shapes de entrada — copias mínimas de las filas de DB.
// ═══════════════════════════════════════════════════════════════════════════

export interface StockAssetInput {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly format: MarketingFormat;
  readonly editedAt: string | null; // null = no cuenta como stock
}

export interface StockUploadInput {
  readonly contentAssetId: string;
  readonly platform: MarketingPlatform;
  readonly status: string; // 'subida' cuenta como consumo
}

export interface StockCadenceInput {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly format: MarketingFormat;
  readonly postsPerDay: number;
  readonly allowRepeatAsset: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Shapes de salida.
// ═══════════════════════════════════════════════════════════════════════════

export interface StockBucket {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly format: MarketingFormat;
  readonly stockCount: number;
}

export interface CoverageBucket {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly stockCount: number;
  readonly dailyRate: number;
  readonly daysOfCoverage: number; // stock / dailyRate (redondeado hacia abajo)
}

// ═══════════════════════════════════════════════════════════════════════════
// computeStockByOwnerPlatformFormat
//
// Recorre las cadencias configuradas y calcula, para cada (owner, platform,
// format), cuántos assets editados están disponibles.
//
// Devuelve TODAS las combinaciones que tengan cadencia (aunque den 0) —
// permite mostrar "0 assets" en el UI para que el operador sepa que la
// slot está vacía en vez de no ver la fila.
// ═══════════════════════════════════════════════════════════════════════════

export function computeStockByOwnerPlatformFormat(
  assets: readonly StockAssetInput[],
  uploads: readonly StockUploadInput[],
  cadences: readonly StockCadenceInput[],
): StockBucket[] {
  // Precomputar: por asset, platforms donde ya se subió (status='subida').
  const usedByAsset = new Map<string, Set<MarketingPlatform>>();
  for (const u of uploads) {
    if (u.status !== "subida") continue;
    const set = usedByAsset.get(u.contentAssetId) ?? new Set<MarketingPlatform>();
    set.add(u.platform);
    usedByAsset.set(u.contentAssetId, set);
  }

  // Assets editados agrupados por (owner, format).
  const assetsByOwnerFormat = new Map<string, StockAssetInput[]>();
  for (const a of assets) {
    if (a.editedAt == null) continue;
    const key = `${a.contentOwnerId}::${a.format}`;
    const arr = assetsByOwnerFormat.get(key) ?? [];
    arr.push(a);
    assetsByOwnerFormat.set(key, arr);
  }

  const buckets: StockBucket[] = [];
  for (const cad of cadences) {
    const candidates =
      assetsByOwnerFormat.get(`${cad.contentOwnerId}::${cad.format}`) ?? [];
    let count = 0;
    for (const a of candidates) {
      if (cad.allowRepeatAsset) {
        count += 1;
        continue;
      }
      const used = usedByAsset.get(a.id);
      if (used && used.has(cad.platform)) continue;
      count += 1;
    }
    buckets.push({
      contentOwnerId: cad.contentOwnerId,
      platform: cad.platform,
      format: cad.format,
      stockCount: count,
    });
  }

  return buckets;
}

// ═══════════════════════════════════════════════════════════════════════════
// computeDaysOfCoverage
//
// Colapsa por (owner, platform): suma stock a través de formats y suma
// posts_per_day de las cadencias de esa (owner, platform). Divide.
//
// Ejemplo: para (Rey Academy, IG) hay cadencia reel=2/día y carousel=1/día
// (dailyRate=3), con stock reel=10 y carousel=6 (stockCount=16) → 16/3 = 5 días.
//
// Si `dailyRate === 0` (imposible por CHECK en 0158) devolvemos Infinity
// para no dividir por cero.
// ═══════════════════════════════════════════════════════════════════════════

export function computeDaysOfCoverage(
  stock: readonly StockBucket[],
  cadences: readonly StockCadenceInput[],
): CoverageBucket[] {
  const stockByPair = new Map<string, number>();
  for (const s of stock) {
    const key = `${s.contentOwnerId}::${s.platform}`;
    stockByPair.set(key, (stockByPair.get(key) ?? 0) + s.stockCount);
  }

  const rateByPair = new Map<string, number>();
  for (const c of cadences) {
    const key = `${c.contentOwnerId}::${c.platform}`;
    rateByPair.set(key, (rateByPair.get(key) ?? 0) + c.postsPerDay);
  }

  const out: CoverageBucket[] = [];
  for (const [key, dailyRate] of rateByPair) {
    const [contentOwnerId, platform] = key.split("::") as [
      string,
      MarketingPlatform,
    ];
    const stockCount = stockByPair.get(key) ?? 0;
    const daysOfCoverage =
      dailyRate > 0 ? Math.floor(stockCount / dailyRate) : Infinity;
    out.push({
      contentOwnerId,
      platform,
      stockCount,
      dailyRate,
      daysOfCoverage,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers utilitarios para la UI.
// ═══════════════════════════════════════════════════════════════════════════

/** Suma total de stock disponible (todos los buckets). */
export function totalStock(stock: readonly StockBucket[]): number {
  let n = 0;
  for (const s of stock) n += s.stockCount;
  return n;
}

/**
 * Días de cobertura mínimos entre todos los pares — indica el par (owner,
 * platform) más frágil. Devuelve `null` si no hay coverage calculada.
 */
export function minDaysOfCoverage(
  coverage: readonly CoverageBucket[],
): number | null {
  if (coverage.length === 0) return null;
  let min = Infinity;
  for (const c of coverage) {
    if (c.daysOfCoverage < min) min = c.daysOfCoverage;
  }
  return Number.isFinite(min) ? min : null;
}
