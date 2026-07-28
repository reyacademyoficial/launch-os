/**
 * KG · Brand cube. Cuadrado 34×34 con gradiente carmesí y la "K". Al lado
 * (opcional) el nombre "Kingrow" y "SYSTEM" en micro-uppercase.
 */
export function KgBrand({ showText = true }: { readonly showText?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[15px] font-black text-white"
        style={{
          background: "linear-gradient(135deg, var(--kg-accent-500), var(--kg-accent-700))",
          boxShadow: "var(--kg-glow-accent)",
        }}
        aria-hidden
      >
        K
      </div>
      {showText && (
        <div className="min-w-0">
          <div className="kg-t4 leading-none" style={{ color: "var(--kg-text-1)" }}>
            Kingrow
          </div>
          <div className="kg-t7 mt-1" style={{ color: "var(--kg-text-3)" }}>
            SYSTEM
          </div>
        </div>
      )}
    </div>
  );
}
