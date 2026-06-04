import { NextResponse, type NextRequest } from "next/server";

/**
 * Phase 1 stub. Phase 3 implements:
 *   - Reads `token_hash` + `type` from the URL.
 *   - Calls `supabase.auth.verifyOtp({ type: 'invite', token_hash })`.
 *   - On success, redirects to `/set-password`.
 *   - On error, redirects to `/login?error=invalid_invite`.
 */
export async function GET(_request: NextRequest) {
  return NextResponse.redirect(new URL("/login", _request.url));
}
