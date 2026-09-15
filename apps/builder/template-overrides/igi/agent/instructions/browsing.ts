import { defineDynamic, defineInstructions } from "eve/instructions";

// web_fetch is a plain HTTP fetch: no browser, no JavaScript, no cookies. Sites
// behind anti-bot protection answer it with 403, and client-rendered pages come
// back nearly empty. Measured 2026-09-15: web_fetch on mx.investing.com
// returned "Request failed with status code: 403" while the browser extension
// rendered the same URL fine. Without this note the agent treats that 403 as
// the page being unreachable and answers from the search excerpt alone.
//
// The order matters: browser__read WITH a url fetches without the browser and
// hits the same 403, so navigate first and then read the rendered tab.
const BROWSING_NOTE = `
Reading pages: web_fetch has no browser behind it, so sites with anti-bot
protection answer 403 and pages that render client-side come back empty. When
that happens, do not give up and do not call the page unreachable — switch to
the browser:

1. browser__navigate with the URL. That opens it in the sandboxed Chromium; the
   browser launches on first use, so the first call is slower.
2. browser__read with NO url argument, so it reads the rendered tab instead of
   fetching again. Reach for browser__snapshot only when you need to see or
   click elements, and browser__get when you need one specific value.

browser__read with a url argument fetches without the browser and hits the same
403, so navigate first and then read the tab. If the page still refuses, say so
plainly instead of presenting the search excerpt as the page content.
`.trim();

export default defineDynamic({
  events: {
    "turn.started": () => defineInstructions({ markdown: BROWSING_NOTE }),
  },
});
