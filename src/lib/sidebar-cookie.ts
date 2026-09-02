import "server-only";

import { cookies } from "next/headers";

import { isSidebarCollapsedValue, SIDEBAR_COOKIE } from "./sidebar";

/**
 * Lee la preferencia de colapso de la sidebar. Default: expandida (cookie
 * ausente), que es el layout histórico del shell.
 */
export async function readSidebarCollapsedCookie(): Promise<boolean> {
  const jar = await cookies();
  return isSidebarCollapsedValue(jar.get(SIDEBAR_COOKIE)?.value);
}
