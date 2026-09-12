import { createUnauthorizedResponse, verifyHttpBasic } from "eve/channels/auth";

/** Loopback only: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`. Mirrors eve's `localDev()`. */
function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return ipv4 !== null && ipv4[1] === "127";
}

/**
 * Guards Next.js route handlers with the same credential as the eve channel
 * (`agent/channels/eve.ts`), so the browser prompts once per device and both
 * halves of the app accept the same login.
 *
 * The route handlers sit outside `/eve/v1/**` — which the Vercel platform routes
 * straight to the eve service, bypassing this app entirely — so the channel gate
 * and this one are complementary, not redundant. Both must hold.
 *
 * Returns `null` when the request may proceed, or the Response to return.
 * Fails closed: with no configured password, only loopback gets through.
 */
export function requireWebAuth(request: Request): Response | null {
  const username = process.env.EVE_WEB_USER ?? "igi";
  const password = process.env.EVE_WEB_PASSWORD;

  if (password === undefined || password.length === 0) {
    if (isLoopback(new URL(request.url).hostname)) return null;
    return createUnauthorizedResponse({
      status: 403,
      code: "auth_not_configured",
      message: "EVE_WEB_PASSWORD is not set on this deployment.",
      challenges: [{ scheme: "Basic", parameters: { realm: "igi" } }],
    });
  }

  const result = verifyHttpBasic(request.headers.get("authorization"), { username, password });
  if (result.ok) return null;

  return createUnauthorizedResponse({
    challenges: [{ scheme: "Basic", parameters: { realm: "igi" } }],
  });
}
