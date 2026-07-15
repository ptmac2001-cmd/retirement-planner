(function () {
  "use strict";

  // ── Seeded PRNG (Mulberry32) ──
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeNormal(rand) {
    // Box-Muller
    let u, v;
    do { u = rand(); } while (u === 0);
    v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ── Stock universe ──
  const STOCKS = {
    AAPL:  { name: "Apple Inc.",           seed: 42,    startPrice: 150,   annualDrift: 0.12, annualVol: 0.28 },
    MSFT:  { name: "Microsoft Corp.",      seed: 137,   startPrice: 320,   annualDrift: 0.15, annualVol: 0.25 },
    GOOGL: { name: "Alphabet Inc.",        seed: 256,   startPrice: 140,   annualDrift: 0.10, annualVol: 0.30 },
    AMZN:  { name: "Amazon.com Inc.",      seed: 512,   startPrice: 180,   annualDrift: 0.14, annualVol: 0.32 },
    TSLA:  { name: "Tesla Inc.",           seed: 1024,  startPrice: 250,   annualDrift: 0.08, annualVol: 0.60 },
    NVDA:  { name: "NVIDIA Corp.",         seed: 2048,  startPrice: 450,   annualDrift: 0.25, annualVol: 0.55 },
    META:  { name: "Meta Platforms",       seed: 4096,  startPrice: 480,   annualDrift: 0.18, annualVol: 0.38 },
    JPM:   { name: "JPMorgan Chase",       seed: 8192,  startPrice: 200,   annualDrift: 0.09, annualVol: 0.22 },
    SPY:   { name: "S&P 500 ETF",          seed: 16384, startPrice: 500,   annualDrift: 0.10, annualVol: 0.18 },
    BTC:   { name: "Bitcoin (simulated)",  seed: 32768, startPrice: 65000, annualDrift: 0.30, annualVol: 0.90 },
  };

  const MODEL_DESCRIPTIONS = {
    montecarlo: `
      <strong>Monte Carlo Simulation</strong> generates thousands of possible future price
      paths using Geometric Brownian Motion (GBM), calibrated to the stock's historical
      drift (μ) and volatility (σ). The resulting distribution of outcomes is shown as
      confidence bands (5th–95th percentile). This is the most robust model for capturing
      the range of possible outcomes.`,
    linreg: `
      <strong>Linear Regression</strong> fits an Ordinary Least Squares (OLS) line to the
      log-prices over the calibration window, then extrapolates the trend into the future.
      The confidence interval widens over time, based on in-sample residual variance.
      Best suited for stocks in a clear, sustained trend.`,
    ema: `
      <strong>Exponential Moving Average (EMA)</strong> weights recent returns more heavily
      than older ones to estimate the expected daily return. The forecast projects that
      return forward with an expanding uncertainty band proportional to volatility × √t.
      Reacts quickly to recent price changes.`,
  };

  // ── Generate 504 trading-day history via GBM ──
  function generateHistory(ticker) {
    const cfg = STOCKS[ticker];
    const rand = mulberry32(cfg.seed);
    const dt = 1 / 252;
    const drift = cfg.annualDrift;
    const vol = cfg.annualVol;

    const numDays = 504; // 2 years
    const prices = [cfg.startPrice];

    for (let i = 1; i < numDays; i++) {
      const z = makeNormal(rand);
      const ret = (drift - 0.5 * vol * vol) * dt + vol * Math.sqrt(dt) * z;
      prices.push(prices[i - 1] * Math.exp(ret));
    }

    // Generate trading dates going back from today
    const dates = [];
    const today = new Date();
    let d = new Date(today);
    // We'll collect numDays trading days backward
    let collected = 0;
    while (collected < numDays) {
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        dates.unshift(new Date(d));
        collected++;
      }
      d.setDate(d.getDate() - 1);
    }

    return { prices, dates };
  }

  // ── Generate future trading dates ──
  function futureDates(startDate, numDays) {
    const dates = [];
    let d = new Date(startDate);
    d.setDate(d.getDate() + 1);
    while (dates.length < numDays) {
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        dates.push(new Date(d));
      }
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }

  // ── Statistical helpers ──
  function logReturns(prices) {
    const r = [];
    for (let i = 1; i < prices.length; i++) {
      r.push(Math.log(prices[i] / prices[i - 1]));
    }
    return r;
  }

  function mean(arr) {
    return arr.reduce((s, x) => s + x, 0) / arr.length;
  }

  function stddev(arr, m) {
    if (m === undefined) m = mean(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
  }

  function percentile(sorted, p) {
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  // ── Models ──

  // Monte Carlo: return { p5, p25, p50, p75, p95 } arrays, each of length horizon
  function runMonteCarlo(prices, horizon, simCount) {
    const returns = logReturns(prices);
    const mu = mean(returns);
    const sigma = stddev(returns, mu);
    const S0 = prices[prices.length - 1];
    const rand = mulberry32(999);

    // paths[sim][day] = price
    const endpoints = Array.from({ length: horizon }, () => []);

    for (let s = 0; s < simCount; s++) {
      let price = S0;
      for (let t = 0; t < horizon; t++) {
        const z = makeNormal(rand);
        price = price * Math.exp((mu - 0.5 * sigma * sigma) + sigma * z);
        endpoints[t].push(price);
      }
    }

    const result = { p5: [], p25: [], p50: [], p75: [], p95: [], annualVol: sigma * Math.sqrt(252) };
    for (let t = 0; t < horizon; t++) {
      const sorted = endpoints[t].slice().sort((a, b) => a - b);
      result.p5.push(percentile(sorted, 5));
      result.p25.push(percentile(sorted, 25));
      result.p50.push(percentile(sorted, 50));
      result.p75.push(percentile(sorted, 75));
      result.p95.push(percentile(sorted, 95));
    }

    // Also return final distribution for histogram
    const finalDist = endpoints[horizon - 1].slice().sort((a, b) => a - b);
    result.finalDist = finalDist;

    return result;
  }

  // Linear Regression on log-prices
  function runLinearRegression(prices, horizon, regrWindow) {
    const slice = prices.slice(-regrWindow);
    const logPrices = slice.map(Math.log);
    const n = logPrices.length;
    const xs = Array.from({ length: n }, (_, i) => i);
    const xm = mean(xs);
    const ym = mean(logPrices);
    const ssxy = xs.reduce((s, x, i) => s + (x - xm) * (logPrices[i] - ym), 0);
    const ssxx = xs.reduce((s, x) => s + (x - xm) ** 2, 0);
    const slope = ssxy / ssxx;
    const intercept = ym - slope * xm;

    const residuals = logPrices.map((y, i) => y - (intercept + slope * xs[i]));
    const residStd = stddev(residuals);

    // Annualized vol from residuals
    const annualVol = residStd * Math.sqrt(252);

    const result = { p5: [], p25: [], p50: [], p75: [], p95: [], annualVol };

    for (let t = 1; t <= horizon; t++) {
      const x = n - 1 + t;
      const logMid = intercept + slope * x;
      // CI widens with sqrt(t) * residStd (simplified forecast interval)
      const se = residStd * Math.sqrt(1 + 1 / n + (x - xm) ** 2 / ssxx);
      result.p50.push(Math.exp(logMid));
      result.p5.push(Math.exp(logMid - 1.645 * se));
      result.p25.push(Math.exp(logMid - 0.674 * se));
      result.p75.push(Math.exp(logMid + 0.674 * se));
      result.p95.push(Math.exp(logMid + 1.645 * se));
    }

    // Simulate final distribution (normal approximation)
    const finalLogMid = intercept + slope * (n - 1 + horizon);
    const finalSe = residStd * Math.sqrt(horizon);
    const finalDist = [];
    const rand = mulberry32(777);
    for (let i = 0; i < 500; i++) {
      finalDist.push(Math.exp(finalLogMid + makeNormal(rand) * finalSe));
    }
    finalDist.sort((a, b) => a - b);
    result.finalDist = finalDist;

    return result;
  }

  // EMA-based forecast
  function runEMA(prices, horizon, emaSpan) {
    const returns = logReturns(prices);
    // EMA of returns
    const k = 2 / (emaSpan + 1);
    let ema = returns[0];
    for (let i = 1; i < returns.length; i++) {
      ema = returns[i] * k + ema * (1 - k);
    }

    const sigma = stddev(returns, mean(returns));
    const S0 = prices[prices.length - 1];
    const annualVol = sigma * Math.sqrt(252);

    const result = { p5: [], p25: [], p50: [], p75: [], p95: [], annualVol };

    for (let t = 1; t <= horizon; t++) {
      const logMid = Math.log(S0) + ema * t;
      const se = sigma * Math.sqrt(t);
      result.p50.push(Math.exp(logMid));
      result.p5.push(Math.exp(logMid - 1.645 * se));
      result.p25.push(Math.exp(logMid - 0.674 * se));
      result.p75.push(Math.exp(logMid + 0.674 * se));
      result.p95.push(Math.exp(logMid + 1.645 * se));
    }

    const finalLogMid = Math.log(S0) + ema * horizon;
    const finalSe = sigma * Math.sqrt(horizon);
    const rand = mulberry32(555);
    const finalDist = [];
    for (let i = 0; i < 500; i++) {
      finalDist.push(Math.exp(finalLogMid + makeNormal(rand) * finalSe));
    }
    finalDist.sort((a, b) => a - b);
    result.finalDist = finalDist;

    return result;
  }

  // ── Formatting ──
  function fmtPrice(n, ticker) {
    if (!isFinite(n)) return "—";
    const isBig = n >= 10000;
    if (isBig) return "$" + Math.round(n).toLocaleString("en-US");
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtPct(n) {
    const sign = n >= 0 ? "+" : "";
    return sign + (n * 100).toFixed(2) + "%";
  }

  function fmtDate(d) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // ── DOM refs ──
  const $ = (s) => document.querySelector(s);

  let priceChart = null;
  let distChart = null;
  let currentTicker = null;
  let histData = null;

  // ── Update model param visibility ──
  function updateModelParams() {
    const model = $("#modelSelect").value;
    $("#simCountLabel").style.display = model === "montecarlo" ? "" : "none";
    $("#regrWindowLabel").style.display = model === "linreg" ? "" : "none";
    $("#emaSpanLabel").style.display = model === "ema" ? "" : "none";
    $("#modelDescription").innerHTML = MODEL_DESCRIPTIONS[model] || "";
  }

  // ── Main predict function ──
  function runPrediction() {
    const ticker = $("#tickerSelect").value;
    const model = $("#modelSelect").value;
    const horizon = parseInt($("#horizonSelect").value);
    const histWindow = parseInt($("#histWindow").value) || 252;
    const simCount = parseInt($("#simCount").value) || 500;
    const regrWindow = parseInt($("#regrWindow").value) || 60;
    const emaSpan = parseInt($("#emaSpan").value) || 20;
    const histDisplay = parseInt($("#histDisplay").value) || 180;
    const showBands = $("#showBands").checked;
    const showVolatility = $("#showVolatility").checked;

    // Generate (or reuse) history
    if (currentTicker !== ticker) {
      histData = generateHistory(ticker);
      currentTicker = ticker;
    }

    const { prices, dates } = histData;
    const calibPrices = prices.slice(-histWindow);
    const currentPrice = prices[prices.length - 1];

    // Run model
    let forecast;
    if (model === "montecarlo") {
      forecast = runMonteCarlo(calibPrices, horizon, simCount);
    } else if (model === "linreg") {
      forecast = runLinearRegression(calibPrices, horizon, regrWindow);
    } else {
      forecast = runEMA(calibPrices, horizon, emaSpan);
    }

    const futDates = futureDates(dates[dates.length - 1], horizon);

    // Summary cards
    const predictedPrice = forecast.p50[forecast.p50.length - 1];
    const change = (predictedPrice - currentPrice) / currentPrice;
    const changeEl = $("#expectedChange");
    changeEl.textContent = fmtPct(change);
    changeEl.className = "card-value " + (change >= 0 ? "positive" : "negative");
    $("#currentPrice").textContent = fmtPrice(currentPrice, ticker);
    $("#predictedPrice").textContent = fmtPrice(predictedPrice, ticker);
    $("#annualVol").textContent = (forecast.annualVol * 100).toFixed(1) + "%";
    $("#chartTitle").textContent = `— ${STOCKS[ticker].name} (${ticker})`;

    renderPriceChart(ticker, prices, dates, forecast, futDates, histDisplay, showBands, showVolatility);
    renderDistChart(forecast, currentPrice, ticker);
    renderStats(forecast, currentPrice, ticker, horizon);
    renderMilestoneTable(forecast, currentPrice, futDates, ticker, horizon);
  }

  // ── Price Chart ──
  function renderPriceChart(ticker, prices, dates, forecast, futDates, histDisplay, showBands, showVolatility) {
    const slicedPrices = prices.slice(-histDisplay);
    const slicedDates = dates.slice(-histDisplay);
    const lastPrice = prices[prices.length - 1];

    const histLabels = slicedDates.map(fmtDate);
    const futLabels = futDates.map(fmtDate);
    const allLabels = [...histLabels, ...futLabels];

    // Pad historical data with nulls into future slots
    const histData = [...slicedPrices, ...Array(futDates.length).fill(null)];

    // Pad forecast arrays with null for historical slots
    const pad = Array(histDisplay).fill(null);
    // Include last historical point as first forecast point for visual continuity
    const bridgeNull = Array(histDisplay - 1).fill(null);

    const datasets = [
      {
        label: "Historical Price",
        data: histData,
        borderColor: "#2563eb",
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        order: 1,
      },
      {
        label: "Predicted (Median)",
        data: [...bridgeNull, lastPrice, ...forecast.p50],
        borderColor: "#10b981",
        backgroundColor: "transparent",
        borderWidth: 2.5,
        borderDash: [5, 3],
        pointRadius: 0,
        tension: 0.2,
        order: 2,
      },
    ];

    if (showBands) {
      datasets.push(
        {
          label: "95th Percentile",
          data: [...bridgeNull, lastPrice, ...forecast.p95],
          borderColor: "rgba(16,185,129,0.3)",
          backgroundColor: "rgba(16,185,129,0.08)",
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.2,
          order: 4,
        },
        {
          label: "75th Percentile",
          data: [...bridgeNull, lastPrice, ...forecast.p75],
          borderColor: "rgba(16,185,129,0.5)",
          backgroundColor: "rgba(16,185,129,0.12)",
          borderWidth: 1,
          borderDash: [4, 2],
          pointRadius: 0,
          fill: "-1",
          tension: 0.2,
          order: 5,
        },
        {
          label: "25th Percentile",
          data: [...bridgeNull, lastPrice, ...forecast.p25],
          borderColor: "rgba(239,68,68,0.5)",
          backgroundColor: "rgba(239,68,68,0.08)",
          borderWidth: 1,
          borderDash: [4, 2],
          pointRadius: 0,
          fill: false,
          tension: 0.2,
          order: 6,
        },
        {
          label: "5th Percentile",
          data: [...bridgeNull, lastPrice, ...forecast.p5],
          borderColor: "rgba(239,68,68,0.3)",
          backgroundColor: "rgba(239,68,68,0.08)",
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: "+1",
          tension: 0.2,
          order: 7,
        }
      );
    }

    if (showVolatility && !showBands) {
      // Show just outer 5/95 band as volatility cone
      datasets.push(
        {
          label: "Volatility Cone (95%)",
          data: [...bridgeNull, lastPrice, ...forecast.p95],
          borderColor: "rgba(99,102,241,0.4)",
          backgroundColor: "rgba(99,102,241,0.06)",
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.2,
          order: 4,
        },
        {
          label: "Volatility Cone (5%)",
          data: [...bridgeNull, lastPrice, ...forecast.p5],
          borderColor: "rgba(99,102,241,0.4)",
          backgroundColor: "rgba(99,102,241,0.06)",
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: "+1",
          tension: 0.2,
          order: 5,
        }
      );
    }

    // Destroy old chart
    if (priceChart) { priceChart.destroy(); priceChart = null; }

    const ctx = document.getElementById("priceChart");
    const forecastStartIdx = histDisplay;

    priceChart = new Chart(ctx, {
      type: "line",
      data: { labels: allLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              label: (item) => item.dataset.label + ": " + fmtPrice(item.parsed.y, ticker),
            },
          },
          legend: {
            labels: {
              usePointStyle: true,
              pointStyle: "line",
              font: { size: 11 },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 12,
              maxRotation: 30,
            },
          },
          y: {
            ticks: {
              callback: (v) => fmtPrice(v, ticker),
            },
          },
        },
      },
      plugins: [{
        id: "forecastLine",
        afterDraw(chart) {
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;
          const x = xScale.getPixelForValue(forecastStartIdx);
          const ctx2 = chart.ctx;
          ctx2.save();
          ctx2.strokeStyle = "#94a3b8";
          ctx2.lineWidth = 1.5;
          ctx2.setLineDash([6, 4]);
          ctx2.beginPath();
          ctx2.moveTo(x, yScale.top);
          ctx2.lineTo(x, yScale.bottom);
          ctx2.stroke();
          ctx2.fillStyle = "#64748b";
          ctx2.font = "11px sans-serif";
          ctx2.fillText("Forecast →", x + 6, yScale.top + 16);
          ctx2.restore();
        },
      }],
    });
  }

  // ── Distribution Chart (histogram) ──
  function renderDistChart(forecast, currentPrice, ticker) {
    const dist = forecast.finalDist;
    const bins = 30;
    const lo = dist[0], hi = dist[dist.length - 1];
    const step = (hi - lo) / bins;
    const counts = Array(bins).fill(0);
    dist.forEach((p) => {
      const idx = Math.min(Math.floor((p - lo) / step), bins - 1);
      counts[idx]++;
    });

    const labels = Array.from({ length: bins }, (_, i) =>
      fmtPrice(lo + (i + 0.5) * step, ticker)
    );

    const colors = counts.map((_, i) => {
      const midPrice = lo + (i + 0.5) * step;
      return midPrice >= currentPrice ? "rgba(16,185,129,0.7)" : "rgba(239,68,68,0.7)";
    });

    if (distChart) { distChart.destroy(); distChart = null; }

    const ctx = document.getElementById("distChart");
    distChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Frequency",
          data: counts,
          backgroundColor: colors,
          borderColor: colors.map(c => c.replace("0.7", "1")),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => `Count: ${item.parsed.y} (${((item.parsed.y / dist.length) * 100).toFixed(1)}%)`,
            },
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 8, maxRotation: 30 } },
          y: { title: { display: true, text: "Simulated Outcomes" } },
        },
      },
    });
  }

  // ── Stats Grid ──
  function renderStats(forecast, currentPrice, ticker, horizon) {
    const last = forecast.p50.length - 1;
    const p50 = forecast.p50[last];
    const p5 = forecast.p5[last];
    const p95 = forecast.p95[last];
    const p25 = forecast.p25[last];
    const p75 = forecast.p75[last];

    const probUp = forecast.finalDist.filter(p => p > currentPrice).length / forecast.finalDist.length;
    const expectedReturn = (p50 - currentPrice) / currentPrice;
    const annVolPct = (forecast.annualVol * 100).toFixed(1);

    function stat(label, value, sub) {
      return `<div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
      </div>`;
    }

    $("#statsGrid").innerHTML =
      stat("Median Forecast", fmtPrice(p50, ticker), `in ${horizon} days`) +
      stat("Bear Case (5th %ile)", fmtPrice(p5, ticker), fmtPct((p5 - currentPrice) / currentPrice)) +
      stat("Bull Case (95th %ile)", fmtPrice(p95, ticker), fmtPct((p95 - currentPrice) / currentPrice)) +
      stat("Interquartile Range", fmtPrice(p25, ticker) + " – " + fmtPrice(p75, ticker), "25th–75th percentile") +
      stat("Prob. of Gain", (probUp * 100).toFixed(1) + "%", "P(price > current)") +
      stat("Expected Return", fmtPct(expectedReturn), "Median vs today") +
      stat("Annual Volatility", annVolPct + "%", "Historical σ × √252") +
      stat("Price Range Width", fmtPrice(p95 - p5, ticker), "95th – 5th percentile");
  }

  // ── Milestone Table ──
  function renderMilestoneTable(forecast, currentPrice, futDates, ticker, horizon) {
    const checkpoints = [7, 14, 30, 60, 90, 180, 365].filter(d => d <= horizon);
    // Always include the last day
    if (!checkpoints.includes(horizon)) checkpoints.push(horizon);

    let html = "";
    checkpoints.forEach(days => {
      // Find the forecast index closest to this day count
      const idx = Math.min(days - 1, forecast.p50.length - 1);
      const date = futDates[idx] || futDates[futDates.length - 1];
      const p50 = forecast.p50[idx];
      const p5 = forecast.p5[idx];
      const p95 = forecast.p95[idx];
      const chg = (p50 - currentPrice) / currentPrice;
      const isLast = days === horizon;
      html += `<tr${isLast ? ' class="milestone-final"' : ""}>
        <td>${fmtDate(date)}</td>
        <td>${days}</td>
        <td class="negative">${fmtPrice(p5, ticker)}</td>
        <td>${fmtPrice(p50, ticker)}</td>
        <td class="positive">${fmtPrice(p95, ticker)}</td>
        <td class="${chg >= 0 ? "positive" : "negative"}">${fmtPct(chg)}</td>
      </tr>`;
    });

    $("#milestoneBody").innerHTML = html;
  }

  // ── Event bindings ──
  $("#modelSelect").addEventListener("change", updateModelParams);
  $("#predictBtn").addEventListener("click", runPrediction);

  // Also run when any input changes
  ["tickerSelect", "horizonSelect", "histWindow", "simCount", "regrWindow", "emaSpan", "histDisplay", "showBands", "showVolatility"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", runPrediction);
  });

  // ── Init ──
  updateModelParams();
  runPrediction();
})();
