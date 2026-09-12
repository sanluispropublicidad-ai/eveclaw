import { httpBasic, localDev, vercelOidc, withAuthChallenges, type AuthFn } from "eve/channels/auth";
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
//   3. webBasic()   — the browser: HTTP Basic, prompt once per device.
//
// Fail closed: if EVE_WEB_PASSWORD is missing, the last entry rejects instead of
// opening the door. A misconfigured deployment returns 401, never anonymous access.
function webBasic(): AuthFn<Request> {
  const password = process.env.EVE_WEB_PASSWORD;
  if (password === undefined || password.length === 0) {
    return withAuthChallenges(() => null, [{ scheme: "Basic" }]);
  }
  return httpBasic(
    { username: process.env.EVE_WEB_USER ?? "igi", password },
    { realm: "igi" },
  );
}

export default eveChannel({
  auth: [vercelOidc(), localDev(), webBasic()],
});
