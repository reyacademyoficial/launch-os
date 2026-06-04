export default function AuthLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
