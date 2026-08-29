export default function AuthLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <div
      className="relative min-h-dvh w-full overflow-hidden"
      style={{ background: "var(--kg-bg-base)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 50% at 50% -10%, rgba(220,20,60,0.18), transparent 65%), radial-gradient(60% 50% at 100% 100%, rgba(220,20,60,0.10), transparent 70%)",
        }}
      />
      <div
        className="relative z-10 flex min-h-dvh w-full flex-col items-center justify-center px-5 sm:px-8"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 24px)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
