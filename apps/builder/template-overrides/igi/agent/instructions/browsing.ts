import { defineDynamic, defineInstructions } from "eve/instructions";

// web_fetch is a plain HTTP fetch: no browser, no JavaScript, no cookies. Sites
// behind anti-bot protection answer it with 403, and client-rendered pages come
// back nearly empty. Measured 2026-09-15: web_fetch on mx.investing.com
// returned "Request failed with status code: 403".
//
// The first version of this note explained the rule in prose ("navigate first
// and then read the tab") and the model still called browser__read WITH a url,
// which fetches without the browser and hit the same 403. Prose lost to the
// tool's own parameter. The note now spells out the exact calls and marks the
// url argument as forbidden, because concrete shapes survive and rules do not.
const BROWSING_NOTE = `
Reading a page web_fetch cannot open (403, empty body, or content that only
appears with JavaScript). Exact sequence, in this order:

1. browser__navigate  {"action": "goto", "url": "https://example.com/page"}
2. browser__read      {}
3. If 2 came back empty, try browser__get {"property": "text"}, then
   browser__snapshot {} to see the elements.

Never pass a url to browser__read in this flow. With a url it fetches without
the browser and returns the same 403 you were escaping; with no arguments it
reads the tab the browser already rendered. Passing the url is the single
mistake that makes this whole path look broken.

A 403 from web_fetch is not the page being unreachable — it means the page
refuses plain clients. Try the browser before saying you could not read it, and
never present a search excerpt as if it were the page content.
`.trim();

export default defineDynamic({
  events: {
    "turn.started": () => defineInstructions({ markdown: BROWSING_NOTE }),
  },
});
