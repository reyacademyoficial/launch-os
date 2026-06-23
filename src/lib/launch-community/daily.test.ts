import { describe, expect, it } from "vitest";

import { EMPTY_SENDFLOW_DAILY, parseSendflowDailyRow } from "./daily";

describe("parseSendflowDailyRow", () => {
  it("raw vacío o ventana faltante → EMPTY_SENDFLOW_DAILY (preservando synced_at)", () => {
    expect(
      parseSendflowDailyRow({
        raw: null,
        window_start: "2026-05-11",
        window_end: "2026-06-15",
        synced_at: "2026-06-22T10:00:00Z",
      }),
    ).toEqual({ ...EMPTY_SENDFLOW_DAILY, syncedAt: "2026-06-22T10:00:00Z" });

    expect(
      parseSendflowDailyRow({
        raw: { releases: [] },
        window_start: null,
        window_end: "2026-06-15",
        synced_at: "2026-06-22T10:00:00Z",
      }),
    ).toEqual({ ...EMPTY_SENDFLOW_DAILY, syncedAt: "2026-06-22T10:00:00Z" });
  });

  it("data real (snapshot 2026-06-22): suma entre 2 releases y respeta ventana", () => {
    // Raw real pegado por el usuario el 2026-06-22, launch 35bef88c…, ventana
    // 2026-05-11 → 2026-06-15. Release 2 trae días fuera de la ventana
    // (11062026, 12062026, 17062026) que el reader debe filtrar.
    const raw = {
      releases: [
        {
          release_id: "cPAtOPYmUwiWn0LoolyY",
          add_date_keys: {
            "11052026": 1,
            "12052026": 48,
            "13052026": 226,
            "01062026": 122,
            "02062026": 37,
          },
        },
        {
          release_id: "3dCIQ6UpkKZ6NSglcDHN",
          add_date_keys: {
            "01062026": 44,
            "02062026": 9,
            "11062026": 1, // dentro de ventana
            "12062026": 1, // dentro de ventana
            "17062026": 1, // FUERA — debe filtrarse
          },
        },
      ],
    };

    const result = parseSendflowDailyRow({
      raw,
      window_start: "2026-05-11",
      window_end: "2026-06-15",
      synced_at: "2026-06-22T10:00:00Z",
    });

    expect(result.rows).toEqual([
      { date: "2026-05-11", entered: 1 },
      { date: "2026-05-12", entered: 48 },
      { date: "2026-05-13", entered: 226 },
      { date: "2026-06-01", entered: 122 + 44 }, // suma entre releases
      { date: "2026-06-02", entered: 37 + 9 },
      { date: "2026-06-11", entered: 1 },
      { date: "2026-06-12", entered: 1 },
      // 2026-06-17 NO aparece — fuera de ventana
    ]);
    expect(result.syncedAt).toBe("2026-06-22T10:00:00Z");
    expect(result.windowStart).toBe("2026-05-11");
    expect(result.windowEnd).toBe("2026-06-15");
  });

  it("keys malformadas se ignoran sin romper", () => {
    const result = parseSendflowDailyRow({
      raw: {
        releases: [
          {
            add_date_keys: {
              "11052026": 5,
              "notanumber": 99,
              "00132026": 10, // mes inválido
              "32052026": 10, // día inválido
            },
          },
        ],
      },
      window_start: "2026-05-01",
      window_end: "2026-05-31",
      synced_at: "2026-06-22T10:00:00Z",
    });
    expect(result.rows).toEqual([{ date: "2026-05-11", entered: 5 }]);
  });

  it("releases con shape malformado → array vacío sin throw", () => {
    const result = parseSendflowDailyRow({
      raw: { releases: "no soy array" },
      window_start: "2026-05-01",
      window_end: "2026-05-31",
      synced_at: "2026-06-22T10:00:00Z",
    });
    expect(result.rows).toEqual([]);
  });

  it("values string-numéricos se aceptan (defensivo)", () => {
    const result = parseSendflowDailyRow({
      raw: {
        releases: [
          {
            add_date_keys: {
              "11052026": "5", // string, no number
            },
          },
        ],
      },
      window_start: "2026-05-01",
      window_end: "2026-05-31",
      synced_at: "2026-06-22T10:00:00Z",
    });
    expect(result.rows).toEqual([{ date: "2026-05-11", entered: 5 }]);
  });
});
