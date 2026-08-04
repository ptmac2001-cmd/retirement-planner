(function () {
  "use strict";

  // ── Account presets ──
  const PRESETS = {
    "401k":           { name: "401(k)",          tax: "pretax",  contribution: 500, matchPct: 50, matchCap: 6, volatility: 15 },
    rothIra:          { name: "Roth IRA",        tax: "roth",    contribution: 500, matchPct: 0,  matchCap: 0, volatility: 15 },
    traditionalIra:   { name: "Traditional IRA", tax: "pretax",  contribution: 400, matchPct: 0,  matchCap: 0, volatility: 15 },
    brokerage:        { name: "Brokerage",       tax: "taxable", contribution: 300, matchPct: 0,  matchCap: 0, volatility: 15 },
    hsa:              { name: "HSA",             tax: "roth",    contribution: 200, matchPct: 0,  matchCap: 0, volatility: 10 },
    custom:           { name: "Custom Account",  tax: "taxable", contribution: 200, matchPct: 0,  matchCap: 0, volatility: 12 },
  };

  const DEFAULT_VOLATILITY = 15;

  const ACCOUNT_COLORS = [
    "#2563eb", "#10b981", "#f59e0b", "#6366f1",
    "#ef4444", "#06b6d4", "#ec4899", "#8b5cf6",
  ];

  let accounts = [];
  let nextId = 1;
  let chart = null;

  // Latest Monte Carlo results ({ bands, successRate, ... }) plus run state
  let mcResults = null;
  let mcRunToken = 0;
  let mcRunning = false;

  // ── DOM refs ──
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const el = {
    birthdate:      $("#birthdate"),
    retirementAge:  $("#retirementAge"),
    lifeExpectancy: $("#lifeExpectancy"),
    annualIncome:   $("#annualIncome"),
    withdrawalStrategy: $("#withdrawalStrategy"),
    monthlyExpenses:$("#monthlyExpenses"),
    withdrawalPct:  $("#withdrawalPct"),
    expensesLabel:  $("#expensesLabel"),
    withdrawalPctLabel: $("#withdrawalPctLabel"),
    inflationRate:  $("#inflationRate"),
    socialSecurity: $("#socialSecurity"),
    ssStartAge:     $("#ssStartAge"),
    taxRate:        $("#taxRate"),
    assetCorrelation: $("#assetCorrelation"),
    mcTrials:       $("#mcTrials"),
    runMcBtn:       $("#runMcBtn"),
    mcProgress:     $("#mcProgress"),
    mcProgressBar:  $("#mcProgressBar"),
    mcEmpty:        $("#mcEmpty"),
    mcStale:        $("#mcStale"),
    mcResultsBox:   $("#mcResults"),
    mcSuccessRate:  $("#mcSuccessRate"),
    mcSuccessNote:  $("#mcSuccessNote"),
    mcMedianEnd:    $("#mcMedianEnd"),
    mcP10End:       $("#mcP10End"),
    mcP10Note:      $("#mcP10Note"),
    mcDepletionAge: $("#mcDepletionAge"),
    mcDepletionNote:$("#mcDepletionNote"),
    accountsList:   $("#accountsList"),
    addBtn:         $("#addAccountBtn"),
    templateSelect: $("#accountTemplate"),
    summaryTotal:   $("#totalAtRetirement"),
    summaryAdj:     $("#inflationAdjusted"),
    summaryIncome:  $("#monthlyIncome"),
    summaryCoverage:$("#yearsCoverage"),
    tableHeader:    $("#tableHeader"),
    tableBody:      $("#tableBody"),
    taxSummary:     $("#taxSummary"),
  };

  // ── Storage Key ──
  const STORAGE_KEY = "retirementPlannerState";

  // ── Helpers ──
  function fmt(n) {
    if (!isFinite(n)) return "$0";
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function getVal(input) {
    return parseFloat(input.value) || 0;
  }

  function getAgeFromBirthdate() {
    const val = el.birthdate.value;
    if (!val) return 0;
    const birth = new Date(val + "T00:00:00");
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  // Returns number of months from today until the user's next birthday
  function getMonthsToNextBirthday() {
    const val = el.birthdate.value;
    if (!val) return 12;
    const birth = new Date(val + "T00:00:00");
    const today = new Date();
    // Next birthday this year or next
    let nextBday = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
    if (nextBday <= today) {
      nextBday = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
    }
    // Difference in months (approximate by counting month boundaries)
    let months = (nextBday.getFullYear() - today.getFullYear()) * 12
               + (nextBday.getMonth() - today.getMonth());
    if (today.getDate() > birth.getDate()) {
      months--;
    }
    return Math.max(months, 1);
  }

  // ── localStorage Persistence ──
  const GLOBAL_INPUTS = [
    "birthdate", "retirementAge", "lifeExpectancy",
    "annualIncome", "withdrawalStrategy", "monthlyExpenses",
    "withdrawalPct", "inflationRate",
    "socialSecurity", "ssStartAge", "taxRate",
    "assetCorrelation", "mcTrials",
  ];

  // Fills in fields added after a save was written, so old saves/exports still load.
  function normalizeAccount(acc) {
    if (typeof acc.volatility !== "number" || !isFinite(acc.volatility)) {
      acc.volatility = DEFAULT_VOLATILITY;
    }
    return acc;
  }

  function updateStrategyVisibility() {
    const strategy = el.withdrawalStrategy.value;
    if (strategy === "fixed") {
      el.expensesLabel.style.display = "";
      el.withdrawalPctLabel.style.display = "none";
    } else if (strategy === "4pct") {
      el.expensesLabel.style.display = "none";
      el.withdrawalPctLabel.style.display = "none";
    } else {
      el.expensesLabel.style.display = "none";
      el.withdrawalPctLabel.style.display = "";
    }
  }

  function saveState() {
    const globals = {};
    GLOBAL_INPUTS.forEach((key) => {
      globals[key] = el[key].value;
    });
    const state = {
      globals,
      accounts,
      nextId,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* storage full or unavailable — ignore */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const state = JSON.parse(raw);

      // Restore global inputs
      if (state.globals) {
        GLOBAL_INPUTS.forEach((key) => {
          if (state.globals[key] !== undefined) {
            el[key].value = state.globals[key];
          }
        });
      }

      // Restore accounts
      if (state.accounts && state.accounts.length > 0) {
        nextId = state.nextId || 1;
        state.accounts.forEach((acc) => {
          accounts.push(normalizeAccount(acc));
          renderAccount(acc);
        });
        return true;
      }
    } catch (e) { /* corrupt data — ignore */ }
    return false;
  }

  // ── Account Management ──
  function addAccount(presetKey) {
    const preset = PRESETS[presetKey] || PRESETS.custom;
    const id = nextId++;
    const acc = {
      id,
      name: preset.name,
      tax: preset.tax,
      balance: 0,
      contribution: preset.contribution,
      matchPct: preset.matchPct,
      matchCap: preset.matchCap,
      annualReturn: 7,
      volatility: preset.volatility,
    };
    accounts.push(acc);
    renderAccount(acc);
    recalculate();
    saveState();
  }

  function removeAccount(id) {
    accounts = accounts.filter((a) => a.id !== id);
    const card = $(`.account-card[data-id="${id}"]`);
    if (card) card.remove();
    recalculate();
    saveState();
  }

  function renderAccount(acc) {
    const tpl = $("#accountTemplate-tpl").content.cloneNode(true);
    const card = tpl.querySelector(".account-card");
    card.dataset.id = acc.id;

    card.querySelector(".account-name-display").textContent = acc.name;
    card.querySelector(".acc-name").value = acc.name;
    card.querySelector(".acc-tax").value = acc.tax;
    card.querySelector(".acc-balance").value = acc.balance;
    card.querySelector(".acc-contribution").value = acc.contribution;
    card.querySelector(".acc-match-pct").value = acc.matchPct;
    card.querySelector(".acc-match-cap").value = acc.matchCap;
    card.querySelector(".acc-return").value = acc.annualReturn;
    card.querySelector(".acc-volatility").value = acc.volatility;

    updateBadge(card, acc.tax);
    updateMatchVisibility(card, acc.tax);

    // Collapse toggle
    card.querySelector(".collapse-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      card.classList.toggle("collapsed");
    });

    card.querySelector(".account-header").addEventListener("click", () => {
      card.classList.toggle("collapsed");
    });

    // Remove
    card.querySelector(".remove-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      removeAccount(acc.id);
    });

    // Input changes
    card.querySelectorAll("input, select").forEach((inp) => {
      inp.addEventListener("input", () => syncAccount(acc.id, card));
    });

    el.accountsList.appendChild(card);
  }

  function syncAccount(id, card) {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return;
    acc.name = card.querySelector(".acc-name").value || "Account";
    acc.tax = card.querySelector(".acc-tax").value;
    acc.balance = getVal(card.querySelector(".acc-balance"));
    acc.contribution = getVal(card.querySelector(".acc-contribution"));
    acc.matchPct = getVal(card.querySelector(".acc-match-pct"));
    acc.matchCap = getVal(card.querySelector(".acc-match-cap"));
    acc.annualReturn = getVal(card.querySelector(".acc-return"));
    acc.volatility = getVal(card.querySelector(".acc-volatility"));

    card.querySelector(".account-name-display").textContent = acc.name;
    updateBadge(card, acc.tax);
    updateMatchVisibility(card, acc.tax);
    recalculate();
    saveState();
  }

  function updateBadge(card, tax) {
    const badge = card.querySelector(".tax-badge");
    badge.className = "tax-badge " + tax;
    const labels = { pretax: "Pre-tax", roth: "Roth", taxable: "Taxable" };
    badge.textContent = labels[tax] || tax;
  }

  function updateMatchVisibility(card, tax) {
    const showMatch = tax === "pretax";
    card.querySelectorAll(".employer-match-field").forEach((f) => {
      f.classList.toggle("hidden", !showMatch);
    });
  }

  // ── Calculation Engine ──
  // Reads every input into a plain snapshot. Returns null when the inputs are
  // not yet coherent (the same guard the old recalculate() used).
  function readConfig() {
    const currentAge = getAgeFromBirthdate();
    const retireAge = getVal(el.retirementAge);
    const lifeExp = getVal(el.lifeExpectancy);

    if (currentAge <= 0 || currentAge >= lifeExp || currentAge >= retireAge) return null;

    return {
      currentAge,
      retireAge,
      lifeExp,
      annualIncome: getVal(el.annualIncome),
      strategy: el.withdrawalStrategy.value,
      monthlyExpenses: getVal(el.monthlyExpenses),
      withdrawalPct: getVal(el.withdrawalPct) / 100,
      inflationPct: getVal(el.inflationRate) / 100,
      ssMonthly: getVal(el.socialSecurity),
      ssStartAge: getVal(el.ssStartAge),
      taxRatePct: getVal(el.taxRate) / 100,
      correlation: Math.min(Math.max(getVal(el.assetCorrelation) / 100, 0), 1),
      totalYears: lifeExp - currentAge,
      yearsToRetire: retireAge - currentAge,
      firstYearMonths: getMonthsToNextBirthday(),
      // Snapshot so a long simulation is not disturbed by edits mid-run
      accounts: accounts.map((a) => ({ ...a })),
    };
  }

  // Runs one full projection path.
  //   opts.draw — (accountIndex, year) => annual growth multiplier. Omit for the
  //               deterministic projection, which uses each account's fixed return.
  //   opts.lean — skip the per-year detail rows (Monte Carlo only needs totals).
  // Returns { yearlyData, totals, depletionAge }.
  function runProjection(cfg, opts) {
    const draw = opts && opts.draw;
    const lean = !!(opts && opts.lean);
    const accs = cfg.accounts;

    const yearlyData = lean ? null : [];
    const totals = new Float64Array(cfg.totalYears + 1);
    let depletionAge = null;

    const balances = {};
    let retirementBalance = 0;
    accs.forEach((a) => { balances[a.id] = a.balance; });

    for (let y = 0; y <= cfg.totalYears; y++) {
      const age = cfg.currentAge + y;
      // Year 1 = partial year (months until next birthday), all others = 12 months
      const monthsThisYear = y === 1 ? cfg.firstYearMonths : 12;

      let yearWithdrawal = 0;

      // Year 0 = current age: record starting balances, no growth yet
      if (y > 0) {
        const isRetired = age > cfg.retireAge;

        if (!isRetired) {
          // Accumulation phase: monthly compounding for this year
          accs.forEach((acc, ai) => {
            const monthlyRate = monthlyRateFor(acc, ai, y, draw);
            let monthlyContrib = acc.contribution;

            // Employer match
            if (acc.tax === "pretax" && acc.matchPct > 0 && acc.matchCap > 0) {
              const monthlySalary = cfg.annualIncome / 12;
              const maxMatchBase = monthlySalary * (acc.matchCap / 100);
              const employeeContribForMatch = Math.min(monthlyContrib, maxMatchBase);
              const match = employeeContribForMatch * (acc.matchPct / 100);
              monthlyContrib += match;
            }

            for (let m = 0; m < monthsThisYear; m++) {
              balances[acc.id] = balances[acc.id] * (1 + monthlyRate) + monthlyContrib;
            }
          });
        } else {
          // Drawdown phase
          const ssActive = age >= cfg.ssStartAge;
          const ssContrib = ssActive ? cfg.ssMonthly : 0;

          // Determine monthly withdrawal based on strategy
          let monthlyNeed;
          if (cfg.strategy === "4pct") {
            // 4% rule: 4% of retirement balance, inflation-adjusted from retirement year
            if (!retirementBalance) {
              retirementBalance = accs.reduce((s, a) => s + Math.max(balances[a.id], 0), 0);
            }
            const yearsInRetirement = age - cfg.retireAge;
            const inflFactor = Math.pow(1 + cfg.inflationPct, yearsInRetirement);
            monthlyNeed = (retirementBalance * 0.04 / 12) * inflFactor - ssContrib;
          } else if (cfg.strategy === "pct") {
            // Custom %: percentage of current portfolio balance each year
            const totalBal = accs.reduce((s, a) => s + Math.max(balances[a.id], 0), 0);
            monthlyNeed = (totalBal * cfg.withdrawalPct / 12) - ssContrib;
          } else {
            // Fixed: inflation-adjusted monthly expenses
            const inflationFactor = Math.pow(1 + cfg.inflationPct, y);
            monthlyNeed = cfg.monthlyExpenses * inflationFactor - ssContrib;
          }
          if (monthlyNeed < 0) monthlyNeed = 0;

          const totalBal = accs.reduce((s, a) => s + Math.max(balances[a.id], 0), 0);

          accs.forEach((acc, ai) => {
            const monthlyRate = monthlyRateFor(acc, ai, y, draw);
            const proportion = totalBal > 0 ? Math.max(balances[acc.id], 0) / totalBal : 0;

            let rawWithdrawal = monthlyNeed * proportion;
            if (acc.tax === "pretax") {
              rawWithdrawal = rawWithdrawal / (1 - cfg.taxRatePct);
            } else if (acc.tax === "taxable") {
              rawWithdrawal = rawWithdrawal / (1 - 0.5 * 0.15);
            }

            yearWithdrawal += rawWithdrawal * monthsThisYear;

            for (let m = 0; m < monthsThisYear; m++) {
              balances[acc.id] = balances[acc.id] * (1 + monthlyRate) - rawWithdrawal;
              if (balances[acc.id] < 0) balances[acc.id] = 0;
            }
          });
        }

        // "Ran out of money" is only meaningful once withdrawals have started
        if (isRetired && depletionAge === null) {
          const remaining = accs.reduce((s, a) => s + balances[a.id], 0);
          if (remaining <= 0) depletionAge = age;
        }
      }

      const inflationFactor = Math.pow(1 + cfg.inflationPct, y);
      const total = accs.reduce((s, a) => s + balances[a.id], 0);
      totals[y] = total;

      if (!lean) {
        yearlyData.push({
          age,
          balances: { ...balances },
          total,
          inflAdj: total / inflationFactor,
          withdrawal: yearWithdrawal,
          inflFactor: inflationFactor,
        });
      }
    }

    return { yearlyData, totals, depletionAge };
  }

  function monthlyRateFor(acc, accountIndex, year, draw) {
    if (!draw) return (acc.annualReturn / 100) / 12;
    // Spread the year's realized growth geometrically across its months, so the
    // realized annual growth is exactly the drawn multiplier — no compounding bias
    // on top of the draw.
    return Math.pow(draw(accountIndex, year), 1 / 12) - 1;
  }

  // The deterministic engine treats the annual return as a nominal rate divided by 12
  // and compounded monthly, so 7% actually grows a balance by 7.23% a year. The
  // simulation draws around that same effective figure rather than the nominal one.
  // That keeps the two models consistent: at 0% volatility every simulated path lands
  // exactly on the deterministic projection.
  function effectiveAnnualReturn(acc) {
    return Math.pow(1 + (acc.annualReturn / 100) / 12, 12) - 1;
  }

  function recalculate() {
    const cfg = readConfig();
    if (!cfg) {
      clearOutputs();
      return;
    }

    const { retireAge, lifeExp, ssMonthly, ssStartAge, taxRatePct, yearsToRetire } = cfg;

    const { yearlyData } = runProjection(cfg);

    // Monte Carlo results describe the inputs as they were when it ran
    markMonteCarloStale(cfg);

    // ── Summaries ──
    const retireIdx = yearsToRetire;
    const retireRow = yearlyData[retireIdx] || yearlyData[yearlyData.length - 1];
    const totalAtRetire = retireRow.total;
    const inflAdj = retireRow.inflAdj;

    // Monthly income from savings (simple: spread over retirement years)
    const retirementYears = lifeExp - retireAge;
    const totalAfterTaxIncome = computeAfterTaxMonthlyIncome(retireRow.balances, retirementYears, taxRatePct, ssMonthly, ssStartAge <= retireAge);

    // Years of coverage: find when total hits 0
    let coverageYears = retirementYears;
    for (let i = retireIdx; i < yearlyData.length; i++) {
      if (yearlyData[i].total <= 0) {
        coverageYears = yearlyData[i].age - retireAge;
        break;
      }
    }

    el.summaryTotal.textContent = fmt(totalAtRetire);
    el.summaryAdj.textContent = fmt(inflAdj);
    el.summaryIncome.textContent = fmt(totalAfterTaxIncome);
    el.summaryCoverage.textContent = coverageYears + (coverageYears >= retirementYears ? "+" : "") + " yrs";

    renderChart(yearlyData, retireAge);
    renderTable(yearlyData, retireAge);
    renderTaxSummary(retireRow.balances, taxRatePct, retirementYears, ssMonthly, ssStartAge <= retireAge);
  }

  function computeAfterTaxMonthlyIncome(balances, retirementYears, taxRate, ssMonthly, ssActive) {
    const totalMonths = retirementYears * 12;
    if (totalMonths <= 0) return ssActive ? ssMonthly : 0;

    let monthlyIncome = 0;
    accounts.forEach((acc) => {
      const bal = balances[acc.id] || 0;
      const gross = bal / totalMonths;
      if (acc.tax === "pretax") {
        monthlyIncome += gross * (1 - taxRate);
      } else if (acc.tax === "roth") {
        monthlyIncome += gross;
      } else {
        // Taxable: ~50% gains taxed at 15%
        monthlyIncome += gross * (1 - 0.5 * 0.15);
      }
    });

    if (ssActive) monthlyIncome += ssMonthly;
    return monthlyIncome;
  }

  // ── Monte Carlo ──
  // Fixed seed: re-running with unchanged inputs gives the same answer instead of
  // a success rate that wobbles a point every click.
  const MC_SEED = 0x9e3779b9;
  const MC_BATCH = 200;

  // mulberry32 + Box–Muller. Small, seedable, and plenty for this.
  function makeRng(seed) {
    let s = seed >>> 0;
    let spare = null;

    function next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    return {
      normal() {
        if (spare !== null) {
          const v = spare;
          spare = null;
          return v;
        }
        let u = 0, v = 0;
        while (u === 0) u = next();
        while (v === 0) v = next();
        const mag = Math.sqrt(-2 * Math.log(u));
        spare = mag * Math.sin(2 * Math.PI * v);
        return mag * Math.cos(2 * Math.PI * v);
      },
    };
  }

  // One year's growth multiplier, drawn lognormally so a bad year can never drive a
  // balance below zero the way a raw normal draw would allow. Moment-matched: the
  // draw's mean is 1 + the account's expected return and its std dev is the
  // account's volatility.
  function lognormalGrowth(mu, sigma, z) {
    const mean = 1 + mu;
    if (sigma <= 0 || mean <= 0) return Math.max(mean, 0);
    const varLog = Math.log(1 + (sigma * sigma) / (mean * mean));
    return Math.exp(Math.log(mean) - varLog / 2 + Math.sqrt(varLog) * z);
  }

  // Correlated draws: one market factor shared by every account each year, plus an
  // account-specific shock. Weighting by sqrt(rho)/sqrt(1-rho) makes the pairwise
  // correlation between any two accounts exactly rho. Drawing each account
  // independently instead would hand the portfolio free diversification and
  // overstate the success rate.
  function makeDraw(cfg, rng) {
    const wMarket = Math.sqrt(cfg.correlation);
    const wIdio = Math.sqrt(1 - cfg.correlation);
    let cachedYear = -1;
    let cachedGrowth = [];

    return function (accountIndex, year) {
      if (year !== cachedYear) {
        const zMarket = rng.normal();
        cachedGrowth = cfg.accounts.map((acc) => {
          const z = wMarket * zMarket + wIdio * rng.normal();
          return lognormalGrowth(effectiveAnnualReturn(acc), (acc.volatility || 0) / 100, z);
        });
        cachedYear = year;
      }
      return cachedGrowth[accountIndex];
    };
  }

  function percentileOf(sorted, p) {
    const n = sorted.length;
    if (n === 0) return 0;
    if (n === 1) return sorted[0];
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function setMcProgress(frac) {
    el.mcProgressBar.style.width = (frac * 100).toFixed(1) + "%";
  }

  // Trials run in batches yielding to the event loop between them, so the UI stays
  // responsive and the progress bar moves. A Web Worker would be the usual home for
  // this, but workers are blocked on file:// origins and this app is meant to run by
  // opening index.html directly.
  function runMonteCarlo() {
    if (mcRunning) return;

    const cfg = readConfig();
    if (!cfg || cfg.accounts.length === 0) return;

    const trials = parseInt(el.mcTrials.value, 10) || 5000;
    const years = cfg.totalYears + 1;
    const signature = JSON.stringify(cfg);
    const token = ++mcRunToken;
    const rng = makeRng(MC_SEED);

    const totalsByYear = [];
    for (let y = 0; y < years; y++) totalsByYear.push(new Float64Array(trials));
    const depletionAges = [];
    let successes = 0;
    let i = 0;

    mcRunning = true;
    el.runMcBtn.disabled = true;
    el.runMcBtn.textContent = "Running…";
    el.mcProgress.hidden = false;
    el.mcStale.hidden = true;
    setMcProgress(0);

    function step() {
      if (token !== mcRunToken) return; // superseded by a newer run

      const end = Math.min(i + MC_BATCH, trials);
      for (; i < end; i++) {
        const path = runProjection(cfg, { draw: makeDraw(cfg, rng), lean: true });
        for (let y = 0; y < years; y++) totalsByYear[y][i] = path.totals[y];
        if (path.depletionAge === null) successes++;
        else depletionAges.push(path.depletionAge);
      }

      setMcProgress(i / trials);
      if (i < trials) {
        setTimeout(step, 0);
        return;
      }
      finish();
    }

    function finish() {
      const p10 = [], p50 = [], p90 = [];
      for (let y = 0; y < years; y++) {
        const col = totalsByYear[y];
        col.sort(); // typed arrays sort numerically
        p10.push(percentileOf(col, 0.10));
        p50.push(percentileOf(col, 0.50));
        p90.push(percentileOf(col, 0.90));
      }
      depletionAges.sort((a, b) => a - b);

      mcResults = {
        trials,
        successRate: successes / trials,
        failures: trials - successes,
        medianDepletionAge: depletionAges.length
          ? depletionAges[Math.floor(depletionAges.length / 2)]
          : null,
        lifeExp: cfg.lifeExp,
        p10, p50, p90,
        signature,
        stale: false,
      };

      mcRunning = false;
      el.runMcBtn.disabled = false;
      el.runMcBtn.textContent = "Run Simulation";
      el.mcProgress.hidden = true;

      // Inputs may have been edited while the run was in flight
      markMonteCarloStale(readConfig());
      renderMonteCarlo();
      renderChart(runProjection(cfg).yearlyData, cfg.retireAge);
    }

    setTimeout(step, 0);
  }

  function markMonteCarloStale(cfg) {
    if (!mcResults) return;
    mcResults.stale = !cfg || JSON.stringify(cfg) !== mcResults.signature;
    el.mcStale.hidden = !mcResults.stale;
  }

  function renderMonteCarlo() {
    if (!mcResults) {
      el.mcResultsBox.hidden = true;
      el.mcEmpty.hidden = false;
      el.mcStale.hidden = true;
      return;
    }

    const r = mcResults;
    const n = (v) => v.toLocaleString("en-US");
    el.mcEmpty.hidden = true;
    el.mcResultsBox.hidden = false;
    el.mcStale.hidden = !r.stale;

    const pct = r.successRate * 100;
    el.mcSuccessRate.textContent = pct.toFixed(1) + "%";

    const primary = el.mcResultsBox.querySelector(".mc-stat-primary");
    primary.classList.remove("level-good", "level-fair", "level-poor");
    primary.classList.add(pct >= 85 ? "level-good" : pct >= 70 ? "level-fair" : "level-poor");
    el.mcSuccessNote.textContent =
      `${n(r.trials - r.failures)} of ${n(r.trials)} simulated paths still had money at age ${r.lifeExp}`;

    el.mcMedianEnd.textContent = fmt(r.p50[r.p50.length - 1]);

    const p10End = r.p10[r.p10.length - 1];
    el.mcP10End.textContent = fmt(p10End);
    // "1 in 10 end below this" reads wrong at $0 — nothing ends below zero
    el.mcP10Note.textContent = p10End > 0
      ? "1 in 10 outcomes end below this"
      : `More than 1 in 10 paths ran out entirely (${(r.failures / r.trials * 100).toFixed(1)}%)`;

    if (r.medianDepletionAge === null) {
      el.mcDepletionAge.textContent = "—";
      el.mcDepletionNote.textContent = "No simulated path ran out of money";
    } else {
      el.mcDepletionAge.textContent = r.medianDepletionAge;
      el.mcDepletionNote.textContent = `Median across the ${n(r.failures)} paths that ran out`;
    }
  }

  function clearOutputs() {
    el.summaryTotal.textContent = "$0";
    el.summaryAdj.textContent = "$0";
    el.summaryIncome.textContent = "$0";
    el.summaryCoverage.textContent = "0 yrs";
    el.tableBody.innerHTML = "";
    el.tableHeader.innerHTML = "";
    el.taxSummary.innerHTML = "";
    if (chart) { chart.destroy(); chart = null; }
    // Any simulation on screen described inputs that are no longer valid
    mcRunToken++;
    mcRunning = false;
    mcResults = null;
    el.runMcBtn.disabled = false;
    el.runMcBtn.textContent = "Run Simulation";
    el.mcProgress.hidden = true;
    renderMonteCarlo();
  }

  // ── Chart ──
  function renderChart(data, retireAge) {
    const ctx = document.getElementById("projectionChart");
    const labels = data.map((d) => d.age);

    const datasets = [];

    // Simulated range first so the band renders behind the projection lines.
    // The shaded band covers the downside — 10th percentile up to the median — because
    // that is the half the success rate is about. The 90th percentile is off by
    // default: over decades its upper tail runs several times higher than every other
    // series and flattens the whole chart against the axis. Click it in the legend to
    // bring it in (hidden datasets are excluded from the axis scale).
    if (mcResults && mcResults.p50.length === data.length) {
      datasets.push({
        label: "Median (simulated)",
        data: mcResults.p50,
        borderColor: "#6366f1",
        backgroundColor: "rgba(99, 102, 241, 0.14)",
        borderWidth: 2,
        pointRadius: 0,
        fill: "+1", // shade down to the 10th percentile line that follows
        tension: 0.3,
      });
      datasets.push({
        label: "10th percentile",
        data: mcResults.p10,
        borderColor: "rgba(99, 102, 241, 0.45)",
        backgroundColor: "transparent",
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      });
      datasets.push({
        label: "90th percentile",
        data: mcResults.p90,
        borderColor: "rgba(99, 102, 241, 0.45)",
        backgroundColor: "transparent",
        borderWidth: 1,
        borderDash: [2, 3],
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        hidden: true,
      });
    }

    accounts.forEach((acc, i) => datasets.push({
      label: acc.name,
      data: data.map((d) => Math.max(d.balances[acc.id] || 0, 0)),
      borderColor: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
      backgroundColor: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] + "20",
      borderWidth: 1.5,
      borderDash: [6, 3],
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    }));

    datasets.push({
      label: "Total",
      data: data.map((d) => Math.max(d.total, 0)),
      borderColor: "#18181b",
      backgroundColor: "rgba(24,24,27,0.06)",
      borderWidth: 2.5,
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    });

    // Dummy dataset so "Retirement" appears in the legend
    datasets.push({
      label: "Retirement Age",
      data: [],
      borderColor: "#ef4444",
      backgroundColor: "#ef4444",
      borderWidth: 2,
      borderDash: [5, 5],
      pointRadius: 0,
      fill: false,
    });

    const chartConfig = {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          tooltip: {
            filter: (item) => item.dataset.label !== "Retirement Age",
            callbacks: {
              label: (ctx) => ctx.dataset.label + ": " + fmt(ctx.parsed.y),
            },
          },
          legend: {
            align: "center",
            labels: {
              color: "#3f3f46",
              generateLabels(chartInstance) {
                const defaultLabels = Chart.defaults.plugins.legend.labels.generateLabels(chartInstance);
                return defaultLabels.map((label) => {
                  label.pointStyle = "line";
                  if (label.text === "Retirement Age") {
                    label.lineDash = [5, 5];
                    label.strokeStyle = "#ef4444";
                    label.fillStyle = "transparent";
                  }
                  return label;
                });
              },
              usePointStyle: true,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Age", color: "#71717a" },
            ticks: { maxTicksLimit: 15, color: "#71717a" },
            grid: { color: "rgba(9,9,11,0.06)" },
          },
          y: {
            title: { display: true, text: "Portfolio Value", color: "#71717a" },
            ticks: {
              callback: (v) => fmt(v),
              color: "#71717a",
            },
            grid: { color: "rgba(9,9,11,0.06)" },
            min: 0,
          },
        },
      },
      plugins: [{
        id: "retirementLine",
        afterDraw(chartInstance) {
          const xScale = chartInstance.scales.x;
          const chartLabels = chartInstance.data.labels;
          const idx = chartLabels.indexOf(retireAge);
          if (idx < 0) return;
          const x = xScale.getPixelForValue(idx);
          const yScale = chartInstance.scales.y;
          const drawCtx = chartInstance.ctx;
          drawCtx.save();
          drawCtx.strokeStyle = "#ef4444";
          drawCtx.lineWidth = 2;
          drawCtx.setLineDash([5, 5]);
          drawCtx.beginPath();
          drawCtx.moveTo(x, yScale.top);
          drawCtx.lineTo(x, yScale.bottom);
          drawCtx.stroke();
          drawCtx.restore();
        },
      }],
    };

    if (chart) {
      chart.destroy();
    }
    chart = new Chart(ctx, chartConfig);
  }

  // ── Table ──
  // Name-based account groups for subtotals
  const ACCOUNT_GROUPS = ["Peter", "Lisa"];

  function getGroupTotal(balances, prefix) {
    return accounts
      .filter((a) => a.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .reduce((s, a) => s + (balances[a.id] || 0), 0);
  }

  function renderTable(data, retireAge) {
    // Header
    let headerHTML = "<th>Age</th>";
    ACCOUNT_GROUPS.forEach((g) => { headerHTML += `<th>${g} Total</th>`; });
    headerHTML += "<th>Grand Total</th><th>Inf Adj Tot</th><th>Withdrawals</th><th>Inf Adj Withdrawals</th>";
    el.tableHeader.innerHTML = headerHTML;

    // Body
    let bodyHTML = "";
    data.forEach((row) => {
      const cls = row.age === retireAge ? ' class="retirement-row"' : "";
      bodyHTML += `<tr${cls}><td>${row.age}</td>`;
      ACCOUNT_GROUPS.forEach((g) => {
        bodyHTML += `<td>${fmt(getGroupTotal(row.balances, g))}</td>`;
      });
      const wd = row.withdrawal > 0 ? fmt(row.withdrawal) : "—";
      const inflAdjWd = row.withdrawal > 0 ? fmt(row.withdrawal / row.inflFactor) : "—";
      bodyHTML += `<td>${fmt(row.total)}</td><td>${fmt(row.inflAdj)}</td><td>${wd}</td><td>${inflAdjWd}</td></tr>`;
    });
    el.tableBody.innerHTML = bodyHTML;
  }

  // ── Tax Summary ──
  function renderTaxSummary(balances, taxRate, retirementYears, ssMonthly, ssActive) {
    const groups = { pretax: 0, roth: 0, taxable: 0 };
    accounts.forEach((acc) => {
      groups[acc.tax] = (groups[acc.tax] || 0) + (balances[acc.id] || 0);
    });
    const total = groups.pretax + groups.roth + groups.taxable;

    const totalMonths = retirementYears * 12;

    const pretaxMonthly = totalMonths > 0 ? groups.pretax / totalMonths : 0;
    const rothMonthly = totalMonths > 0 ? groups.roth / totalMonths : 0;
    const taxableMonthly = totalMonths > 0 ? groups.taxable / totalMonths : 0;

    const taxOnPretax = pretaxMonthly * taxRate;
    const taxOnTaxable = taxableMonthly * 0.5 * 0.15;
    const totalTax = taxOnPretax + taxOnTaxable;
    const afterTaxIncome = pretaxMonthly - taxOnPretax + rothMonthly + taxableMonthly - taxOnTaxable + (ssActive ? ssMonthly : 0);

    el.taxSummary.innerHTML = `
      <div class="tax-group">
        <h3 style="color: var(--clr-pretax)">Pre-tax</h3>
        <div class="amount">${fmt(groups.pretax)}</div>
        <div class="detail">${total > 0 ? ((groups.pretax / total) * 100).toFixed(1) : 0}% of portfolio</div>
        <div class="detail">Taxed at ${(taxRate * 100).toFixed(0)}% on withdrawal</div>
      </div>
      <div class="tax-group">
        <h3 style="color: var(--clr-roth)">Roth / Post-tax</h3>
        <div class="amount">${fmt(groups.roth)}</div>
        <div class="detail">${total > 0 ? ((groups.roth / total) * 100).toFixed(1) : 0}% of portfolio</div>
        <div class="detail">Tax-free withdrawals</div>
      </div>
      <div class="tax-group">
        <h3 style="color: var(--clr-taxable)">Taxable</h3>
        <div class="amount">${fmt(groups.taxable)}</div>
        <div class="detail">${total > 0 ? ((groups.taxable / total) * 100).toFixed(1) : 0}% of portfolio</div>
        <div class="detail">Est. 15% on ~50% gains</div>
      </div>
      <div class="tax-group tax-impact">
        <h3>Monthly Tax Impact</h3>
        <div class="amount">${fmt(afterTaxIncome)} <span style="font-size:0.75rem;font-weight:400;color:var(--clr-text-muted)">/ month after tax</span></div>
        <div class="detail">Estimated monthly taxes: ${fmt(totalTax)}</div>
        <div class="detail">Includes Social Security: ${ssActive ? fmt(ssMonthly) : "not yet started"}</div>
      </div>
    `;
  }

  // ── Export / Import ──
  function exportData() {
    const globals = {};
    GLOBAL_INPUTS.forEach((key) => {
      globals[key] = el[key].value;
    });
    const data = { globals, accounts, nextId };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const now = new Date();
    const dateSuffix = `${now.getMonth() + 1}_${now.getDate()}_${now.getFullYear()}`;
    a.download = `retirement-planner-data_${dateSuffix}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.accounts || !data.globals) {
          alert("Invalid file format.");
          return;
        }
        // Restore globals
        GLOBAL_INPUTS.forEach((key) => {
          if (data.globals[key] !== undefined) {
            el[key].value = data.globals[key];
          }
        });
        // Clear existing accounts
        accounts = [];
        el.accountsList.innerHTML = "";
        // Restore accounts
        nextId = data.nextId || 1;
        data.accounts.forEach((acc) => {
          accounts.push(normalizeAccount(acc));
          renderAccount(acc);
        });
        updateStrategyVisibility();
        recalculate();
        saveState();
      } catch (err) {
        alert("Could not read file: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ── Event Binding ──
  el.addBtn.addEventListener("click", () => {
    addAccount(el.templateSelect.value);
  });

  $("#exportBtn").addEventListener("click", exportData);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) {
      importData(e.target.files[0]);
      e.target.value = "";
    }
  });

  el.withdrawalStrategy.addEventListener("change", () => {
    updateStrategyVisibility();
    recalculate();
    saveState();
  });

  el.runMcBtn.addEventListener("click", runMonteCarlo);

  // Trial count lives outside the input panel, so it needs its own save hook
  el.mcTrials.addEventListener("change", saveState);

  // Recalculate on any global input change
  document.querySelectorAll(".input-panel input, .input-panel select").forEach((inp) => {
    if (!inp.closest(".account-card")) {
      inp.addEventListener("input", () => {
        recalculate();
        saveState();
      });
    }
  });

  // ── Init: load saved state or add a default 401(k) ──
  const loaded = loadState();
  if (!loaded) {
    addAccount("401k");
  }
  updateStrategyVisibility();
  recalculate();
  renderMonteCarlo();
})();
