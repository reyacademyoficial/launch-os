"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={
        "block rounded-md px-3 py-2 text-sm font-medium transition-colors " +
        (isActive
          ? "bg-accent/15 text-accent"
          : "text-fg-muted hover:bg-surface hover:text-fg")
      }
      aria-current={isActive ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
