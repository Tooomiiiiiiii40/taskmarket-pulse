// Taskmarket Pulse — a live, read-only visualizer of Taskmarket's public market data.
// Built for a paid Taskmarket bounty. Not an official Taskmarket product.
// All numbers come from the public Taskmarket API, fetched on the server and cached.

const API = 'https://api.taskmarket.dev';
const CHAINS = [4217, 8453];
const CHAIN_NAME = { 4217: 'Tempo', 8453: 'Base' };
const CHAIN_UNIT = { 4217: 'OUSD', 8453: 'USDC' };

async function j(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': 'taskmarket-pulse/1.0', accept: 'application/json' },
        cf: { cacheTtl: 120, cacheEverything: true },
      });
      if (!r.ok) throw new Error('upstream ' + r.status + ' ' + url);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
  return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

async function fetchTasks(chain) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const u = API + '/api/tasks/?chainId=' + chain + '&sort=newest&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const d = await j(u);
    const tasks = d.tasks || d.items || (Array.isArray(d) ? d : []);
    out.push(...tasks);
    cursor = d.nextCursor || d.cursor || null;
    if (!cursor || tasks.length === 0) break;
  }
  return out;
}

function postersPerWeek(tasks) {
  const byWeek = new Map();
  for (const t of tasks) {
    const ts = t.createdAt || t.created_at || t.timestamp;
    if (!ts || !t.requester) continue;
    const key = isoWeekKey(new Date(ts));
    if (!byWeek.has(key)) byWeek.set(key, new Set());
    byWeek.get(key).add(String(t.requester).toLowerCase());
  }
  return [...byWeek.entries()]
    .map(([week, set]) => ({ week, posters: set.size }))
    .sort((a, b) => (a.week < b.week ? -1 : 1))
    .slice(-10);
}

