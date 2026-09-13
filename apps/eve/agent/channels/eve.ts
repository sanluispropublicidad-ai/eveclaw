import {
  localDev,
  vercelOidc,
  verifyHttpBasic,
  withAuthChallenges,
  type AuthFn,
} from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

// This agent is personal: its web chat is NOT open to the internet.
//
// It used to be `none()`, which accepted any anonymous caller — anyone with the
// URL could converse with the agent, read long-term memory, reach the connected
// Gmail, and burn the model credits. Every route now requires a credential.
//
// Auth walk order matters:
//   1. vercelOidc() — the deployment's own runtime callers (subagents, internal
//      fetches) and the eve TUI. Cryptographic, so it cannot be spoofed.
//   2. localDev()   — loopback only (localhost / 127.0.0.0/8 / ::1). Never
//      matches a public host, so it cannot be spoofed by a Host header.
//   3. webAccess()  — the browser, by cookie; curl and scripts, by HTTP Basic.
//
// Why the cookie: the native Basic dialog never appears for `fetch()` calls, and
// the chat is nothing but fetch. Relying on that dialog locked the UI out with a
// raw 401 body. The form at `/login` posts to `/api/login`, which sets
// `igi_access`; the cookie carries the same base64 credential Basic would send.
//
// Fail closed: with no EVE_WEB_PASSWORD the last entry rejects instead of opening
// the door, so a misconfigured deployment returns 401, never anonymous access.
const ACCESS_COOKIE = "igi_access";

/** Reads one cookie out of a raw `Cookie` header. Mirrors `lib/web-access.ts`. */
function readCookie(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== ACCESS_COOKIE) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function webAccess(): AuthFn<Request> {
  const password = process.env.EVE_WEB_PASSWORD;
  if (password === undefined || password.length === 0) {
    return withAuthChallenges(() => null, [{ scheme: "Basic" }]);
  }

  const credentials = { username: process.env.EVE_WEB_USER ?? "igi", password };

  return withAuthChallenges((request) => {
    const direct = verifyHttpBasic(request.headers.get("authorization"), credentials);
    if (direct.ok) return direct.sessionAuth;

    // Login-form path: the cookie holds the same base64 credential, so handing it
    // to the framework's verifier yields a real SessionAuthContext — no session
    // store of our own, and rotating the password invalidates every cookie at once.
    const cookie = readCookie(request.headers.get("cookie"));
    if (cookie === null) return null;
    const fromCookie = verifyHttpBasic(`Basic ${cookie}`, credentials);
    return fromCookie.ok ? fromCookie.sessionAuth : null;
  }, [{ scheme: "Basic" }]);
}

export default eveChannel({
  auth: [vercelOidc(), localDev(), webAccess()],
});
