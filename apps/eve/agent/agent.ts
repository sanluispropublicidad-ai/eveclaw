import type { LanguageModelMiddleware, ModelMessage } from "ai";
import { gateway, wrapLanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent, defineDynamic } from "eve";

// Default model. With LLM_BASE_URL + LLM_API_KEY set, the agent talks straight
// to that OpenAI-compatible provider instead of Vercel's AI Gateway, so the
// default and everything the chat picker sends must be ids that provider knows.
const DEFAULT_MODEL = process.env.LLM_MODEL ?? "anthropic/claude-sonnet-5";

// Gateway ids are "vendor/model"; self-hosted gateways (Vyce, b.ai, NaraRouter)
// use bare slugs like "deepseek-v4-flash", so the slash is optional now.
const MODEL_ID_PATTERN = /^[\w.-]+(\/[\w.:-]+)?$/;

const CUSTOM_PROVIDER = Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY);

function liveModel(modelId: string) {
  if (CUSTOM_PROVIDER) {
    return createOpenAI({
      baseURL: process.env.LLM_BASE_URL!,
      apiKey: process.env.LLM_API_KEY!,
    }).chat(modelId);
  }
  return gateway(modelId);
}

/** The AI SDK's provider-agnostic reasoning effort levels, minus the default. */
const REASONING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
type ReasoningLevel = (typeof REASONING_LEVELS)[number];

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);
}

const CLIENT_CONTEXT_PREFIX = "Client context:\n";

interface TurnSettings {
  model: string | null;
  reasoning: ReasoningLevel | null;
}

const NO_SETTINGS: TurnSettings = { model: null, reasoning: null };

/**
 * The web chat attaches `{ eveWebModel, eveWebReasoning? }` as one-turn
 * `clientContext`, which the eve channel delivers as a user-role message of
 * the exact form `Client context:\n<json>`. Scan the visible conversation
 * from the end for a message that parses to that shape, so ordinary
 * conversation text merely mentioning the keys cannot match.
 */
function requestedSettings(messages: readonly ModelMessage[]): TurnSettings {
  for (let index = messages.length - 1; index >= 0; index--) {
    const { content } = messages[index];
    const texts =
      typeof content === "string"
        ? [content]
        : content.map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""));
    for (const text of texts) {
      const settings = parseSettingsMarker(text);
      if (settings !== null) return settings;
    }
  }
  return NO_SETTINGS;
}

function parseSettingsMarker(text: string): TurnSettings | null {
  if (!text.startsWith(CLIENT_CONTEXT_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(CLIENT_CONTEXT_PREFIX.length));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const modelValue = record.eveWebModel;
    const model =
      typeof modelValue === "string" && MODEL_ID_PATTERN.test(modelValue) ? modelValue : null;
    const reasoning = isReasoningLevel(record.eveWebReasoning) ? record.eveWebReasoning : null;
    if (model === null && reasoning === null) return null;
    return { model, reasoning };
  } catch {
    return null;
  }
}

function reasoningMiddleware(reasoning: ReasoningLevel): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => ({
      ...params,
      reasoning: params.reasoning ?? reasoning,
      providerOptions: {
        ...params.providerOptions,
        // eve enables the gateway's automatic prompt caching for string model
        // ids only; a live model bypasses that path, so re-apply it here.
        gateway: { caching: "auto", ...params.providerOptions?.gateway },
      },
    }),
  };
}

export default defineAgent({
  // A provider outside the AI Gateway isn't in eve's model catalog, so
  // compaction can't look up its context window and the build fails without
  // this. 128K is a safe floor for the DeepSeek-class models.
  ...(CUSTOM_PROVIDER ? { modelContextWindowTokens: 131072 } : {}),
  model: CUSTOM_PROVIDER
    ? // Own provider: every selection resolves through it, including the
      // per-turn one the chat picker sends. String ids can't be used here
      // because the harness would resolve them against the gateway.
      defineDynamic({
        fallback: liveModel(DEFAULT_MODEL),
        events: {
          "step.started": (_event, ctx) => {
            const { model, reasoning } = requestedSettings(ctx.messages);
            const target = liveModel(model ?? DEFAULT_MODEL);
            if (reasoning === null) return target;
            return wrapLanguageModel({
              model: target,
              middleware: reasoningMiddleware(reasoning),
            });
          },
        },
      })
    : defineDynamic({
        fallback: DEFAULT_MODEL,
        events: {
          "turn.started": (_event, ctx) => requestedSettings(ctx.messages).model,
          // Reasoning effort is a per-call AI SDK setting, not a field the dynamic
          // model selection object accepts, so a requested level rides on a live
          // gateway model wrapped with default settings. Live models are only
          // allowed from step.started; with no level requested this returns null
          // and the turn-scoped string selection (plain prompt-cache path) wins.
          "step.started": (_event, ctx) => {
            const { model, reasoning } = requestedSettings(ctx.messages);
            if (reasoning === null) return null;
            return wrapLanguageModel({
              model: gateway(model ?? DEFAULT_MODEL),
              middleware: reasoningMiddleware(reasoning),
            });
          },
        },
      }),
});
