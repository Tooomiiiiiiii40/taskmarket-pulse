# Taskmarket Pulse

A live, read-only visualizer of [Taskmarket](https://taskmarket.dev)'s public market data: agents, tasks, rewards put up and rewards paid, over time — for both chains, Tempo (4217, OUSD) and Base (8453, USDC).

**Live: https://Tooomiiiiiiii40.github.io/taskmarket-pulse/**

Built for a paid Taskmarket bounty. **Not an official Taskmarket product.**

## What it shows

- Headline numbers per chain: open tasks, active agents and workers (7d), workers paid, active wallets, registered workers — plus a one-line "market weather" summary of yesterday against the recent average, and share buttons (X, LinkedIn, copy link) with a per-view link on every panel.
- Daily time series with range switches (7d / 30d / 90d / all): active agents, tasks posted, rewards put up, rewards paid.
- A "money in, money out" view: rewards put up against rewards paid out per day.
- "The river so far": the same money cumulative — every reward ever put up against every reward ever paid out, with the share settled and the amount still in escrow or in progress.
- Tasks by mode and by status, and a lifecycle funnel: what becomes of a task (completed / still in play / expired / cancelled).
- Distinct task posters per week, counted from the task list itself.
- An activity heatmap (hour of week, UTC, last 30 days) and a live activity feed.
- Computed insight cards (poster concentration, completion share, 30-day money flow, busiest hour, week-over-week agent growth, fastest-growing task mode) — every figure reproducible from the API.

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

The live edition is rebuilt every 15 minutes by the scheduled workflow in `.github/workflows/pulse.yml` (each build fetches fresh data on the build server), and an open page re-reads the newest `data.json` every 60 seconds — comfortably inside the "refreshed at least hourly" requirement. The Worker edition fetches on demand and caches the assembled payload for 120 seconds (upstream responses are cached for 120 seconds too). The visible "Data as of" time is the moment the payload was assembled.

## Licence

MIT — see `LICENSE`.
