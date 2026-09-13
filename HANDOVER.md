# Handover Brief — SPY Gamma Exposure Dashboard

Purpose of this file: give any AI coding assistant (Codex, Gemini, Claude, Copilot,
etc.) — or a future version of yourself — everything needed to understand, run,
debug, and extend this project without re-deriving it from scratch. Paste this
whole file, or point the assistant at it, at the start of a new session.

## What this project is

A single-page web dashboard that tracks **SPY (S&P 500 ETF) dealer gamma
exposure** — a options-market-structure metric used to gauge where market makers'
hedging flows are likely to create support/resistance. It shows:

- **Call wall** — strike with the largest positive call gamma exposure (acts like
  resistance / a magnet dealers hedge against).
- **Put wall** — strike with the largest negative put gamma exposure (acts like
  support).
- **Max pain** — the strike where option holders in aggregate lose the most money
  at expiration (a classic, separate metric from GEX, included because traders
  commonly view it alongside gamma walls).
- **Gamma flip point** — the spot price where aggregate dealer gamma exposure
  crosses from negative to positive (or vice versa). Below it, dealers are in a
  "short gamma" regime that tends to amplify moves; above it, they're "long gamma"
  and tend to dampen moves.
- A **daily tracker** that logs how these four levels shift day over day.

**Repo:** [https://github.com/zipcode70/JW-dashboard1](https://github.com/zipcode70/JW-dashboard1)
**Live site:** `https://zipcode70.github.io/JW-dashboard1/` (published via GitHub Pages)

## Project structure

```
gex_dashboard/
├── .github/workflows/daily-gex-update.yml   ← automation (see below)
├── requirements.txt                          ← Python deps for the automation
├── scripts/
│   └── compute_gex.py                        ← the entire data pipeline
├── site/                                     ← static site, this is what Pages serves
│   ├── index.html
│   ├── styles.css
│   ├── app.js                                ← Chart.js rendering logic
│   └── data/
│       ├── gex_data.json                     ← latest full snapshot (overwritten daily)
│       └── history.json                      ← append-only log, one row per trading day
└── README.md                                 ← setup/hosting instructions (human-facing)
```

## Data pipeline (`scripts/compute_gex.py`)

Run with: `pip install -r requirements.txt && python3 scripts/compute_gex.py`
(from the repo root). No API keys required.

1. **Data source:** `yfinance` (unofficial, free wrapper around Yahoo Finance).
   `yf.Ticker("SPY").option_chain(expiration)` pulls the live options chain. On a
   non-trading day/time this reflects the most recent session's settled open
   interest, which is what we want for "today's close" style figures.
   - There is no official/paid options-data connector wired into this project.
     If `yfinance` ever breaks (Yahoo changes their endpoint) or a "no data"
     error, that's the first thing to check — see Known Issues below.
2. **Strike range:** hardcoded `STRIKE_LOW = 700`, `STRIKE_HIGH = 850` at the top
   of the file. Change these two constants to widen/narrow the analysis window.
3. **Expirations included:** every SPY expiration within 100 days of the as-of
   date (`fetch_chain(..., max_days_out=100)`).
4. **Gamma model:** standard Black-Scholes gamma (`bs_gamma`), using each
   contract's own `impliedVolatility` from the chain and a risk-free rate fetched
   live each run via `get_risk_free_rate()` (`yf.Ticker("^IRX")`, the 13-week
   T-bill yield, converted from percentage points to a decimal). If that fetch
   fails or returns an implausible value (sanity-checked to be between 0% and
   20%), it falls back to the hardcoded `RISK_FREE_RATE_FALLBACK = 0.039`. The
   snapshot JSON records which path was used each day via `risk_free_rate` and
   `risk_free_rate_source` (`"live"` or `"fallback"`).
5. **GEX formula per contract:**
   `gamma * openInterest * 100 (contract size) * spot^2 * 0.01`, sign
   **positive for calls, negative for puts** (this is the standard dealer-short
   convention: dealers are assumed short calls/long puts vs. customers, though in
   reality this varies by market and isn't verifiable from public OI data alone —
   flag this simplifying assumption if asked to validate against a paid GEX
   source).
6. **Call wall / put wall:** strike with max call GEX / min (most negative) put
   GEX, summed across all included expirations.
7. **Max pain:** classic aggregate-OI formula — for each candidate strike,
   sum `(S − K) × callOI` over in-the-money calls plus `(K − S) × putOI` over
   in-the-money puts, minimized over S.
8. **Gamma flip:** recomputes total dealer GEX across a **hypothetical spot grid**
   from `STRIKE_LOW` to `STRIKE_HIGH` in $1 steps (holding OI/IV fixed, varying
   only the spot plugged into gamma and the `spot^2` scaling term), then finds the
   zero-crossing via linear interpolation between the two adjacent grid points.
9. **Outputs:**
   - `site/data/gex_data.json` — full snapshot: spot, walls, max pain, flip,
     regime ("positive"/"negative" gamma), total net GEX, per-strike call/put
     GEX and OI, and the full flip curve (for the "flip chart").
   - `site/data/history.json` — one row appended per unique `as_of_date`
     (dedup by date, so re-running the script same-day just overwrites that
     day's row instead of duplicating it — check the tail of the file for the
     exact append/dedup logic if modifying this).

## Frontend (`site/`)

- Plain HTML/CSS/JS, no build step, no framework — just open `index.html` or serve
  the folder statically.
- Charting via **Chart.js 4.4.4** + **chartjs-plugin-annotation 3.0.1**, both
  loaded from CDN `<script>` tags in `index.html` (check there for exact URLs/pins
  before upgrading versions).
- `app.js` (~324 lines) fetches the two JSON files and renders:
  1. KPI cards (spot, call wall, put wall, max pain, flip, regime)
  2. Main GEX-by-strike bar chart with annotation lines for call wall / put wall /
     max pain / gamma flip / current spot
  3. Gamma flip curve chart (total GEX vs. hypothetical spot)
  4. Call/put open interest by strike
  5. Daily tracker line chart + table, sourced from `history.json`
- Dark finance-dashboard visual theme; styles in `styles.css`.
- No backend/server — it's 100% static, which is why GitHub Pages is a good fit.

## Automation (`.github/workflows/daily-gex-update.yml`)

Two jobs:
1. **`update-data`** — checks out repo, installs `requirements.txt`, runs
   `compute_gex.py`, commits the two changed JSON files back to `main` if (and
   only if) they actually changed (skips cleanly on market holidays / no new
   data). Sets an `updated` output flag.
2. **`deploy-pages`** — only runs if job 1's `updated` flag is true. Uploads
   `site/` via `actions/upload-pages-artifact` and publishes it via
   `actions/deploy-pages`.

Triggers: `cron: "45 20 * * 1-5"` (20:45 UTC = 4:45pm ET during EDT/daylight
time) plus `workflow_dispatch` for manual runs from the Actions tab.

**Repo settings this depends on** (already configured, but note if migrating to
a new repo):
- Settings → Actions → General → Workflow permissions → **Read and write
  permissions** (needed for the `git push` step).
- Settings → Pages → Source → **GitHub Actions** (not "Deploy from a branch").

## Known issues / gotchas for whoever picks this up

1. **DST drift:** the cron is pinned to `20:45 UTC`. That's 4:45pm ET only while
   the US observes daylight time (EDT, roughly March–November). During standard
   time (EST) it fires an hour earlier, at 3:45pm ET. There's a comment in the
   YAML noting the one-character fix (`20`→`21`) — nobody has automated this yet.
   A real fix would compute the offset dynamically or run twice with an in-script
   time gate.
2. **`yfinance` is unofficial** and occasionally gets rate-limited/blocked when
   called from shared cloud IPs (GitHub Actions runners included). If a run fails
   with a network/HTTP error rather than a Python traceback, this is almost
   certainly why — it's usually transient and resolves on the next scheduled run.
   If it becomes chronic, the fix is switching to a paid provider (Polygon.io,
   Tradier, CBOE DataShop) — would require rewriting `fetch_chain()` and
   `get_spot_and_asof()` in `compute_gex.py`, nothing else.
3. **Risk-free rate** is fetched live each run (see pipeline step 4 above), with
   an automatic fallback to a hardcoded constant if the fetch fails — check
   `gex_data.json`'s `risk_free_rate_source` field to see which path was used on
   any given day.
4. **Dealer positioning sign convention is an assumption**, not derived from any
   verified dealer-flow data — see pipeline step 5. This is standard practice in
   retail GEX tools but should be caveated if the user asks how "accurate" it is
   against paid institutional GEX feeds.
5. **No automated tests.** Correctness was checked with manual spot-checks
   against the underlying option chain data during development, not with a test
   suite. Adding unit tests around `bs_gamma`, `compute_metrics`, and the max-pain
   /flip-point logic would be a reasonable improvement.
6. **History file has no size cap.** `history.json` will grow by one row per
   trading day indefinitely. Fine for a long time, but worth capping/rotating
   eventually (e.g. keep trailing 252 trading days).

## Natural next enhancements (if asked "what should we add")

- Configurable strike range / underlying ticker (currently SPY-only, hardcoded)
- Second underlying support (QQQ, SPX) — would need a parametrized version of
  the whole pipeline rather than hardcoded `SPY`/`700`/`850`
- Alerting (e.g. notify when the flip point crosses spot, or when a wall moves
  by more than X strikes day-over-day)
- Automated DST-aware cron scheduling
- Historical backtest view: overlay realized SPY price against the day's
  call/put walls to visually check how well they "held"

## How to test a change before it goes live automatically

Push/commit the change (edit directly on GitHub or locally + push), then go to
the repo's **Actions** tab → **"Daily SPY Gamma Exposure Update"** → **Run
workflow** to trigger it immediately instead of waiting for the next scheduled
run.
