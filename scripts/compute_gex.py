"""
Multi-ticker Gamma Exposure computation pipeline (SPY + QQQ).

Fetches the live options chain for a given ticker (which, on non-trading
days, reflects the most recent trading session's closing open interest),
computes Black-Scholes dealer gamma exposure per strike, derives the call
wall / put wall / max pain / gamma flip point, and writes:
  - site/data/gex_data.json        (SPY snapshot — unchanged filename for
                                     backward compatibility with the
                                     existing SPY page)
  - site/data/history.json         (SPY append-only daily tracker log)
  - site/data/gex_data_QQQ.json    (QQQ snapshot)
  - site/data/history_QQQ.json     (QQQ append-only daily tracker log)

Ticker is selected via the TICKER env var (defaults to SPY). SPY keeps its
original fixed $700-850 strike window so existing history stays comparable;
any other ticker (e.g. QQQ) gets an auto-sized window of spot +/-25%.

Run this once per trading day (after close), once per ticker, to refresh
the dashboards.
"""
import json
import os
import sys
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from scipy.stats import norm

CONTRACT_SIZE = 100
RISK_FREE_RATE_FALLBACK = 0.039  # used only if the live ^IRX fetch below fails

# Tickers with a fixed, hand-picked strike window keep that exact window
# forever, so their history stays comparable day over day. Any ticker not
# listed here gets an automatic +/-25%-of-spot window instead.
FIXED_STRIKE_RANGES = {
    "SPY": (700, 850),
}

TICKER = os.environ.get("TICKER", "SPY").strip().upper() or "SPY"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DATA_DIR = os.path.join(BASE_DIR, "site", "data")
os.makedirs(SITE_DATA_DIR, exist_ok=True)


def _data_filenames(ticker):
    """SPY keeps the original unsuffixed filenames; every other ticker gets
    a _{TICKER} suffix so it never collides with the SPY files."""
    if ticker == "SPY":
        return "gex_data.json", "history.json"
    return f"gex_data_{ticker}.json", f"history_{ticker}.json"


_gex_name, _history_name = _data_filenames(TICKER)
GEX_JSON_PATH = os.path.join(SITE_DATA_DIR, _gex_name)
HISTORY_JSON_PATH = os.path.join(SITE_DATA_DIR, _history_name)


def get_strike_range(ticker, spot):
    if ticker in FIXED_STRIKE_RANGES:
        return FIXED_STRIKE_RANGES[ticker]
    return spot * 0.75, spot * 1.25


def bs_gamma(S, K, T, r, sigma):
    T = np.maximum(T, 1 / 365.0)
    sigma = np.maximum(sigma, 0.01)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    return norm.pdf(d1) / (S * sigma * np.sqrt(T))


def get_spot_and_asof(ticker):
    t = yf.Ticker(ticker)
    hist = t.history(period="5d")
    if hist.empty:
        raise RuntimeError(f"Could not fetch price history for '{ticker}' — check that the symbol is correct.")
    last_row = hist.iloc[-1]
    as_of_date = hist.index[-1].strftime("%Y-%m-%d")
    spot = float(last_row["Close"])
    return spot, as_of_date, t


def get_risk_free_rate(fallback=RISK_FREE_RATE_FALLBACK):
    """Live 13-week T-bill yield (^IRX) as a decimal, e.g. 0.039 for 3.9%.

    ^IRX is quoted in percentage points (e.g. 3.90), so we divide by 100.
    Falls back to the hardcoded constant if the fetch fails or returns
    something implausible, so a Yahoo Finance hiccup never breaks the
    whole daily run over a value that barely moves the gamma calculation
    anyway.
    """
    try:
        hist = yf.Ticker("^IRX").history(period="5d")
        if hist.empty:
            raise RuntimeError("empty ^IRX history")
        rate = float(hist.iloc[-1]["Close"]) / 100.0
        if not (0.0 < rate < 0.20):
            # Sanity check: T-bill yields don't realistically sit outside
            # roughly 0-20%. Treat anything outside that as a bad fetch.
            raise RuntimeError(f"implausible ^IRX rate: {rate}")
        return rate, "live"
    except Exception as ex:
        print(f"risk-free rate fetch failed ({ex}); using fallback {fallback}", file=sys.stderr)
        return fallback, "fallback"


