import "server-only";

import { cookies } from "next/headers";

import { isTheme, type Theme, THEME_COOKIE } from "./theme";

/**
 * Reads the persisted theme cookie. Defaults to "system" when absent or
 * invalid so the browser's prefers-color-scheme takes over.
 */
export async function readThemeCookie(): Promise<Theme> {
  const jar = await cookies();
  const value = jar.get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : "system";
}
