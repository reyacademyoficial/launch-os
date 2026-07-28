/**
 * KG · Delta. Flecha + valor en color semántico. Nunca se pinta el número al
 * que refiere el delta — el delta va al lado, con su propio tono.
 */
export function Delta({
  value,
  dir,
}: {
  readonly value: string | number | null | undefined;
  readonly dir: "up" | "down";
}) {
  if (value == null) return null;
  const color =
    dir === "up" ? "var(--kg-positive-500)" : "var(--kg-negative-500)";
  return (
    <span
      className="kg-num"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 11,
        fontWeight: 600,
        color,
      }}
    >
      <span style={{ fontSize: 8 }} aria-hidden>
        {dir === "up" ? "▲" : "▼"}
      </span>
      {value}
    </span>
  );
}
