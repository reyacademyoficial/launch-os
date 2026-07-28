export interface ActivityFeedItem {
  readonly id?: string | number;
  readonly title: string;
  readonly detail?: string;
  readonly tag?: string;
  /** Color hex del dot lateral (glow) — típicamente semántico. */
  readonly color?: string;
}

/**
 * KG · ActivityFeed. Lista de actividad/alertas. El dot lateral tiene un
 * glow suave (box-shadow con el mismo color al ~47%), es la única superficie
 * donde permitimos "tinte de color" prominente porque cada ítem es discreto.
 */
export function ActivityFeed({
  items,
  empty = "Sin actividad",
}: {
  readonly items: ReadonlyArray<ActivityFeedItem> | null | undefined;
  readonly empty?: string;
}) {
  if (!items || items.length === 0) {
    return (
      <div
        style={{
          padding: 26,
          textAlign: "center",
          color: "var(--kg-text-3)",
          fontSize: 13,
        }}
      >
        {empty}
      </div>
    );
  }
  return (
    <div>
      {items.map((it, i) => (
        <div
          key={it.id ?? i}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 11,
            padding: "11px 18px",
            borderBottom:
              i < items.length - 1
                ? "1px solid var(--kg-border-subtle)"
                : "none",
          }}
        >
          <div
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              background: it.color ?? "var(--kg-neutral-500)",
              marginTop: 6,
              flexShrink: 0,
              boxShadow: `0 0 7px ${it.color ?? "var(--kg-neutral-500)"}77`,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                color: "var(--kg-text-1)",
                fontSize: 13,
              }}
            >
              {it.title}
            </div>
            {it.detail && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--kg-text-3)",
                  marginTop: 2,
                }}
              >
                {it.detail}
              </div>
            )}
          </div>
          {it.tag && (
            <span
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 20,
                background: "var(--kg-surface-2-solid)",
                border: "1px solid var(--kg-border-subtle)",
                color: "var(--kg-text-3)",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {it.tag}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
