import { defineTool } from "eve/tools";
import { z } from "zod";

// Web search for a provider the harness doesn't know.
//
// eve ships web_search as a *provider-managed* framework tool: its definition
// carries no execute, and the harness swaps in the native search of whichever
// model is running (openai / anthropic / google / gateway-parallel). With a
// custom provider such as Vyce the backend resolves to null and the harness
// deletes web_search from the tool set entirely.
//
// Authoring a tool under this exact slug is the harness's documented override
// path: the moment a definition carries its own execute, the provider-managed
// substitution stops applying and this one runs instead — on any model.
//
// Two backends, chosen per call:
//   exa    — neural/semantic search, returns page text. Best for research.
//   serper — Google SERP, returns snippets. Best for current events and prices.
//
// Contracts verified against live responses (HTTP 200) on 2026-09-15.

const EXA_ENDPOINT = "https://api.exa.ai/search";
const SERPER_SEARCH_ENDPOINT = "https://google.serper.dev/search";
const SERPER_NEWS_ENDPOINT = "https://google.serper.dev/news";

interface SearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  excerpt?: string;
  source?: string;
}

/** Serper filters by window, not by a day count: qdr:d|w|m|y. */
function serperWindow(days: number): string {
  if (days <= 1) return "qdr:d";
  if (days <= 7) return "qdr:w";
  if (days <= 31) return "qdr:m";
  return "qdr:y";
}

async function searchExa(
  query: string,
  maxResults: number,
  days: number | undefined,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const key = process.env.EXA_API_KEY;
  if (key === undefined || key.length === 0) throw new Error("EXA_API_KEY is not set.");

  const response = await fetch(EXA_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      query,
      numResults: maxResults,
      type: "auto",
      // Page text is the reason to pay for Exa; cap it so a single call can't
      // flood the context window.
      contents: { text: { maxCharacters: 1000 } },
      ...(days === undefined
        ? {}
        : { startPublishedDate: new Date(Date.now() - days * 86_400_000).toISOString() }),
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Exa ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    results?: Array<{ title: string; url: string; publishedDate?: string; text?: string }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    ...(r.publishedDate === undefined ? {} : { publishedDate: r.publishedDate }),
    ...(r.text === undefined ? {} : { excerpt: r.text }),
  }));
}

async function searchSerper(
  query: string,
  maxResults: number,
  topic: "general" | "news",
  days: number | undefined,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const key = process.env.SERPER_API_KEY;
  if (key === undefined || key.length === 0) throw new Error("SERPER_API_KEY is not set.");

  const response = await fetch(
    topic === "news" ? SERPER_NEWS_ENDPOINT : SERPER_SEARCH_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({
        q: query,
        num: maxResults,
        ...(topic === "news" && days !== undefined ? { tbs: serperWindow(days) } : {}),
      }),
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(`Serper ${response.status}: ${await response.text()}`);
  }

  if (topic === "news") {
    // The news endpoint returns no snippet — only headline, source and date.
    const data = (await response.json()) as {
      news?: Array<{ title: string; link: string; date?: string; source?: string }>;
    };
    return (data.news ?? []).map((n) => ({
      title: n.title,
      url: n.link,
      ...(n.date === undefined ? {} : { publishedDate: n.date }),
      ...(n.source === undefined ? {} : { source: n.source }),
    }));
  }

  const data = (await response.json()) as {
    organic?: Array<{ title: string; link: string; snippet?: string; date?: string }>;
  };
  return (data.organic ?? []).map((o) => ({
    title: o.title,
    url: o.link,
    ...(o.date === undefined ? {} : { publishedDate: o.date }),
    ...(o.snippet === undefined ? {} : { excerpt: o.snippet }),
  }));
}

export default defineTool({
  description:
    "Search the web for real-time information: current events, prices, releases, or anything that changed after your knowledge cutoff. Returns titles, URLs and excerpts. Use provider 'exa' for research and page content, 'serper' for Google results and news.",
  inputSchema: z.object({
    query: z.string().min(1).describe("The search query."),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("How many results to return. Keep it small unless you need breadth."),
    provider: z
      .enum(["exa", "serper"])
      .default("exa")
      .describe("Backend to use: exa (semantic, page text) or serper (Google, snippets)."),
    topic: z
      .enum(["general", "news"])
      .default("general")
      .describe("Serper only: 'news' hits Google News."),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("Restrict to the last N days. Honored by both backends."),
  }),
  async execute({ query, maxResults, provider, topic, days }, ctx) {
    const results =
      provider === "exa"
        ? await searchExa(query, maxResults, days, ctx.abortSignal)
        : await searchSerper(query, maxResults, topic, days, ctx.abortSignal);

    return { provider, query, resultCount: results.length, results };
  },
});
