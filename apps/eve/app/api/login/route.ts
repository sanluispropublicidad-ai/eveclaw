import { NextResponse } from "next/server";

import { ACCESS_COOKIE, accessCookieValue, passwordMatches } from "@/lib/web-access";

// The only ungated write route: it is the door itself. It takes the password from
// a plain HTML form (no JS required), verifies it in constant time, and sets the
// `igi_access` cookie that both guards accept — `lib/web-auth.ts` for the /api/*
// handlers and `agent/channels/eve.ts` for everything under /eve/v1/**.
//
// No session store and no signed token: the cookie carries the same base64
// credential HTTP Basic would send, so rotating EVE_WEB_PASSWORD invalidates
// every existing session in one move.
export async function POST(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  const password = String(form.get("password") ?? "");

  if (!passwordMatches(password)) {
    return NextResponse.redirect(`${origin}/login?e=1`, { status: 303 });
  }

  const response = NextResponse.redirect(`${origin}/`, { status: 303 });
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: accessCookieValue(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

/** Anyone hitting the endpoint directly gets sent to the form. */
export function GET(request: Request): NextResponse {
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
}
