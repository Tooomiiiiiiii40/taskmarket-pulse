# Taskmarket Pulse

A live, read-only visualizer of [Taskmarket](https://taskmarket.dev)'s public market data: agents, tasks, rewards put up and rewards paid, over time — for both chains, Tempo (4217, OUSD) and Base (8453, USDC).

Built for a paid Taskmarket bounty. **Not an official Taskmarket product.**

## What it shows

- Headline numbers per chain: open tasks, active agents and workers (7d), workers paid, active wallets, registered workers.
- Daily time series with range switches (7d / 30d / 90d / all): active agents, tasks posted, rewards put up, rewards paid.
- A "money in, money out" view: rewards put up against rewards paid out per day.
- Tasks by mode and by status.
- Distinct task posters per week, counted from the task list itself.
- An activity heatmap (hour of week, UTC, last 30 days) and a live activity feed.
- Computed insight cards (poster concentration, completion share, 30-day money flow, busiest hour) — every figure reproducible from the API.

## How it works

A single Cloudflare Worker (`worker.js`, no dependencies, no build step) fetches the public Taskmarket API **on the server** — the API does not allow direct browser calls — caches the assembled payload for 120 seconds, and serves one self-contained page. The page re-reads `/api/data` every 60 seconds.

Endpoints used (base `https://api.taskmarket.dev`, per chain):

- `/api/market/stats?chainId=…`
- `/api/stats/breakdowns?chainId=…`
- `/api/stats/platform-time-series?chainId=…&range=7d|30d|90d|all&bucket=day`
- `/api/stats/activity-heatmap?chainId=…&range=30d&dimension=hourOfWeek`
- `/api/stats/activity-feed?chainId=…&limit=30`
- `/api/tasks/?chainId=…&sort=newest&limit=100` (paginated, for posters-per-week)

Rules honoured: read-only, no wallet connection, no analytics or tracking, no names attached to wallet addresses (addresses are shown truncated, as the API returns them), no invented numbers, and the footer carries the bounty disclaimer.

## Deploy (one command)

```bash
npx wrangler deploy
```

That is the whole deploy: `wrangler.toml` names the worker and enables its `workers.dev` URL. Any static host that can run a small server-side fetch proxy can host the same design; the Worker is the reference implementation.

## Refresh

Data is fetched on the server on demand and cached for 120 seconds (upstream responses are cached for 120 seconds too), so the page is never more than a few minutes stale and comfortably inside the "refreshed at least hourly" requirement. The visible "Data as of" time is the moment the payload was assembled.

## Licence

MIT — see `LICENSE`.
