import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGhlContactCountsByDay } from "./ghl";

/**
 * El adapter absorbe los 429 de GHL con backoff antes de propagarlos. Sin
 * esto, un solo 429 en cualquier página aborta el sync entero del launch.
 *
 * Fake timers: el backoff duerme segundos reales, así que empujamos el reloj
 * en vez de esperarlo.
 */

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers });
}

/** Avanza el reloj falso hasta que la promesa bajo test se asiente. */
async function settleWithTimers<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = promise.finally(() => {
    settled = true;
  });
  for (let i = 0; i < 100 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
  }
  return tracked;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ghlFetch — reintentos ante 429", () => {
  it("reintenta y termina OK cuando el 429 es transitorio", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(429, { message: "Too Many Requests", statusCode: 429 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(429, { message: "Too Many Requests", statusCode: 429 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [], total: 7 }));

    const result = await settleWithTimers(
      fetchGhlContactCountsByDay({
        token: "pit-transient",
        locationId: "loc-1",
        since: "2026-01-10",
        until: "2026-01-10",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ date: "2026-01-10", total: 7 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("respeta el header Retry-After en vez del backoff exponencial", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          429,
          { message: "Too Many Requests", statusCode: 429 },
          { "retry-after": "3" },
        ),
      )
      .mockResolvedValueOnce(jsonResponse(200, { contacts: [], total: 2 }));

    const promise = fetchGhlContactCountsByDay({
      token: "pit-retry-after",
      locationId: "loc-1",
      since: "2026-01-10",
      until: "2026-01-10",
    });

    // A los 2s todavía está esperando los 3s que pidió GHL.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const result = await settleWithTimers(promise);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propaga rate_limited recién cuando se agotan los reintentos", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { message: "Too Many Requests", statusCode: 429 }),
    );

    const result = await settleWithTimers(
      fetchGhlContactCountsByDay({
        token: "pit-exhausted",
        locationId: "loc-1",
        since: "2026-01-10",
        until: "2026-01-10",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("rate_limited");
    expect(result.detail.retries_exhausted).toBe(true);
    expect(result.detail.attempts).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("no reintenta errores que no son 429", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { message: "Invalid token" }),
    );

    const result = await settleWithTimers(
      fetchGhlContactCountsByDay({
        token: "pit-invalid",
        locationId: "loc-1",
        since: "2026-01-10",
        until: "2026-01-10",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("token_invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ghlFetch — throttle por location", () => {
  it("no supera el techo de requests por ventana de 10s", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { contacts: [], total: 1 }));

    // 90 días = 90 requests. El techo es 70 por ventana de 10s, así que la
    // request 71 no puede salir dentro de los primeros 10s.
    const promise = fetchGhlContactCountsByDay({
      token: "pit-throttle",
      locationId: "loc-1",
      since: "2026-01-01",
      until: "2026-03-31",
    });

    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(70);

    const result = await settleWithTimers(promise);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(90);
  });
});
