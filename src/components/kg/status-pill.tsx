/**
 * KG · StatusPill. Dot de color + texto NEUTRO. Sin fondo tintado — evita el
 * efecto semáforo cuando aparecen varios pills seguidos. Si `text` viene vacío,
 * placeholder "—" en gris.
 */
export function StatusPill({
  text,
  tone,
}: {
  readonly text: string | number | null | undefined;
  readonly tone?: string;
}) {
  if (text == null || text === "") {
    return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12,
        fontWeight: 500,
        color: "var(--kg-text-2)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: 999,
          background: tone ?? "var(--kg-neutral-500)",
          flexShrink: 0,
        }}
      />
      {text}
    </span>
  );
}
