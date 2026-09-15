import { agentBrowserRevalidationKey, installAgentBrowser } from "@agent-browser/eve/sandbox";
import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

// Pre-install agent-browser (and Chromium) into the sandbox template so
// browser sessions start warm instead of installing on first tool use.
export default defineSandbox({
  backend: vercel({
    resources: { vcpus: 2 },
    // A fresh sandbox runs UTC, six hours ahead of the owner, so the bash tool's
    // `date` contradicted the Mexico City clock the prompt injects. `env` here is
    // inherited by every command in the sandbox, which makes both agree.
    env: { TZ: "America/Mexico_City" },
  }),
  revalidationKey: () => agentBrowserRevalidationKey(),
  async bootstrap({ use }) {
    const sandbox = await use();
    await installAgentBrowser(sandbox);
  },
});
