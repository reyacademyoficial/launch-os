type Variant = "success" | "warning" | "neutral" | "info";

const VARIANTS: Record<Variant, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  info: "bg-accent/15 text-accent",
  neutral: "bg-surface text-fg-subtle",
};

export function Badge({
  children,
  variant = "neutral",
}: {
  readonly children: React.ReactNode;
  readonly variant?: Variant;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${VARIANTS[variant]}`}
    >
      {children}
    </span>
  );
}
