# SPY Gamma Exposure Dashboard — Run It Yourself

This is a self-contained project: one Python script that pulls SPY options
data and computes dealer gamma exposure, and one static website (HTML/CSS/JS)
that visualizes it. No paid service or special platform required.

## 1. Requirements

- Python 3.9+
- A free code editor / terminal (VS Code, or just Terminal on Mac)

Install dependencies:

```bash
pip install yfinance scipy pandas numpy
```

## 2. Folder layout

```
gex_dashboard/
  scripts/
    compute_gex.py     <- fetches data + computes gamma exposure
  site/
    index.html         <- the dashboard page
    styles.css
    app.js
    data/
      gex_data.json     <- current snapshot (regenerated daily)
      history.json       <- daily tracker log (append-only)
```

## 3. How the math works (in case you want to modify it)

- **Data source**: `yfinance`'s `Ticker("SPY").option_chain(expiration)` returns
  live open interest and implied volatility per strike/expiration. On a
  non-trading day this reflects the most recent close, since no trades
  occurred over the weekend — that's how the Sept 11 snapshot was captured
  on Sept 13.
- **Dealer gamma exposure (GEX) per strike**:
  `GEX = BlackScholesGamma(spot, strike, T, r, iv) * openInterest * 100 * spot^2 * 0.01`,
  with **calls contributing positive** exposure and **puts contributing
  negative** exposure (the standard dealer-positioning convention used by
  most public GEX trackers).
- **Call wall / put wall**: the strikes with the single largest positive
  call-GEX and largest negative put-GEX, respectively.
- **Max pain**: for each candidate strike, sum `(S-K)*callOI` for all ITM
  calls plus `(K-S)*putOI` for all ITM puts; the strike that minimizes this
  total payout is max pain.
- **Gamma flip**: recompute total GEX at a range of *hypothetical* spot
  prices (not just the real one) and find where the total crosses from
  negative to positive. That crossing price is the flip point.

All of this logic lives in `scripts/compute_gex.py` — read it, it's plain
pandas/numpy, nothing exotic.

## 4. Run it once

```bash
cd gex_dashboard
python3 scripts/compute_gex.py
```

This writes/updates `site/data/gex_data.json` and appends a row to
`site/data/history.json`.

## 5. View the dashboard locally

Static sites can't `fetch()` local files directly from `file://`, so serve
the folder over HTTP:

```bash
cd site
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## 6. Automate the daily refresh (no "Computer" needed)

**Option A — cron on your own Mac** (only updates while your machine is on):

```bash
crontab -e
```

Add a line to run at 4:45pm ET on weekdays:

```
45 16 * * 1-5 cd /path/to/gex_dashboard && /usr/bin/python3 scripts/compute_gex.py
```

**Option B — GitHub Actions (already included, recommended)** — runs in the
cloud on GitHub's servers, no machine of yours needs to be on, and it
auto-publishes to GitHub Pages after every successful update.

The workflow file is already in this project at
`.github/workflows/daily-gex-update.yml`. It does three things on a
schedule (weekdays at 4:45pm ET, plus a manual "Run workflow" button):

1. Checks out the repo and runs `scripts/compute_gex.py`
2. Commits the refreshed `gex_data.json` / `history.json` back to the repo
   (this is what makes the daily tracker persist across runs — GitHub
   Actions runners are thrown away after each run, so the data has to live
   in the repo itself)
3. Publishes the `site/` folder to GitHub Pages via the official
   `actions/deploy-pages` action — no separate build step needed since it's
   already static HTML/CSS/JS

**Setup steps (one-time):**

1. Create a new GitHub repo and push this whole `gex_dashboard/` folder to
   it (including the hidden `.github/` folder — make sure your `git add`
   picks up dotfiles, e.g. `git add -A`).
2. In the repo, go to **Settings → Pages** and set **Source** to
   **"GitHub Actions"** (not "Deploy from a branch" — the workflow handles
   deployment directly).
3. Go to the **Actions** tab, open "Daily SPY Gamma Exposure Update", and
   click **Run workflow** once to trigger the first deploy manually
   (otherwise it just waits for the next scheduled weekday run).
4. After that first run finishes, your dashboard is live at
   `https://<your-username>.github.io/<repo-name>/`.

No further action needed — it will keep refreshing every weekday afternoon
on its own. If the market was closed (holiday) the workflow detects no new
data and skips the commit/deploy step automatically instead of publishing a
stale duplicate. Note: the workflow's UTC offset is pinned for US daylight
time (EDT); see the comment at the top of the YAML file for the one-line
change needed when the US switches to standard time in November.

## 7. Hosting options (free)

- **GitHub Pages** — free, works well with Option B above.
- **Netlify / Vercel** — drag-and-drop the `site/` folder, or connect the
  GitHub repo for auto-deploys on every push.
- **Cloudflare Pages** — same idea, also free tier.

## 8. Caveats

- `yfinance` is an unofficial, free wrapper — fine for personal dashboards,
  but don't rely on it for production/trading-critical uptime. For a more
  robust feed, paid providers like CBOE DataShop, ORATS, Polygon.io, or
  Tradier all offer historical end-of-day options chains with open interest.
- The GEX magnitudes here are a modeled estimate (Black-Scholes gamma from
  the live IV surface), not a licensed dealer-positioning feed like
  SpotGamma — the wall/max-pain/flip levels are directionally meaningful but
  don't treat the exact dollar figures as institutional-grade.