def fetch_chain(t, as_of_date, strike_low, strike_high, max_days_out=100):
    as_of_dt = datetime.strptime(as_of_date, "%Y-%m-%d")
    cutoff = (as_of_dt + timedelta(days=max_days_out)).strftime("%Y-%m-%d")
    expirations = [e for e in t.options if e <= cutoff]

    rows = []
    for exp in expirations:
        try:
            chain = t.option_chain(exp)
        except Exception as ex:
            print(f"skip {exp}: {ex}", file=sys.stderr)
            continue
        exp_dt = datetime.strptime(exp, "%Y-%m-%d")
        dte = max((exp_dt - as_of_dt).days, 0)
        T = max(dte, 1) / 365.0
        for kind, df in (("call", chain.calls), ("put", chain.puts)):
            d = df.copy()
            d["type"] = kind
            d["expiration"] = exp
            d["dte"] = dte
            d["T"] = T
            rows.append(d[["strike", "openInterest", "impliedVolatility", "volume", "type", "expiration", "dte", "T"]])
    full = pd.concat(rows, ignore_index=True)
    full = full[(full["strike"] >= strike_low) & (full["strike"] <= strike_high)]
    full["openInterest"] = full["openInterest"].fillna(0)
    full["impliedVolatility"] = full["impliedVolatility"].fillna(0.0)
    return full


def compute_metrics(df, spot, risk_free_rate, strike_low, strike_high):
    df = df.copy()
    df["gamma"] = bs_gamma(spot, df["strike"].values, df["T"].values, risk_free_rate, df["impliedVolatility"].values)
    df["gex"] = np.where(
        df["type"] == "call",
        df["gamma"] * df["openInterest"] * CONTRACT_SIZE * spot * spot * 0.01,
        -1 * df["gamma"] * df["openInterest"] * CONTRACT_SIZE * spot * spot * 0.01,
    )

    call_gex = df[df["type"] == "call"].groupby("strike")["gex"].sum()
    put_gex = df[df["type"] == "put"].groupby("strike")["gex"].sum()
    call_oi = df[df["type"] == "call"].groupby("strike")["openInterest"].sum()
    put_oi = df[df["type"] == "put"].groupby("strike")["openInterest"].sum()

    strikes = sorted(df["strike"].unique())
    by_strike = pd.DataFrame({"strike": strikes}).set_index("strike")
    by_strike["call_gex"] = call_gex
    by_strike["put_gex"] = put_gex
    by_strike["call_oi"] = call_oi
    by_strike["put_oi"] = put_oi
    by_strike = by_strike.fillna(0.0)
    by_strike["net_gex"] = by_strike["call_gex"] + by_strike["put_gex"]
    by_strike = by_strike.reset_index()

    call_wall = float(by_strike.loc[by_strike["call_gex"].idxmax(), "strike"])
    put_wall = float(by_strike.loc[by_strike["put_gex"].idxmin(), "strike"])

    # Max pain (aggregate OI across included near-term expirations)
    agg = df.groupby(["strike", "type"])["openInterest"].sum().unstack(fill_value=0)
    if "call" not in agg.columns:
        agg["call"] = 0.0
    if "put" not in agg.columns:
        agg["put"] = 0.0
    pains = []
    for S in strikes:
        call_loss = ((S - agg.index[agg.index < S]) * agg.loc[agg.index < S, "call"]).sum()
        put_loss = ((agg.index[agg.index > S] - S) * agg.loc[agg.index > S, "put"]).sum()
        pains.append(call_loss + put_loss)
    max_pain = float(strikes[int(np.argmin(pains))])

    # Gamma flip curve: total dealer GEX as function of hypothetical spot
    hyp_spots = np.linspace(strike_low, strike_high, 150)
    flip_vals = []
    for S in hyp_spots:
        g = bs_gamma(S, df["strike"].values, df["T"].values, risk_free_rate, df["impliedVolatility"].values)
        sign = np.where(df["type"].values == "call", 1, -1)
        gex = sign * g * df["openInterest"].values * CONTRACT_SIZE * S * S * 0.01
        flip_vals.append(float(gex.sum()))

    gamma_flip = None
    for i in range(len(flip_vals) - 1):
        y0, y1 = flip_vals[i], flip_vals[i + 1]
        if y0 == 0 or (y0 < 0 < y1) or (y0 > 0 > y1):
            x0, x1 = hyp_spots[i], hyp_spots[i + 1]
            gamma_flip = float(x0 - y0 * (x1 - x0) / (y1 - y0))
            break
    if gamma_flip is None:
        # no sign change in range -> report edge closest to zero
        idx = int(np.argmin(np.abs(flip_vals)))
        gamma_flip = float(hyp_spots[idx])

    regime = "positive" if spot > gamma_flip else "negative"

    net_gex_now = float(by_strike["net_gex"].sum())

    return {
        "by_strike": by_strike,
        "call_wall": call_wall,
        "put_wall": put_wall,
        "max_pain": max_pain,
        "gamma_flip": gamma_flip,
        "regime": regime,
        "flip_curve": {"spot": hyp_spots.tolist(), "total_gex": flip_vals},
        "total_net_gex": net_gex_now,
        "expirations_used": sorted(df["expiration"].unique().tolist()),
    }


