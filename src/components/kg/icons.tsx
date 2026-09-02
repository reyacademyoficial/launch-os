/**
 * KG · íconos SVG básicos. 20×20, stroke 1.6, currentColor. Un archivo para
 * no romper el árbol con veinte imports triviales — cada ícono es un componente
 * mínimo. Coincide semánticamente con el IC.* del artefacto (exec, fin, mkt,
 * launch, cli, ops, aca) pero sin dependencias externas.
 */

type IconProps = Readonly<{ size?: number; className?: string }>;

const BASE = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({
  size = 20,
  className,
  children,
}: IconProps & { readonly children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      {...BASE}
    >
      {children}
    </svg>
  );
}

export function IconExec(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Svg>
  );
}

export function IconFin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-8" />
      <path d="M22 20H2" />
    </Svg>
  );
}

export function IconMkt(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 11v2a2 2 0 0 0 2 2h1l3 5 3-1-2-4h1l8-4V6L11 10H5a2 2 0 0 0-2 2Z" />
      <path d="M18 8v6" />
    </Svg>
  );
}

export function IconLaunch(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2s5 3 5 9-5 11-5 11-5-5-5-11 5-9 5-9Z" />
      <circle cx="12" cy="10" r="2" />
      <path d="M7 18l-3 3M17 18l3 3" />
    </Svg>
  );
}

export function IconCli(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20c.6-3.3 3.4-5 6.5-5s5.9 1.7 6.5 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M14.5 20c.4-2.4 2.2-3.7 4.5-3.7s2.5.5 3 1" />
    </Svg>
  );
}

export function IconOps(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h13" />
      <path d="M4 12h13" />
      <path d="M4 18h13" />
      <circle cx="19" cy="6" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
      <circle cx="19" cy="18" r="1.5" />
    </Svg>
  );
}

export function IconAca(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h11a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3V6Z" />
      <path d="M4 6a3 3 0 0 1 3-3h11" />
      <path d="M8 8h7" />
      <path d="M8 12h5" />
    </Svg>
  );
}

export function IconAdmin(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </Svg>
  );
}

export function IconCalc(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
      <path d="M8 16h.01M12 16h.01M16 16h.01" />
    </Svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </Svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 15A8 8 0 1 1 9 4a7 7 0 0 0 11 11Z" />
    </Svg>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  );
}

export function IconFilter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 5h18l-7 9v5l-4 2v-7L3 5Z" />
    </Svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </Svg>
  );
}

export function IconTable(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M3 15h18" />
      <path d="M9 10v10" />
    </Svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </Svg>
  );
}

export function IconOrg(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 21V7l6-3v17" />
      <path d="M9 21V11h11v10" />
      <path d="M13 14h3M13 17h3" />
      <path d="M5 10h1M5 13h1M5 16h1" />
    </Svg>
  );
}

export function IconPanelLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </Svg>
  );
}