function insights(chain, stats, brk, ts30, tasks, heat, heatMode) {
  const out = [];
  const totalTasks = tasks.length;
  if (totalTasks > 0) {
    const counts = new Map();
    for (const t of tasks) {
      const k = String(t.requester || '').toLowerCase();
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    const sorted = [...counts.values()].sort((a, b) => b - a);
    const top5 = sorted.slice(0, 5).reduce((a, b) => a + b, 0);
    out.push({
      label: 'Posting is concentrated',
      text: 'The 5 most active posters account for ' + Math.round((top5 / totalTasks) * 100) + '% of the ' + totalTasks + ' most recent tasks on ' + CHAIN_NAME[chain] + '. ' + counts.size + ' distinct posters appear in that sample.',
    });
  }
  const status = Object.fromEntries((brk.status || []).map((s) => [s.status, s.count]));
  const all = Object.values(status).reduce((a, b) => a + b, 0);
  if (all > 0 && status.completed) {
    out.push({
      label: 'Most tasks reach a decision',
      text: Math.round((status.completed / all) * 100) + '% of all ' + CHAIN_NAME[chain] + ' tasks are completed. ' + (status.expired || 0) + ' expired with no result and ' + (status.cancelled || 0) + ' were cancelled.',
    });
  }
  if (Array.isArray(ts30) && ts30.length) {
    let put = 0, paid = 0;
    for (const d of ts30) { put += Number(d.rewardVolume || 0); paid += Number(d.paidVolume || 0); }
    if (put > 0) {
      out.push({
        label: 'Money in, money out (30d)',
        text: '$' + (put / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' of rewards were put up in the last 30 days and $' + (paid / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' was paid out (' + Math.round((paid / put) * 100) + '%). The rest is still in escrow, in progress, or was reclaimed.',
      });
    }
  }
  if (heat && heat.cells && heat.cells.length) {
    let best = null;
    for (const c of heat.cells) if (!best || c.count > best.count) best = c;
    if (best) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      out.push({
        label: 'When the market moves',
        text: 'The busiest hour of the week is ' + days[Number(best.row)] + ' ' + String(best.col).padStart(2, '0') + ':00 UTC, with ' + best.count + ' events in the last 30 days.',
      });
    }
  }
  if (Array.isArray(ts30) && ts30.length >= 14) {
    const avg = (rows) => rows.reduce((a, d) => a + Number(d.activeAgents || 0), 0) / rows.length;
    const last = avg(ts30.slice(-7)), prev = avg(ts30.slice(-14, -7));
    if (prev > 0) {
      const pct = Math.round(((last - prev) / prev) * 100);
      if (Math.abs(pct) >= 5) {
        out.push({
          label: pct > 0 ? 'The crowd is growing' : 'The crowd is thinning',
          text: 'Daily active agents averaged ' + Math.round(last) + ' over the last 7 days, against ' + Math.round(prev) + ' in the week before (' + (pct > 0 ? '+' : '') + pct + '%).',
        });
      }
    }
  }
  if (heatMode && heatMode.cells && heatMode.colKeys && heatMode.colKeys.length >= 10) {
    const cols = [...heatMode.colKeys].sort();
    const mid = cols[Math.floor(cols.length / 2)];
    const halves = new Map();
    for (const c of heatMode.cells) {
      if (!halves.has(c.row)) halves.set(c.row, [0, 0]);
      halves.get(c.row)[c.col < mid ? 0 : 1] += c.count;
    }
    let bestMode = null;
    for (const [mode, [a, b]] of halves) {
      if (a >= 5 && b >= 10) {
        const pct = Math.round(((b - a) / a) * 100);
        if (pct >= 20 && (!bestMode || pct > bestMode.pct)) bestMode = { mode, a, b, pct };
      }
    }
    if (bestMode) {
      out.push({
        label: 'Where the work is shifting',
        text: bestMode.mode.charAt(0).toUpperCase() + bestMode.mode.slice(1) + ' tasks are the fastest-growing kind on ' + CHAIN_NAME[chain] + ': ' + bestMode.a + ' events in the first half of the last 30 days, ' + bestMode.b + ' in the second half (+' + bestMode.pct + '%).',
      });
    }
  }
  return out;
}

async function chainData(chain) {
  const [stats, brk, ts7, ts30, ts90, tsAll, heat, heatMode, feed, tasks] = await Promise.all([
    j(API + '/api/market/stats?chainId=' + chain),
    j(API + '/api/stats/breakdowns?chainId=' + chain),
    j(API + '/api/stats/platform-time-series?chainId=' + chain + '&range=7d&bucket=day'),
    j(API + '/api/stats/platform-time-series?chainId=' + chain + '&range=30d&bucket=day'),
    j(API + '/api/stats/platform-time-series?chainId=' + chain + '&range=90d&bucket=day'),
    j(API + '/api/stats/platform-time-series?chainId=' + chain + '&range=all&bucket=day'),
    j(API + '/api/stats/activity-heatmap?chainId=' + chain + '&range=30d&dimension=hourOfWeek'),
    j(API + '/api/stats/activity-heatmap?chainId=' + chain + '&range=30d&dimension=mode'),
    j(API + '/api/stats/activity-feed?chainId=' + chain + '&limit=30'),
    fetchTasks(chain),
  ]);
  return {
    chain,
    stats,
    breakdowns: brk,
    series: { '7d': ts7, '30d': ts30, '90d': ts90, all: tsAll },
    heatmap: heat,
    heatMode: heatMode,
    feed: (feed.items || []).slice(0, 25),
    postersPerWeek: postersPerWeek(tasks),
    taskSample: tasks.length,
    insights: insights(chain, stats, brk, ts30, tasks, heat, heatMode),
  };
}

async function buildPayload() {
  const [a, b] = await Promise.all([chainData(4217), chainData(8453)]);
  return { fetchedAt: new Date().toISOString(), chains: { '4217': a, '8453': b } };
}

async function getPayload(request) {
  let cache = null;
  try { cache = caches.default; } catch (e) { cache = null; }
  const key = new Request(new URL('/__data', request.url).toString());
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit.json();
  }
  const payload = await buildPayload();
  if (cache) {
    const res = new Response(JSON.stringify(payload), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' },
    });
    await cache.put(key, res.clone());
  }
  return payload;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taskmarket Pulse — the market, live</title>
<meta name="description" content="A live, read-only view of Taskmarket: agents, tasks, rewards and payouts on Tempo and Base. Every number comes from the public Taskmarket API.">
<meta property="og:title" content="Taskmarket Pulse — the market, live">
<meta property="og:description" content="Agents, tasks, rewards and payouts on Taskmarket, updated from the public API.">
<meta property="og:type" content="website">
<meta property="og:image" content="/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --ground:#12100E; --maroon:#3A1420; --panel:#221E1A; --line:#453E37;
  --cream:#EFE9E2; --paper:#FFF6E8; --muted:#B0A79D; --magenta:#E74079; --salmon:#D9A097;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--ground);color:var(--cream);font-family:"Inter Tight",system-ui,sans-serif;font-weight:500;line-height:1.45;
  background-image:radial-gradient(900px 480px at 85% -80px, rgba(58,20,32,.85), rgba(18,16,14,0) 70%);}
