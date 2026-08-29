import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";

import { isTheme, THEME_COOKIE } from "@/lib/theme";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "KinGrow",
    template: "%s · KinGrow",
  },
  description: "Sistema operativo de lanzamientos para campañas de marketing digital",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  // Render the cookie theme into a data attribute on <html>. Absence (= "system")
  // intentionally renders no attribute so the CSS @media prefers-color-scheme
  // path is the one active.
  const jar = await cookies();
  const cookieTheme = jar.get(THEME_COOKIE)?.value;
  const theme = isTheme(cookieTheme) ? cookieTheme : "system";

  return (
    <html
      lang="es"
      className={inter.variable}
      data-theme={theme === "system" ? undefined : theme}
    >
      <body className="font-sans">{children}</body>
    </html>
  );
}
