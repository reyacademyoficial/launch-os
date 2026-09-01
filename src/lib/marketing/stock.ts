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
 * Ciclo de vida de un asset frente al stock (`AssetStockState`):
 *   - `en_cola`    → sin `edited_at`. Alguien todavía lo está editando; no es
 *                    stock y no se puede planificar su subida.
 *   - `disponible` → editado y sin subidas asociadas. Stock puro.
 *   - `reservado`  → editado y con al menos una subida en 'planificada'. El
 *                    líder ya lo eligió para una fecha, así que sale del
 *                    stock para que nadie lo agende en paralelo.
 *   - `utilizado`  → con al menos una subida en 'subida'. El CM confirmó la
 *                    publicación; consumido definitivamente.
 *
 * `utilizado` gana sobre `reservado`, y `reservado` sobre `disponible`.
 *
 * Reglas de conteo:
 *   - Un asset sin `edited_at` NO cuenta como stock (todavía está en cola).
 *   - Un asset editado cuenta para una plataforma salvo que ya esté
 *     reservado o utilizado ahí. Si la cadencia tiene
 *     `allow_repeat_asset=true` el asset se recicla y cuenta siempre.
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
  /** 'planificada' reserva el asset, 'subida' lo consume. El resto no afecta. */
  readonly status: string;
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
  // Precomputar: por asset, platforms donde ya está comprometido — sea
  // reservado ('planificada') o consumido ('subida'). Ambos casos sacan el
  // asset del stock de esa plataforma: una vez que el líder lo agendó, ya
  // no está disponible para que otro lo agende de nuevo.
  const usedByAsset = committedPlatformsByAsset(uploads);

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
// computeAssetStockStates
//
// Estado individual de cada asset frente al stock. Lo consume la tabla
// "Contenido disponible" de /marketing/stock y el picker de /marketing/subidas
// (que sólo ofrece los `disponible`).
//
// Precedencia: utilizado > reservado > disponible > en_cola. Un asset con una
// subida 'subida' en IG y otra 'planificada' en TikTok es `utilizado` — ya
// salió al mundo, que es la información que manda para el operador.
//
// `fallida` y `cancelada` NO comprometen el asset: vuelve a estar disponible
// para reagendar, que es exactamente lo que se quiere después de un fallo.
// ═══════════════════════════════════════════════════════════════════════════

export type AssetStockState =
  | "en_cola"
  | "disponible"
  | "reservado"
  | "utilizado";

export function computeAssetStockStates(
  assets: readonly StockAssetInput[],
  uploads: readonly StockUploadInput[],
): Map<string, AssetStockState> {
  const uploadedAssets = new Set<string>();
  const reservedAssets = new Set<string>();
  for (const u of uploads) {
    if (u.status === "subida") uploadedAssets.add(u.contentAssetId);
    else if (u.status === "planificada") reservedAssets.add(u.contentAssetId);
  }

  const out = new Map<string, AssetStockState>();
  for (const a of assets) {
    if (uploadedAssets.has(a.id)) out.set(a.id, "utilizado");
    else if (a.editedAt == null) out.set(a.id, "en_cola");
    else if (reservedAssets.has(a.id)) out.set(a.id, "reservado");
    else out.set(a.id, "disponible");
  }
  return out;
}

/**
 * Por asset, las plataformas donde ya está comprometido (reservado o
 * subido). Compartido por `computeStockByOwnerPlatformFormat` y por el
 * picker de subidas, que necesita el mismo criterio para no ofrecer dos
 * veces el mismo corte en la misma plataforma.
 */
export function committedPlatformsByAsset(
  uploads: readonly StockUploadInput[],
): Map<string, Set<MarketingPlatform>> {
  const out = new Map<string, Set<MarketingPlatform>>();
  for (const u of uploads) {
    if (u.status !== "subida" && u.status !== "planificada") continue;
    const set = out.get(u.contentAssetId) ?? new Set<MarketingPlatform>();
    set.add(u.platform);
    out.set(u.contentAssetId, set);
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