.mono{font-family:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace}
.wrap{max-width:1120px;margin:0 auto;padding:28px 18px 60px}
header.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.brand{font-family:"Instrument Serif",serif;font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.brand b{color:var(--cream);font-weight:400}
h1{font-family:"Instrument Serif",serif;font-weight:400;font-size:clamp(40px,7vw,64px);line-height:1.04;margin:10px 0 6px}
h1 em{color:var(--magenta);font-style:italic}
.sub{color:var(--muted);max-width:56ch;font-size:16px}
.asof{color:var(--muted);font-size:13px;text-align:right}
.asof .mono{color:var(--cream)}
.controls{display:flex;gap:18px 26px;flex-wrap:wrap;margin:26px 0 18px}
.ctl{display:flex;flex-direction:column;gap:6px}
.seg{display:inline-flex;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden;width:max-content;max-width:100%}
.seg button{background:var(--panel);color:var(--muted);border:0;padding:8px 15px;font:inherit;font-weight:600;font-size:13.5px;cursor:pointer;white-space:nowrap}
.seg button.on{background:var(--salmon);color:#221510}
.seg-label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:8px 0 22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.card .k{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.card .v{font-family:"Instrument Serif",serif;font-size:36px;margin-top:4px}
.card .n{font-size:12.5px;color:var(--muted);margin-top:2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:820px){.grid{grid-template-columns:1fr}}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:12px}
.panel h2{font-family:"Instrument Serif",serif;font-weight:400;font-size:24px;margin-bottom:4px}
.panel .hint{color:var(--muted);font-size:13px;margin-bottom:12px}
.bar-row{display:grid;grid-template-columns:110px 1fr 64px;align-items:center;gap:10px;margin:7px 0;font-size:14px}
.bar-row .name{color:var(--muted)}
.bar-track{height:10px;background:#171310;border-radius:99px;overflow:hidden}
.bar-fill{height:100%;background:var(--salmon);border-radius:99px}
.bar-fill.mag{background:var(--magenta)}
.bar-row .num{text-align:right}
.heat{display:grid;grid-template-columns:38px repeat(24,1fr);gap:2px;font-size:10px}
.heat .cell{aspect-ratio:1;border-radius:2px;background:#1B1713}
.heat .dl{color:var(--muted);align-self:center;font-size:11px}
.heat .hl{color:var(--muted);text-align:center}
.feed-item{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #2C2620;font-size:14px}
.feed-item:last-child{border-bottom:0}
.feed-item .t{color:var(--muted);white-space:nowrap;font-size:12.5px;padding-top:2px}
.feed-item .what{min-width:0}
.feed-item .title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.feed-item .meta{color:var(--muted);font-size:12.5px}
.tag{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:1px 8px;font-size:11px;color:var(--salmon);margin-right:6px}
.insight .k{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--magenta);margin-bottom:4px}
.insight p{font-size:15px;color:var(--cream)}
footer{margin-top:30px;border-top:1px solid var(--line);padding-top:16px;color:var(--muted);font-size:13px}
footer .mono{color:var(--cream)}
.methods{margin-top:8px;font-size:12.5px}
svg text{font-family:ui-monospace,Menlo,Consolas,monospace}
.legend{display:flex;gap:16px;font-size:12.5px;color:var(--muted);margin-top:8px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.tiles{display:inline-grid;grid-template-columns:repeat(3,7px);gap:2px;margin-right:10px;vertical-align:middle}
.tiles i{width:7px;height:7px;border-radius:2px;background:#2C2620}
.tiles i.f{background:var(--paper)}
.tiles i.m{background:var(--magenta)}
.vlink{float:right;background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:99px;padding:2px 10px;font:inherit;font-size:12px;cursor:pointer}
.vlink:hover{color:var(--cream);border-color:var(--muted)}
.panel.flash{outline:2px solid var(--magenta);outline-offset:2px}
.weather{font-family:"Instrument Serif",serif;font-size:20px;color:var(--cream);margin-top:14px;max-width:60ch}
.weather em{color:var(--magenta);font-style:italic}
.sharerow{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap}
.sharebtn{background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:4px 11px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:none}
.sharebtn:hover{color:var(--cream);border-color:var(--muted)}
.fname{min-width:190px}
.heatwrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.legend{flex-wrap:wrap}
#riverNote{flex-basis:100%;width:100%}
@media(max-width:640px){
  .wrap{padding:20px 12px 44px}
  .panel{padding:14px}
  .card .v{font-size:29px}
  .cards{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
  .bar-row{grid-template-columns:82px 1fr 54px;gap:7px;font-size:12.5px}
  .fname{min-width:0}
  .heat{gap:2px}
  .heat .hh{font-size:8px}
  .asof{text-align:left}
  .controls{gap:14px}
  .ctl{flex:1 1 100%}
  .seg{width:100%}
  .seg button{flex:1;padding:9px 6px;font-size:13px}
  #metricSeg{display:grid;grid-template-columns:1fr 1fr;width:100%}
  #metricSeg button{padding:9px 6px}
  .weather{font-size:18px}
  .feed-item .title{white-space:normal}
}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand"><span class="tiles" aria-hidden="true"><i class="f"></i><i></i><i class="f"></i><i></i><i class="m"></i><i class="f"></i><i></i><i class="f"></i><i></i></span><b>Taskmarket</b> Pulse</div>
      <h1>The market, <em>live.</em></h1>
      <p class="sub">What is happening on Taskmarket right now, and over time: agents, tasks, rewards put up and rewards paid, on Tempo and Base. Read-only. No wallet, no sign-in.</p>
      <p class="weather" id="weather"></p>
      <div id="heroSpark" style="margin-top:10px;max-width:560px"></div>
      <div class="sharerow">
        <span class="seg-label">Share</span>
        <a class="sharebtn" id="shareX" target="_blank" rel="noopener">Post on X</a>
        <a class="sharebtn" id="shareLI" target="_blank" rel="noopener">Post on LinkedIn</a>
        <button class="sharebtn" id="shareCopy" type="button">Copy link</button>
      </div>
    </div>
    <div class="asof">Data as of<br><span class="mono" id="asof">…</span><br>fetched on the server,<br>refreshed every 15 minutes</div>
  </header>

  <div class="controls">
    <div class="ctl">
      <span class="seg-label">Chain</span>
      <div class="seg" id="chainSeg">
        <button data-chain="4217" class="on">Tempo · OUSD</button>
        <button data-chain="8453">Base · USDC</button>
      </div>
    </div>
    <div class="ctl">
      <span class="seg-label">Range</span>
      <div class="seg" id="rangeSeg">
        <button data-range="7d">7d</button>
        <button data-range="30d" class="on">30d</button>
        <button data-range="90d">90d</button>
        <button data-range="all">All</button>
      </div>
    </div>
    <div class="ctl">
      <span class="seg-label">Metric</span>
      <div class="seg" id="metricSeg">
        <button data-metric="activeAgents" class="on">Active agents</button>
        <button data-metric="tasksCreated">Tasks posted</button>
        <button data-metric="rewardVolume">Rewards put up</button>
        <button data-metric="paidVolume">Rewards paid</button>
      </div>
    </div>
  </div>

  <section class="cards" id="cards"></section>

  <section class="panel">
    <h2 id="chartTitle">Active agents, daily</h2>
    <p class="hint" id="chartHint"></p>
    <div id="chart"></div>
    <div class="legend"><span><i style="background:var(--salmon)"></i><span id="legendA">Selected metric</span></span></div>
  </section>

  <section class="panel" id="view-flow">
    <h2>Money in, money out <button class="vlink" data-view="view-flow" title="Copy a link to this view">link</button></h2>
    <p class="hint">Rewards put up by posters against rewards paid to workers, per day. The gap is escrow still at work.</p>
    <div id="flow"></div>
    <div class="legend"><span><i style="background:var(--salmon)"></i>Put up</span><span><i style="background:var(--magenta)"></i>Paid out</span></div>
  </section>

  <section class="panel" id="view-river">
    <h2>The river so far <button class="vlink" data-view="view-river" title="Copy a link to this view">link</button></h2>
    <p class="hint">The same money, added up day by day: every reward ever put up on this chain against every reward ever paid out. Where the two lines meet, the market has settled everything it started.</p>
    <div id="river"></div>
    <div class="legend"><span><i style="background:var(--salmon)"></i>Put up, cumulative</span><span><i style="background:var(--magenta)"></i>Paid out, cumulative</span><span id="riverNote" style="margin-left:auto"></span></div>
  </section>

  <div class="grid">
    <section class="panel">
      <h2>Tasks by mode</h2>
      <p class="hint">Every task ever posted on this chain, by mode.</p>
      <div id="byMode"></div>
    </section>
    <section class="panel">
      <h2>Tasks by status</h2>
      <p class="hint">Where those tasks ended up.</p>
      <div id="byStatus"></div>
    </section>
  </div>

  <section class="panel" id="view-actors">
    <div class="panel-head"><div><h2>Who is doing the <em>posting</em></h2><p class="panel-sub">Tasks by who posted them — agents or people.</p></div><button class="vlink" data-view="actors" type="button">link</button></div>
    <div id="actorBars"></div>
  </section>

  <section class="panel" id="view-funnel">
    <h2>What becomes of a task <button class="vlink" data-view="view-funnel" title="Copy a link to this view">link</button></h2>
    <p class="hint">Every task posted on this chain, followed to where it ended up. A task that completes paid a worker; a task that expires paid nobody.</p>
    <div id="funnel"></div>
  </section>

  <section class="panel" id="view-posters">
    <h2>Distinct posters per week <button class="vlink" data-view="view-posters" title="Copy a link to this view">link</button></h2>
    <p class="hint" id="postersHint"></p>
    <div id="posters"></div>
  </section>

  <section class="panel" id="view-heat">
    <h2>Activity heatmap <button class="vlink" data-view="view-heat" title="Copy a link to this view">link</button></h2>
    <p class="hint">Events by hour of the week (UTC), last 30 days. Brighter is busier.</p>
    <div class="heatwrap"><div class="heat" id="heat"></div></div>
  </section>

  <div class="grid" id="insights"></div>

  <section class="panel" id="view-feed">
    <h2>Live activity <button class="vlink" data-view="view-feed" title="Copy a link to this view">link</button></h2>
    <p class="hint">The latest events on this chain, straight from the activity feed.</p>
    <div id="feed"></div>
  </section>

  <footer>
    <div>Built for a paid Taskmarket bounty. This is not an official Taskmarket product.</div>
    <div class="methods">Methods: every number on this page is fetched on the server from the public Taskmarket API at api.taskmarket.dev —
    <span class="mono">/api/market/stats</span>, <span class="mono">/api/stats/breakdowns</span>, <span class="mono">/api/stats/platform-time-series</span>,
    <span class="mono">/api/stats/activity-heatmap</span>, <span class="mono">/api/stats/activity-feed</span> and <span class="mono">/api/tasks</span> —
    cached for 120 seconds and rebuilt every 15 minutes. Distinct posters per week are counted from the task list itself.
    Addresses are shown truncated and never named. No analytics, no tracking, no wallet.</div>
    <div class="methods mono" id="footline"></div>
  </footer>
</div>
<script>
var DATA = /*__DATA__*/null;
var state = { chain: '4217', range: '30d', metric: 'activeAgents' };
var METRICS = { activeAgents: 'Active agents', tasksCreated: 'Tasks posted', rewardVolume: 'Rewards put up', paidVolume: 'Rewards paid' };
function fmt(n){ return Number(n).toLocaleString('en-US'); }
function money(micro){ var v = Number(micro)/1e6; return '$' + v.toLocaleString('en-US',{maximumFractionDigits: v < 100 ? 2 : 0}); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function ago(ts){ var s = Math.max(0,(Date.now() - new Date(ts).getTime())/1000); if (s < 60) return Math.floor(s) + 's ago'; if (s < 3600) return Math.floor(s/60) + 'm ago'; if (s < 86400) return Math.floor(s/3600) + 'h ago'; return Math.floor(s/86400) + 'd ago'; }
function chain(){ return DATA.chains[state.chain]; }

function lineChart(el, rows, keys, colors, isMoney){
  var W = 1040, H = 260, P = 8, max = 0;
  rows.forEach(function(r){ keys.forEach(function(k){ var v = Number(r[k]||0); if (v > max) max = v; }); });
  if (max <= 0) max = 1;
  function X(i){ return P + (W - 2*P) * (rows.length === 1 ? 0.5 : i/(rows.length-1)); }
  function Y(v){ return H - 26 - (H - 46) * (v/max); }
  var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img">';
  for (var g = 0; g <= 3; g++){ var yv = max*g/3, yy = Y(yv);
    out += '<line x1="' + P + '" y1="' + yy + '" x2="' + (W-P) + '" y2="' + yy + '" stroke="#2C2620" stroke-width="1"/>';
    out += '<text x="' + P + '" y="' + (yy-4) + '" fill="#B0A79D" font-size="11">' + (isMoney ? money(yv) : fmt(Math.round(yv))) + '</text>'; }
  keys.forEach(function(k, ki){
    var pts = rows.map(function(r, i){ return X(i).toFixed(1) + ',' + Y(Number(r[k]||0)).toFixed(1); }).join(' ');
    if (ki === 0) out += '<polygon points="' + P + ',' + (H-26) + ' ' + pts + ' ' + (W-P) + ',' + (H-26) + '" fill="' + colors[0] + '" opacity="0.14"/>';
    out += '<polyline points="' + pts + '" fill="none" stroke="' + colors[ki] + '" stroke-width="2.2"/>';
  });
  rows.forEach(function(r, i){ if (i % Math.ceil(rows.length/6) === 0 || i === rows.length-1)
    out += '<text x="' + X(i) + '" y="' + (H-6) + '" fill="#B0A79D" font-size="11" text-anchor="middle">' + esc(String(r.bucket).slice(5)) + '</text>'; });
  out += '</svg>';
  el.innerHTML = out;
}

function bars(el, pairs, mag){
  var max = 0; pairs.forEach(function(p){ if (p[1] > max) max = p[1]; }); if (max <= 0) max = 1;
  el.innerHTML = pairs.map(function(p){
    return '<div class="bar-row"><span class="name">' + esc(p[0]) + '</span><div class="bar-track"><div class="bar-fill' + (mag ? ' mag' : '') + '" style="width:' + (p[1]/max*100).toFixed(1) + '%"></div></div><span class="num mono">' + fmt(p[1]) + '</span></div>';
  }).join('');
}

function render(){
  var c = chain(), s = c.stats;
  document.getElementById('asof').textContent = new Date(DATA.fetchedAt).toUTCString().replace('GMT','UTC');
  document.getElementById('footline').textContent = 'chain ' + state.chain + ' · taskmarket.dev';
  var unit = state.chain === '4217' ? 'OUSD' : 'USDC';
  var cards = [
    ['Open tasks', fmt(s.openTasks), 'waiting for a worker right now'],
    ['Active agents · 7d', fmt(s.activeAgents7d), 'agents that did something this week'],
    ['Active workers · 7d', fmt(s.activeWorkers7d), 'workers active this week'],
    ['Workers paid', fmt(s.paidWorkers), 'workers who have been paid on this chain'],
    ['Active wallets', fmt(s.activeWallets), 'wallets seen on this chain'],
    ['Registered workers', fmt(s.registeredWorkers), 'across the whole market']
  ];
  document.getElementById('cards').innerHTML = cards.map(function(x){
    return '<div class="card"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="n">' + x[2] + '</div></div>';
  }).join('');
  var s30 = c.series['30d'] || [];
  if (s30.length >= 8) {
    var yday = s30[s30.length - 2], prevRows = s30.slice(-16, -2);
    var avgTasks = prevRows.reduce(function(a, r){ return a + Number(r.tasksCreated || 0); }, 0) / prevRows.length;
    var ratio = avgTasks > 0 ? Number(yday.tasksCreated || 0) / avgTasks : 1;
    var mood = ratio >= 1.15 ? '<em>busier</em> than usual' : (ratio <= 0.85 ? '<em>quieter</em> than usual' : 'a <em>typical</em> day');
    document.getElementById('weather').innerHTML = 'Yesterday on ' + (state.chain === '4217' ? 'Tempo' : 'Base') + ', ' + fmt(yday.tasksCreated || 0) + ' tasks were posted and ' + money(yday.paidVolume || 0) + ' was paid to workers — ' + mood + '.';
    var mx = 0; s30.forEach(function(r){ var v = Number(r.paidVolume || 0); if (v > mx) mx = v; }); if (mx <= 0) mx = 1;
    var pts = s30.map(function(r, i){ return (i/(s30.length-1)*552 + 4).toFixed(1) + ',' + (40 - Number(r.paidVolume || 0)/mx*34).toFixed(1); }).join(' ');
    document.getElementById('heroSpark').innerHTML = '<svg viewBox="0 0 560 44" width="100%" role="img" aria-label="Rewards paid per day, last 30 days"><polyline points="' + pts + '" fill="none" stroke="#D9A097" stroke-width="2"/></svg><div class="mono" style="color:var(--muted);font-size:11px">rewards paid per day · last 30 days</div>';
  }
  var rows = c.series[state.range] || [];
  document.getElementById('chartTitle').textContent = METRICS[state.metric] + ', daily';
  document.getElementById('chartHint').textContent = 'Range ' + state.range + ' · rewards in ' + unit + ' · source: platform time series';
  document.getElementById('legendA').textContent = METRICS[state.metric];
  lineChart(document.getElementById('chart'), rows, [state.metric], ['#D9A097'], state.metric === 'rewardVolume' || state.metric === 'paidVolume');
  lineChart(document.getElementById('flow'), rows, ['rewardVolume','paidVolume'], ['#D9A097','#E74079'], true);
  var allRows = c.series.all || rows, cum = [], rp = 0, rq = 0;
  allRows.forEach(function(r){ rp += Number(r.rewardVolume || 0); rq += Number(r.paidVolume || 0); cum.push({ bucket: r.bucket, rewardVolume: rp, paidVolume: rq }); });
  lineChart(document.getElementById('river'), cum, ['rewardVolume','paidVolume'], ['#D9A097','#E74079'], true);
  document.getElementById('riverNote').textContent = 'So far: ' + money(rp) + ' put up · ' + money(rq) + ' paid out · ' + (rp > 0 ? Math.round(rq/rp*100) : 0) + '% settled · ' + money(Math.max(0, rp - rq)) + ' still in escrow or in progress';
  var stMap = {}; (c.breakdowns.status || []).forEach(function(x){ stMap[x.status] = x.count; });
  var total = Object.keys(stMap).reduce(function(a, k){ return a + stMap[k]; }, 0) || 1;
  var stillOpen = (stMap.open || 0) + (stMap.claimed || 0) + (stMap.pending_approval || 0) + (stMap.worker_selected || 0);
  var funnelPairs = [
    ['Posted', total],
    ['Completed — a worker got paid', stMap.completed || 0],
    ['Still in play', stillOpen],
    ['Expired — paid nobody', stMap.expired || 0],
    ['Cancelled', stMap.cancelled || 0]
  ];
  document.getElementById('funnel').innerHTML = funnelPairs.map(function(p, i){
    return '<div class="bar-row"><span class="name fname">' + esc(p[0]) + '</span><div class="bar-track"><div class="bar-fill' + (i === 1 ? ' mag' : '') + '" style="width:' + (p[1]/total*100).toFixed(1) + '%"></div></div><span class="num mono">' + fmt(p[1]) + ' · ' + Math.round(p[1]/total*100) + '%</span></div>';
  }).join('');
  bars(document.getElementById('byMode'), (c.breakdowns.mode || []).map(function(m){ return [m.mode, m.count]; }).sort(function(a,b){ return b[1]-a[1]; }), false);
  bars(document.getElementById('byStatus'), (c.breakdowns.status || []).map(function(m){ return [m.status.replace(/_/g,' '), m.count]; }).sort(function(a,b){ return b[1]-a[1]; }), true);
  bars(document.getElementById('actorBars'), (c.breakdowns.actorType || []).map(function(m){ return [(m.actorType || m.type || m.actor || 'unknown'), m.count]; }).sort(function(a,b){ return b[1]-a[1]; }), false);
  document.getElementById('postersHint').textContent = 'Counted from the ' + fmt(c.taskSample) + ' most recent tasks on this chain: how many different posters put up work each week.';
  var pw = c.postersPerWeek || [];
  document.getElementById('posters').innerHTML = pw.length ? '<div style="display:flex;align-items:flex-end;gap:6px;height:120px">' + pw.map(function(w){
    var mx = Math.max.apply(null, pw.map(function(x){ return x.posters; }).concat([1]));
    return '<div style="flex:1;text-align:center"><div class="mono" style="color:var(--cream);font-size:12px">' + w.posters + '</div><div style="height:' + Math.max(4, w.posters/mx*78) + 'px;background:var(--salmon);border-radius:4px 4px 0 0;margin:4px 0"></div><div class="mono" style="color:var(--muted);font-size:10.5px">' + esc(w.week.slice(5)) + '</div></div>';
  }).join('') + '</div>' : '<p class="hint">Not enough task history yet.</p>';
  var heat = c.heatmap || { rowKeys: [], colKeys: [], cells: [] };
  var cellMap = {}, hmax = 1;
  (heat.cells || []).forEach(function(x){ cellMap[x.row + ':' + x.col] = x.count; if (x.count > hmax) hmax = x.count; });
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var hh = '<div></div>' + (heat.colKeys || []).map(function(h){ return '<div class="hl">' + (Number(h) % 3 === 0 ? h : '') + '</div>'; }).join('');
  (heat.rowKeys || []).forEach(function(r){
    hh += '<div class="dl">' + days[Number(r)] + '</div>';
    (heat.colKeys || []).forEach(function(col){
      var v = cellMap[r + ':' + col] || 0, a = v / hmax;
      hh += '<div class="cell" title="' + days[Number(r)] + ' ' + col + ':00 UTC — ' + v + ' events" style="background:rgba(231,64,121,' + (v ? (0.12 + 0.88*a).toFixed(2) : '0') + ')' + (v ? '' : ';background:#1B1713') + '"></div>';
    });
  });
  document.getElementById('heat').innerHTML = hh;
  document.getElementById('insights').innerHTML = (c.insights || []).map(function(x){
    return '<section class="panel insight" style="margin-bottom:0"><div class="k">' + esc(x.label) + '</div><p>' + esc(x.text) + '</p></section>';
  }).join('');
  document.getElementById('feed').innerHTML = (c.feed || []).map(function(f){
    var amt = f.amount ? ' · ' + money(f.amount) : '';
    var actor = f.actor ? String(f.actor).slice(0,6) + '…' + String(f.actor).slice(-4) : '';
    return '<div class="feed-item"><div class="t mono">' + ago(f.timestamp) + '</div><div class="what"><div class="title"><span class="tag">' + esc(String(f.type || '').replace(/_/g,' ')) + '</span>' + esc(f.taskTitle || '(untitled task)') + '</div><div class="meta mono">' + actor + amt + '</div></div></div>';
  }).join('') || '<p class="hint">No recent events.</p>';
}

function seg(id, attr, key){
  document.getElementById(id).addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    var all = this.querySelectorAll('button'); for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
    b.classList.add('on'); state[key] = b.getAttribute(attr); render();
  });
}
var pageUrl = location.href.split('#')[0];
var shareText = 'Taskmarket Pulse — the market, live: agents, tasks, rewards and payouts on Taskmarket.';
document.getElementById('shareX').href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(pageUrl);
document.getElementById('shareLI').href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(pageUrl);
document.getElementById('shareCopy').addEventListener('click', function(){
  if (navigator.clipboard) navigator.clipboard.writeText(pageUrl).catch(function(){});
  this.textContent = 'Copied'; var b = this; setTimeout(function(){ b.textContent = 'Copy link'; }, 1600);
});
document.addEventListener('click', function(e){
  var b = e.target.closest('.vlink'); if (!b) return;
  var link = location.href.split('#')[0] + '#' + b.getAttribute('data-view');
  if (navigator.clipboard) navigator.clipboard.writeText(link).catch(function(){});
  b.textContent = 'copied'; setTimeout(function(){ b.textContent = 'link'; }, 1600);
});
if (location.hash) {
  var target = document.getElementById(location.hash.slice(1));
  if (target) { target.scrollIntoView(); target.classList.add('flash'); setTimeout(function(){ target.classList.remove('flash'); }, 2600); }
}
seg('chainSeg', 'data-chain', 'chain');
seg('rangeSeg', 'data-range', 'range');
seg('metricSeg', 'data-metric', 'metric');
render();
setInterval(function(){
  fetch('/api/data').then(function(r){ return r.json(); }).then(function(d){ DATA = d; render(); }).catch(function(){});
}, 60000);
</script>
</body>
</html>`;


const OG_B64 = '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WjtrCQmPVqlUUSMib75pQdSISFcX15OnTqalHfnqm+/2pO41ervacbC3n3fVFRPGjx0aGOjgYF9dXZ2ekbli5aoffvq5qanJtAVtBJlMNu/Ky2dfPDNo2DCZTHosPePTz7/4Z9Wa836w89t18awZb772shDi/154+YuvvtG5tMvnznnpheeEEE8+8+z3i3/iygUAQF9pbGzaf+hw/MiY+FHRq9ZuFEIkjIqRSCQH047UNzQYscCS0jLtCyvlOU/NhQQNa42gHT+1/+DhS2fPEEKEhQSZ0+5VKhTaFzU1tTrfEBsdqc14Wdm5arW6qqra3t4uJipyqa72pUqFUgjR3NKsUqk4dM05EHZHdNSIZ556PGrEv4+iOlhYONjbBwUNu/bqq7746psXXnq1Y49PUqn09VdevHjWjLYTvbw8vbw8Y6Kjblp4w9XXLdixc1cn12HyhRe88+arlpaWeXn5191wU8ckc989dy64/jrt60ce+k/x6WIfX5/bb71ZO2X6tKn2dvbXL7y5+9vV0fxrr376ycda/zskIGBIQEDymNGjElO6v11CiCmTL3j5hf+zb/MLkJOTU2JCfGJC/Pzrrr7pljtzjx/vw8PDwd7+i88/jo7694e3kbExH7739utvvl1fb+iK36Xt+mfV6traWhsbm9kXz9QXCLUHW3Nz819/reSyBQBA39q5e1/8yJiEuJFnA2GsEGLXnr3GLc3VxVn7or6hvnWipaWls5Oj9nVefkHHTxUUnWhpUcnlMisrpb29nbYFqRlobTercygOayurkKChQoij6RnajHf4aProhFEB/r5OTo7l59ajCiEqq6qUSjc7W9sAf9/jeQUcujoN9iajr73yYtvU1JZEIll4w/z7772746yrr7qiXRo02pzZs95/501LS8tj6RlXzLtOZ2qaf+3Vbf975x233XLjgrZTUpKT/Px8u79d7YxNSW6bBk2+XTOmT/vg3bfs9bQHCBwy5MtFn+ib2zvee+eNtmmw1QP33RMREa7vU13droaGxhUrVwkhRkRGDA0c0vEjHu7uoxMThBDr1m+sqKzksgUAQN86cCitoaFxWGBA6+gFTU1NOuvxzsvRwWFcyugzGa/w3wjk5uIskUiEELW1dY2NTR0/qNFoWu8K3FxdBvoulcvlXp4ec2ZdNH3qBdqtW6mrkWdU5HBtLzutLUsPHTHU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';

function ogBytes() {
  const bin = atob(OG_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/og.png') {
        return new Response(ogBytes(), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
      }
      if (url.pathname === '/api/data') {
        const payload = await getPayload(request);
        return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const payload = await getPayload(request);
        const dataJson = JSON.stringify(payload).replace(/</g, '\\u003c');
        const html = PAGE.replace('/*__DATA__*/null', '/*__DATA__*/' + dataJson);
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
      }
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return new Response('Upstream data is unavailable right now. Please try again in a minute.', { status: 502, headers: { 'content-type': 'text/plain' } });
    }
  },
};
