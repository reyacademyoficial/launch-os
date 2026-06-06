"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { isTheme, THEME_COOKIE } from "@/lib/theme";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Persists the user's theme choice in a cookie so the next SSR pass renders
 * with the right palette and no flash. "system" clears the cookie so the
 * server stops forcing a `data-theme` attribute and the browser's
 * `prefers-color-scheme` media query takes over.
 */
export async function setTheme(formData: FormData): Promise<void> {
  const next = formData.get("theme");
  if (!isTheme(next)) return;

  const jar = await cookies();
  if (next === "system") {
    jar.delete(THEME_COOKIE);
  } else {
    jar.set(THEME_COOKIE, next, {
      maxAge: ONE_YEAR,
      sameSite: "lax",
      path: "/",
    });
  }

  revalidatePath("/", "layout");
}
