(function () {
  if (window.Chart && window['chartjs-plugin-annotation']) {
    Chart.register(window['chartjs-plugin-annotation']);
  } else if (window.Chart && window.ChartAnnotation) {
    Chart.register(window.ChartAnnotation);
  }

  const fmtUSD = (v) => '$' + Number(v).toFixed(2);
  const fmtStrike = (v) => '$' + Number(v).toFixed(0);
  const fmtGex = (v) => {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
    return sign + '$' + abs.toFixed(0);
  };

  const CHART_FONT = { family: "'Inter', sans-serif", size: 11 };
  Chart.defaults.color = '#8b95a7';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.borderColor = '#232b38';

  async function loadJSON(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load ' + path);
    return res.json();
  }

  function fmtDateLabel(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function buildGexChart(data) {
    const ctx = document.getElementById('gexChart');
    const strikes = data.by_strike.map((r) => r.strike);
    const netVals = data.by_strike.map((r) => r.net_gex);
    const colors = netVals.map((v) => (v >= 0 ? 'rgba(59,130,246,0.85)' : 'rgba(251,113,133,0.85)'));

    const annotations = {
      spotLine: {
        type: 'line', xMin: data.spot, xMax: data.spot,
        borderColor: '#e9edf3', borderWidth: 1.5, borderDash: [2, 3],
        label: { display: true, content: 'Spot ' + fmtUSD(data.spot), position: 'start', color: '#e9edf3', font: { size: 10, weight: '600' }, backgroundColor: 'rgba(10,14,20,0.85)', padding: 4 }
      },
      callWall: {
        type: 'line', xMin: data.call_wall, xMax: data.call_wall,
        borderColor: '#3b82f6', borderWidth: 2, borderDash: [6, 4],
        label: { display: true, content: 'Call Wall ' + fmtStrike(data.call_wall), position: 'end', color: '#3b82f6', font: { size: 10, weight: '700' }, backgroundColor: 'rgba(10,14,20,0.85)', padding: 4, yAdjust: -6 }
      },
      putWall: {
        type: 'line', xMin: data.put_wall, xMax: data.put_wall,
        borderColor: '#fb7185', borderWidth: 2, borderDash: [6, 4],
        label: { display: true, content: 'Put Wall ' + fmtStrike(data.put_wall), position: 'start', color: '#fb7185', font: { size: 10, weight: '700' }, backgroundColor: 'rgba(10,14,20,0.85)', padding: 4, yAdjust: 20 }
      },
      maxPain: {
        type: 'line', xMin: data.max_pain, xMax: data.max_pain,
        borderColor: '#fbbf24', borderWidth: 2, borderDash: [3, 3],
        label: { display: true, content: 'Max Pain ' + fmtStrike(data.max_pain), position: 'end', color: '#fbbf24', font: { size: 10, weight: '700' }, backgroundColor: 'rgba(10,14,20,0.85)', padding: 4, yAdjust: 40 }
      },
      gammaFlip: {
        type: 'line', xMin: data.gamma_flip, xMax: data.gamma_flip,
        borderColor: '#a78bfa', borderWidth: 2,
        label: { display: true, content: 'Gamma Flip ' + fmtStrike(data.gamma_flip), position: 'start', color: '#a78bfa', font: { size: 10, weight: '700' }, backgroundColor: 'rgba(10,14,20,0.85)', padding: 4, yAdjust: 60 }
      },
      zero: {
        type: 'line', yMin: 0, yMax: 0,
        borderColor: '#3a4353', borderWidth: 1
      }
    };

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: strikes,
        datasets: [{
          label: 'Net Dealer Gamma Exposure',
          data: netVals,
          backgroundColor: colors,
          borderWidth: 0,
          barPercentage: 1.0,
          categoryPercentage: 1.0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: 'easeOutQuart' },
        scales: {
          x: {
            type: 'linear',
            min: data.strike_range[0], max: data.strike_range[1],
            title: { display: true, text: 'Strike ($)', color: '#8b95a7', font: CHART_FONT },
            grid: { color: 'rgba(35,43,56,0.6)' },
            ticks: { color: '#8b95a7', font: CHART_FONT, maxTicksLimit: 16 },
          },
          y: {
            title: { display: true, text: 'Gamma Exposure ($ / 1% move)', color: '#8b95a7', font: CHART_FONT },
            grid: { color: 'rgba(35,43,56,0.6)' },
            ticks: { color: '#8b95a7', font: CHART_FONT, callback: fmtGex },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#141b25', borderColor: '#232b38', borderWidth: 1,
            titleColor: '#e9edf3', bodyColor: '#e9edf3',
            callbacks: {
              title: (items) => 'Strike $' + items[0].label,
              label: (item) => 'Net GEX: ' + fmtGex(item.parsed.y),
            },
          },
          annotation: { annotations },
        },
      },
    });
  }

  function buildFlipChart(data, tickerLabel) {
    const ctx = document.getElementById('flipChart');
    const spots = data.flip_curve.spot;
    const vals = data.flip_curve.total_gex;
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: spots,
        datasets: [{
          label: 'Total Dealer GEX',
          data: vals,
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34,211,238,0.08)',
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.15,
          segment: {
            borderColor: (c) => (c.p0.parsed.y < 0 || c.p1.parsed.y < 0 ? '#f87171' : '#34d399'),
          },
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700 },
        scales: {
          x: {
            type: 'linear', min: data.strike_range[0], max: data.strike_range[1],
            title: { display: true, text: 'Hypothetical ' + tickerLabel + ' Spot ($)', color: '#8b95a7', font: CHART_FONT },
            grid: { color: 'rgba(35,43,56,0.6)' },
            ticks: { color: '#8b95a7', font: CHART_FONT, maxTicksLimit: 10 },
          },
          y: {
            title: { display: true, text: 'Total GEX', color: '#8b95a7', font: CHART_FONT },
            grid: { color: 'rgba(35,43,56,0.6)' },
            ticks: { color: '#8b95a7', font: CHART_FONT, callback: fmtGex },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#141b25', borderColor: '#232b38', borderWidth: 1,
            titleColor: '#e9edf3', bodyColor: '#e9edf3',
            callbacks: {
              title: (items) => 'Spot $' + Number(items[0].label).toFixed(0),
              label: (item) => 'Total GEX: ' + fmtGex(item.parsed.y),
            },
          },
          annotation: {
            annotations: {
              zero: { type: 'line', yMin: 0, yMax: 0, borderColor: '#3a4353', borderWidth: 1 },
              flip: {
                type: 'line', xMin: data.gamma_flip, xMax: data.gamma_flip,
                borderColor: '#a78bfa', borderWidth: 2, borderDash: [4, 3],
                label: { display: true, content: 'Flip ' + fmtStrike(data.gamma_flip), position: 'start', color: '#a78bfa', font: { size: 10, weight: '700' }, backgroundColor: 'rgba(10,14,20,0.85)', padding: 4 },
              },
              spot: {
                type: 'line', xMin: data.spot, xMax: data.spot,
                borderColor: '#e9edf3', borderWidth: 1.5, borderDash: [2, 3],
                label: { display: true, content: 'Spot', position: 'end', color: '#e9edf3', font: { size: 10 }, backgroundColor: 'rgba(10,14,20,0.85)', padding: 3 },
              },
            },
          },
        },
      },
    });
  }

  function buildOIChart(data) {
    const ctx = document.getElementById('oiChart');
    // Downsample to $5 buckets for readability
    const bucketSize = 5;
    const buckets = {};
    data.by_strike.forEach((r) => {
      const b = Math.round(r.strike / bucketSize) * bucketSize;
      if (!buckets[b]) buckets[b] = { call: 0, put: 0 };
      buckets[b].call += r.call_oi;
      buckets[b].put += r.put_oi;
    });
    const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: keys,
        datasets: [
          { label: 'Call OI', data: keys.map((k) => buckets[k].call), backgroundColor: 'rgba(59,130,246,0.85)' },
          { label: 'Put OI', data: keys.map((k) => -buckets[k].put), backgroundColor: 'rgba(251,113,133,0.85)' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700 },
        scales: {
          x: { stacked: true, grid: { color: 'rgba(35,43,56,0.6)' }, ticks: { color: '#8b95a7', font: CHART_FONT, maxTicksLimit: 14 }, title: { display: true, text: 'Strike ($, $5 buckets)', color: '#8b95a7', font: CHART_FONT } },
          y: { stacked: true, grid: { color: 'rgba(35,43,56,0.6)' }, ticks: { color: '#8b95a7', font: CHART_FONT, callback: (v) => Math.abs(v).toLocaleString() }, title: { display: true, text: 'Open Interest', color: '#8b95a7', font: CHART_FONT } },
        },
        plugins: {
          legend: { position: 'top', labels: { color: '#8b95a7', font: CHART_FONT, boxWidth: 10 } },
          tooltip: {
            backgroundColor: '#141b25', borderColor: '#232b38', borderWidth: 1,
            titleColor: '#e9edf3', bodyColor: '#e9edf3',
            callbacks: { label: (item) => item.dataset.label + ': ' + Math.abs(item.parsed.y).toLocaleString() },
          },
        },
      },
    });
  }

  function buildTrackerChart(history) {
    const box = document.getElementById('trackerChartBox');
    const ctx = document.getElementById('trackerChart');
    if (history.length < 2) {
      const baseline = history.length === 1 ? fmtDateLabel(history[0].date) : 'the first recorded day';
      box.innerHTML = '<div class="empty-hint">Tracking begins with the ' + baseline + ' baseline. Additional trading days will appear here as they are recorded.</div>';
      return null;
    }
    const labels = history.map((h) => fmtDateLabel(h.date));
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Call Wall', data: history.map((h) => h.call_wall), borderColor: '#3b82f6', backgroundColor: '#3b82f6', pointRadius: 4, tension: 0.25 },
          { label: 'Spot', data: history.map((h) => h.spot), borderColor: '#e9edf3', backgroundColor: '#e9edf3', pointRadius: 3, borderDash: [4, 3], tension: 0.25 },
          { label: 'Gamma Flip', data: history.map((h) => h.gamma_flip), borderColor: '#a78bfa', backgroundColor: '#a78bfa', pointRadius: 4, tension: 0.25 },
          { label: 'Max Pain', data: history.map((h) => h.max_pain), borderColor: '#fbbf24', backgroundColor: '#fbbf24', pointRadius: 4, tension: 0.25 },
          { label: 'Put Wall', data: history.map((h) => h.put_wall), borderColor: '#fb7185', backgroundColor: '#fb7185', pointRadius: 4, tension: 0.25 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700 },
        scales: {
          x: { grid: { color: 'rgba(35,43,56,0.6)' }, ticks: { color: '#8b95a7', font: CHART_FONT } },
          y: { grid: { color: 'rgba(35,43,56,0.6)' }, ticks: { color: '#8b95a7', font: CHART_FONT, callback: fmtStrike }, title: { display: true, text: 'Strike ($)', color: '#8b95a7', font: CHART_FONT } },
        },
        plugins: {
          legend: { position: 'top', labels: { color: '#8b95a7', font: CHART_FONT, boxWidth: 10 } },
          tooltip: {
            backgroundColor: '#141b25', borderColor: '#232b38', borderWidth: 1,
            titleColor: '#e9edf3', bodyColor: '#e9edf3',
            callbacks: { label: (item) => item.dataset.label + ': ' + fmtStrike(item.parsed.y) },
          },
        },
      },
    });
  }

  function renderTrackerTable(history) {
    const body = document.getElementById('trackerBody');
    body.innerHTML = history.map((h) => `
      <tr>
        <td>${fmtDateLabel(h.date)}</td>
        <td>${fmtUSD(h.spot)}</td>
        <td>${fmtStrike(h.call_wall)}</td>
        <td>${fmtStrike(h.put_wall)}</td>
        <td>${fmtStrike(h.max_pain)}</td>
        <td>${fmtStrike(h.gamma_flip)}</td>
        <td><span class="badge-regime ${h.regime}">${h.regime}</span></td>
      </tr>
    `).join('');
  }

  function renderKPIs(data) {
    const ticker = data.ticker || window.GEX_TICKER || 'Ticker';
    document.title = ticker + ' Gamma Exposure Dashboard';
    const heading = document.getElementById('pageHeading');
    if (heading) heading.textContent = ticker + ' Gamma Exposure Dashboard';
    const spotLabel = document.getElementById('kpiSpotLabel');
    if (spotLabel) spotLabel.textContent = ticker + ' Spot (Close)';
    const strikeRangeLabel = document.getElementById('strikeRangeLabel');
    if (strikeRangeLabel) strikeRangeLabel.textContent = Math.round(data.strike_range[0]) + '\u2013' + Math.round(data.strike_range[1]);
    const gexPanelDesc = document.getElementById('gexPanelDesc');
    if (gexPanelDesc) gexPanelDesc.textContent = 'Net GEX per $1 strike, ' + Math.round(data.strike_range[0]) + '\u2013' + Math.round(data.strike_range[1]) + ', using ' + fmtDateLabel(data.as_of_date) + "'s closing open interest";
    const oiPanelDesc = document.getElementById('oiPanelDesc');
    if (oiPanelDesc) oiPanelDesc.textContent = 'By strike, ' + Math.round(data.strike_range[0]) + '\u2013' + Math.round(data.strike_range[1]);
    const footnote = document.getElementById('footnoteText');
    if (footnote) {
      footnote.innerHTML = 'Methodology: dealer gamma exposure (GEX) per strike is estimated as Black&ndash;Scholes gamma &times; open interest &times; 100 &times; spot&sup2; &times; 0.01, with call open interest contributing positive exposure and put open interest contributing negative exposure (standard dealer-positioning convention). Implied volatility, open interest, and expirations are read from the live ' + ticker + ' options chain, reflecting ' + fmtDateLabel(data.as_of_date) + ' closing open interest. Max pain aggregates open interest across included near-term expirations to find the strike that minimizes total option payout at expiration. The gamma flip is the spot level where modeled total dealer gamma crosses from negative to positive. This is a modeled estimate for informational purposes, not a real-time dealer positioning feed, and should not be used as the sole basis for trading decisions.';
    }

    document.getElementById('asOfLabel').textContent = 'as of ' + fmtDateLabel(data.as_of_date) + ' close';
    document.getElementById('updatedAt').textContent = 'Last refreshed: ' + new Date(data.generated_at_utc).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

    document.getElementById('kpiSpot').textContent = fmtUSD(data.spot);
    document.getElementById('kpiSpotSub').textContent = fmtDateLabel(data.as_of_date) + ' close';
    document.getElementById('kpiCallWall').textContent = fmtStrike(data.call_wall);
    document.getElementById('kpiPutWall').textContent = fmtStrike(data.put_wall);
    document.getElementById('kpiMaxPain').textContent = fmtStrike(data.max_pain);
    document.getElementById('kpiFlip').textContent = fmtStrike(data.gamma_flip);

    const distPct = ((data.spot - data.gamma_flip) / data.gamma_flip * 100).toFixed(2);
    document.getElementById('kpiFlipSub').textContent = (data.spot >= data.gamma_flip ? '+' : '') + distPct + '% from spot';

    const badge = document.getElementById('regimeBadge');
    const text = document.getElementById('regimeText');
    badge.classList.add(data.regime);
    text.textContent = data.regime === 'negative' ? 'Negative Gamma Regime' : 'Positive Gamma Regime';
  }

  async function init() {
    const dataFile = window.GEX_DATA_FILE || 'data/gex_data.json';
    const historyFile = window.GEX_HISTORY_FILE || 'data/history.json';
    try {
      const [data, history] = await Promise.all([
        loadJSON(dataFile + '?_=' + Date.now()),
        loadJSON(historyFile + '?_=' + Date.now()).catch(() => []),
      ]);
      const ticker = data.ticker || window.GEX_TICKER || 'Ticker';
      renderKPIs(data);
      buildGexChart(data);
      buildFlipChart(data, ticker);
      buildOIChart(data);
      buildTrackerChart(history);
      renderTrackerTable(history);
    } catch (err) {
      console.error(err);
      document.querySelector('.wrap').insertAdjacentHTML('afterbegin', '<div class="empty-hint">Could not load dashboard data.</div>');
    }
  }

  init();
})();
