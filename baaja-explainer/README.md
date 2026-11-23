# BAAJA Claim Check (public site)

A nonpartisan explainer for the Bipartisan American Affordability and Jobs Act of 2026: claim checks against the Senate-passed text, verbatim bill quotes with page images, stakeholder positions, sources, and an "Ask a question" box answered by Claude.

- `public/index.html`: the page. All content is in the `#bill-data` JSON block.
- `public/data/bill-pages.json`: full bill text (494 pages, line-numbered), used for search and quote checks.
- `public/page-images/`: images of the cited bill pages.
- `server.js`: static file server plus `/api/ask`, which calls the Anthropic API. It has no dependencies (Node 20+).

## Deploy on Render
Render reads `render.yaml` at the repo root (branch `baaja-explainer`) and runs it as a web service with `rootDir: baaja-explainer`.
Set `ANTHROPIC_API_KEY` in the Render dashboard. Optional settings: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `DAILY_CAP` (default 300 questions per day across all visitors), `PER_IP_PER_HOUR` (default 10).
Without an API key the site still works; only the Ask box is switched off.

## Updating
Replace `public/index.html` (and the data or images if the bill text changed), then commit to `baaja-explainer`. Render redeploys automatically.
