import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Verifies email-link tokens (invite / recovery / email-change) from Supabase.
 *
 * Supports BOTH redirect formats so the route works regardless of the project's
 * Auth flow_type setting:
 *
 *   1. PKCE code exchange — `?code=XXX` (current default for projects since 2024).
 *      Call `exchangeCodeForSession(code)`.
 *
 *   2. OTP verify — `?token_hash=XXX&type=invite` (older / explicit-template
 *      configurations). Call `verifyOtp({ type, token_hash })`.
 *
 * Both paths land at `/set-password` on success and at `/login` with a
 * diagnostic `dbg` query param on failure so the actual incoming params show
 * up in the UI for debugging.
 *
 * NOTE: implicit-flow links (`#access_token=...` in the URL fragment) cannot be
 * handled server-side — fragments never reach the server. If a Supabase
 * project is configured for implicit flow, the email template must be changed
 * to use `{{ .ConfirmationURL }}` (PKCE) or `{{ .TokenHash }}` (OTP).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/set-password";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  const seenParams = Array.from(searchParams.keys());
  const fallback = new URL("/login", origin);
  fallback.searchParams.set(
    "error",
    seenParams.length === 0 ? "invalid_invite" : "verification_failed",
  );
  if (seenParams.length > 0) {
    fallback.searchParams.set("dbg", seenParams.join(","));
  }
  return NextResponse.redirect(fallback);
}
