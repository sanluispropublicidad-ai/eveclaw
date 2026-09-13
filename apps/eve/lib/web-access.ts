import { timingSafeEqual } from "node:crypto";

/**
 * Credential handling for the closed-door deployment.
 *
 * The login form and HTTP Basic carry the *same* secret: the browser either
 * sends `Authorization: Basic base64("<user>:<password>")` or the `igi_access`
 * cookie holding that exact base64 string. One credential, two transports — so
 * rotating `EVE_WEB_PASSWORD` invalidates every session at once, with no
 * separate session store to keep in sync.
 *
 * The agent's channel gate (`agent/channels/eve.ts`) reads the same cookie with
 * its own copy of the reader below: the eve bundle does not import from this
 * tree. **If the cookie name or its value shape changes, change both.**
 */
export const ACCESS_COOKIE = "igi_access";

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The exact value Basic sends, minus the `Basic ` prefix. */
export function accessCookieValue(): string {
  const username = process.env.EVE_WEB_USER ?? "igi";
  const password = process.env.EVE_WEB_PASSWORD ?? "";
  return Buffer.from(`${username}:${password}`, "utf8").toString("base64");
}

/** Constant-time password check for the login form. Fails closed when unset. */
export function passwordMatches(candidate: string): boolean {
  const expected = process.env.EVE_WEB_PASSWORD ?? "";
  if (expected.length === 0) return false;
  return constantTimeEquals(candidate, expected);
}

/** Whether a presented cookie value is the current credential. */
export function cookieIsValid(value: string | null | undefined): boolean {
  const password = process.env.EVE_WEB_PASSWORD ?? "";
  if (password.length === 0) return false;
  if (value === null || value === undefined || value.length === 0) return false;
  return constantTimeEquals(value, accessCookieValue());
}

/**
 * True when the door is armed, i.e. a password is configured. Page guards skip
 * the login redirect while it is false, so `npm run dev` keeps working on a
 * machine with no password in `.env.local`. Production always has one.
 */
export function accessIsArmed(): boolean {
  return (process.env.EVE_WEB_PASSWORD ?? "").length > 0;
}

/** Reads one cookie out of a raw `Cookie` header. */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}