def main():
    ticker = TICKER
    spot, as_of_date, t = get_spot_and_asof(ticker)
    strike_low, strike_high = get_strike_range(ticker, spot)
    risk_free_rate, rate_source = get_risk_free_rate()
    df = fetch_chain(t, as_of_date, strike_low, strike_high)
    metrics = compute_metrics(df, spot, risk_free_rate, strike_low, strike_high)

    snapshot = {
        "generated_at_utc": datetime.utcnow().isoformat() + "Z",
        "ticker": ticker,
        "as_of_date": as_of_date,
        "spot": spot,
        "strike_range": [strike_low, strike_high],
        "risk_free_rate": risk_free_rate,
        "risk_free_rate_source": rate_source,
        "call_wall": metrics["call_wall"],
        "put_wall": metrics["put_wall"],
        "max_pain": metrics["max_pain"],
        "gamma_flip": metrics["gamma_flip"],
        "regime": metrics["regime"],
        "total_net_gex": metrics["total_net_gex"],
        "expirations_used": metrics["expirations_used"],
        "by_strike": metrics["by_strike"].to_dict(orient="records"),
        "flip_curve": metrics["flip_curve"],
    }

    with open(GEX_JSON_PATH, "w") as f:
        json.dump(snapshot, f, indent=2)

    # Append/update history
    history = []
    if os.path.exists(HISTORY_JSON_PATH):
        with open(HISTORY_JSON_PATH) as f:
            history = json.load(f)

    entry = {
        "date": as_of_date,
        "ticker": ticker,
        "spot": spot,
        "call_wall": metrics["call_wall"],
        "put_wall": metrics["put_wall"],
        "max_pain": metrics["max_pain"],
        "gamma_flip": metrics["gamma_flip"],
        "regime": metrics["regime"],
        "total_net_gex": metrics["total_net_gex"],
    }
    history = [h for h in history if h["date"] != as_of_date]
    history.append(entry)
    history.sort(key=lambda h: h["date"])

    with open(HISTORY_JSON_PATH, "w") as f:
        json.dump(history, f, indent=2)

    print(json.dumps(entry, indent=2))
    print(f"strike window used: {strike_low:.2f} - {strike_high:.2f}", file=sys.stderr)


if __name__ == "__main__":
    main()
