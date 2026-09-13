import { gateway } from "ai";

import { requireWebAuth } from "@/lib/web-auth";

// With LLM_BASE_URL + LLM_API_KEY set the agent talks to that provider, so the
// chat picker has to list *its* catalog, not the gateway's.
async function customModels(): Promise<{ id: string; name: string; description: null; pricing: null }[]> {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseURL || !apiKey) return [];
  const response = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: { id?: string }[] };
  return (payload.data ?? [])
    .filter((model): model is { id: string } => typeof model.id === "string")
    .map((model) => ({ id: model.id, name: model.id, description: null, pricing: null }));
}

export async function GET(request: Request) {
  const denied = requireWebAuth(request);
  if (denied !== null) return denied;

  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY) {
    try {
      return Response.json({ models: await customModels() });
    } catch {
      return Response.json({ models: [] });
    }
  }
  try {
    const { models } = await gateway.getAvailableModels();
    const language = models
      .filter((model) => (model.modelType ?? "language") === "language")
      .map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description ?? null,
        pricing: model.pricing
          ? { input: model.pricing.input, output: model.pricing.output }
          : null,
      }));
    return Response.json({ models: language });
  } catch {
    return Response.json({ models: [] });
  }
}
