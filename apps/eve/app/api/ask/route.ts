import { Client, type HandleMessageStreamEvent, type SessionState } from "eve/client";

import { requireWebAuth } from "@/lib/web-auth";

// Programmatic API for the agent: POST one message, get back what it said.
//
// eve already exposes the raw session surface at /eve/v1 (POST to open a
// session, GET its NDJSON stream), but that surface is streaming-only and
// speaks event objects. This route is the one-shot version: it runs a turn,
// waits for the turn boundary, and returns the assistant's final text.
//
// It calls our own eve channel with the deployment's own credential, so it
// behaves identically under `npm run dev` and in production - no Vercel OIDC
// round trip, no cookie jar.
//
// The door is the same one the rest of the app uses (requireWebAuth): the
// `igi_access` cookie from the login form, or HTTP Basic for curl and scripts.

const MAX_MESSAGE_CHARS = 8000;

/**
 * Where our own eve routes live. Inside the deployment that is this host.
 *
 * Prefer the production domain over `VERCEL_URL`: the deployment-specific host
 * sits behind Vercel Deployment Protection, so a self-call to it returns a 401
 * SSO redirect instead of reaching the agent. Mirrors `lib/webhooks-db.ts`.
 */
function agentHost(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (host !== undefined && host.length > 0) return `https://${host}`;
  return `http://localhost:${process.env.PORT ?? "3000"}`;
}

/**
 * A client bound to our own agent. Credentials are passed explicitly rather
 * than relying on `vercelOidc()`: the auth walk in `agent/channels/eve.ts`
 * accepts Basic on every route, so this works the same locally and deployed.
 */
function agentClient(): Client {
  const username = process.env.EVE_WEB_USER ?? "igi";
  const password = process.env.EVE_WEB_PASSWORD ?? "";
  if (password.length === 0) return new Client({ host: agentHost() });
  return new Client({ host: agentHost(), auth: { basic: { username, password } } });
}

interface TurnSummary {
  reply: string | null;
  reasoning: string | null;
  tools: string[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  status: "waiting" | "completed" | "failed";
  error: { code: string; message: string } | null;
}

/**
 * Collapses a turn's event log into the answer.
 *
 * `message.completed` fires once per assistant step, so a turn that called a
 * tool emits several. Only the ones whose `finishReason` is not `tool-calls`
 * are real replies - the others are narration before a tool call. The last
 * such message wins.
 */
function summarize(events: readonly HandleMessageStreamEvent[]): TurnSummary {
  let reply: string | null = null;
  let reasoning: string | null = null;
  let status: TurnSummary["status"] = "completed";
  let error: TurnSummary["error"] = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let sawCost = false;
  const tools: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case "message.completed": {
        const { finishReason, message } = event.data;
        if (finishReason !== "tool-calls" && typeof message === "string" && message.trim().length > 0) {
          reply = message;
        }
        break;
      }
      case "reasoning.completed": {
        if (event.data.reasoning.trim().length > 0) reasoning = event.data.reasoning;
        break;
      }
      case "actions.requested": {
        for (const action of event.data.actions) {
          const name =
            action.kind === "tool-call"
              ? action.toolName
              : action.kind === "load-skill"
                ? "load_skill"
                : action.kind === "subagent-call"
                  ? action.subagentName
                  : action.remoteAgentName;
          if (!tools.includes(name)) tools.push(name);
        }
        break;
      }
      case "step.completed": {
        const usage = event.data.usage;
        if (usage !== undefined) {
          inputTokens += usage.inputTokens ?? 0;
          outputTokens += usage.outputTokens ?? 0;
          if (typeof usage.costUsd === "number") {
            costUsd += usage.costUsd;
            sawCost = true;
          }
        }
        break;
      }
      case "session.waiting":
        status = "waiting";
        break;
      case "session.completed":
        status = "completed";
        break;
      case "session.failed":
        status = "failed";
        error = { code: event.data.code, message: event.data.message };
        break;
      default:
        break;
    }
  }

  return {
    reply,
    reasoning,
    tools,
    usage: { inputTokens, outputTokens, costUsd: sawCost ? costUsd : null },
    status,
    error,
  };
}

/** The documented contract, so `curl` alone is enough to learn the shape. */
export async function GET(request: Request) {
  const denied = requireWebAuth(request);
  if (denied !== null) return denied;

  return Response.json({
    endpoint: "POST /api/ask",
    body: {
      message: "string (required)",
      session: "optional SessionState from a previous response, to continue that conversation",
    },
    returns: {
      reply: "the agent's final text, or null if it produced none",
      reasoning: "final reasoning block, when the model provides one",
      tools: "names of the actions the turn requested",
      usage: "token counts and cost, summed over the turn's steps",
      status: "waiting | completed | failed",
      session: "pass this back as `session` to continue the conversation",
    },
    notes: [
      "Text only for now - attachments are not accepted on this route.",
      `message is capped at ${MAX_MESSAGE_CHARS} characters.`,
      "Append ?format=text to get the reply with no JSON wrapper.",
    ],
  });
}

export async function POST(request: Request) {
  const denied = requireWebAuth(request);
  if (denied !== null) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json", message: "Body must be JSON." }, { status: 400 });
  }

  const { message, session: resume } = (body ?? {}) as { message?: unknown; session?: unknown };

  if (typeof message !== "string" || message.trim().length === 0) {
    return Response.json(
      { error: "missing_message", message: "`message` must be a non-empty string." },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return Response.json(
      { error: "message_too_long", message: `\`message\` exceeds ${MAX_MESSAGE_CHARS} characters.` },
      { status: 413 },
    );
  }

  const client = agentClient();
  const session =
    resume !== undefined && resume !== null && typeof resume === "object"
      ? client.session(resume as SessionState)
      : client.session();

  const events: HandleMessageStreamEvent[] = [];
  try {
    const response = await session.send({ message });
    // Iterating the response stops at the turn boundary (session.waiting,
    // session.completed, session.failed) - see isCurrentTurnBoundaryEvent.
    for await (const event of response) events.push(event);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return Response.json({ error: "agent_unreachable", message: detail }, { status: 502 });
  }

  const summary = summarize(events);

  // `?format=text` returns the bare reply. A query parameter rather than
  // `Accept: text/plain`: the Accept variant reached the function but never
  // answered in production, while the JSON path was fine.
  if (new URL(request.url).searchParams.get("format") === "text") {
    return new Response(summary.reply ?? "", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return Response.json({
    ...summary,
    session: session.state,
    events: events.length,
  });
}
