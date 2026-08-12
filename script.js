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

  let accounts = [];
  let nextId = 1;

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
    globalReturnEnabled: $("#globalReturnEnabled"),
    globalReturn:   $("#globalReturn"),
    globalReturnLabel: $("#globalReturnLabel"),
    ownerNames:     $("#ownerNames"),

    mcTrials:       $("#mcTrials"),
    runMcBtn:       $("#runMcBtn"),
    mcState:        $("#mcState"),
    mcProgress:     $("#mcProgress"),
    mcProgressBar:  $("#mcProgressBar"),
    mcSuccessRate:  $("#mcSuccessRate"),
    mcSuccessNote:  $("#mcSuccessNote"),

    accountsList:   $("#accountsList"),
    addBtn:         $("#addAccountBtn"),
    templateSelect: $("#accountTemplate"),

    digest:         $("#digest"),
    filedFor:       $("#filedFor"),
    summaryTotal:   $("#totalAtRetirement"),
    summaryAdj:     $("#inflationAdjusted"),
    summaryIncome:  $("#monthlyIncome"),

    plot:           $("#plot"),
    chartSvg:       $("#projectionChart"),
    chartLegend:    $("#chartLegend"),
    tip:            $("#plot .tip"),
    hit:            $("#plot .hit"),

    taxBar:         $("#taxBar"),
    taxRows:        $("#taxRows"),
    taxNote:        $("#taxNote"),
    tableA:         $("#yearTableA"),
    tableB:         $("#yearTableB"),

    btnPlan:        $("#btnPlan"),
    btnAccounts:    $("#btnAccounts"),
    drawerPlan:     $("#drawerPlan"),
    drawerAccounts: $("#drawerAccounts"),
  };

  // The account line colours, read from the stylesheet so the palette lives
  // in one place instead of being duplicated in JS.
  const ACCOUNT_COLORS = (() => {
    const cs = getComputedStyle(document.documentElement);
    return [1, 2, 3, 4, 5, 6, 7, 8]
      .map((n) => cs.getPropertyValue("--s" + n).trim())
      .filter(Boolean);
  })();

  function inkVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }


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

  // Account and owner names are user text that ends up inside innerHTML strings
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
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
    "assetCorrelation", "mcTrials", "globalReturn",
  ];

  // Checkboxes carry state in .checked, not .value, so they save/load separately.
  const GLOBAL_CHECKBOXES = ["globalReturnEnabled"];

  // Fills in fields added after a save was written, so old saves/exports still load.
  function normalizeAccount(acc) {
    if (typeof acc.volatility !== "number" || !isFinite(acc.volatility)) {
      acc.volatility = DEFAULT_VOLATILITY;
    }
    if (typeof acc.owner !== "string") {
      // Saves written before accounts had an owner encoded the person in the
      // account name ("<name> 401(k)"), which is what the old per-person subtotal
      // columns matched on. Lift that prefix into a real owner field so those
      // subtotals keep working instead of silently reading $0.
      //
      // Matched structurally — a leading word followed by a recognised account
      // type — rather than against a list of names, so this works for any
      // household and keeps no one's name in the source.
      const m = /^([A-Za-z][A-Za-z.'-]*)\s+(.*\S)$/.exec(acc.name || "");
      if (m && isKnownAccountType(m[2])) {
        acc.owner = m[1];
        acc.name = m[2];
      } else {
        acc.owner = "";
      }
    }
    if (typeof acc.collapsed !== "boolean") acc.collapsed = false;
    return acc;
  }

  // The account names the presets ship with, used to spot a legacy
  // "<owner> <account>" name without hard-coding anyone's name.
  const PRESET_NAMES = Object.keys(PRESETS).map((k) => PRESETS[k].name.toLowerCase());

  function isKnownAccountType(name) {
    return PRESET_NAMES.includes(name.trim().toLowerCase());
  }

  const UNASSIGNED = "Unassigned";

  function ownerLabel(owner) {
    return owner && owner.trim() ? owner.trim() : UNASSIGNED;
  }

  // Distinct owners in the order their accounts appear.
  function distinctOwners() {
    const seen = [];
    accounts.forEach((a) => {
      const label = ownerLabel(a.owner);
      if (!seen.includes(label)) seen.push(label);
    });
    return seen;
  }

  function updateStrategyVisibility() {
    const strategy = el.withdrawalStrategy.value;
    el.expensesLabel.hidden = strategy !== "fixed";
    el.withdrawalPctLabel.hidden = strategy !== "pct";
  }

  function saveState() {
    const globals = {};
    GLOBAL_INPUTS.forEach((key) => {
      globals[key] = el[key].value;
    });
    GLOBAL_CHECKBOXES.forEach((key) => {
      globals[key] = el[key].checked;
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
        GLOBAL_CHECKBOXES.forEach((key) => {
          if (state.globals[key] !== undefined) {
            el[key].checked = !!state.globals[key];
          }
        });
      }

      // Restore accounts
      if (state.accounts && state.accounts.length > 0) {
        nextId = state.nextId || 1;
        state.accounts.forEach((acc) => accounts.push(normalizeAccount(acc)));
        renderAccountsList();
        return true;
      }
    } catch (e) { /* corrupt data — ignore */ }
    return false;
  }

  // ── Account Management ──
  // Adding three 401(k)s used to leave three cards all reading "401(k)", with no way
  // to tell them apart in the header, the chart legend, or the table.
  function uniqueName(base) {
    const taken = accounts.map((a) => a.name);
    if (!taken.includes(base)) return base;
    let n = 2;
    while (taken.includes(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  function addAccount(presetKey) {
    const preset = PRESETS[presetKey] || PRESETS.custom;
    const id = nextId++;
    const acc = {
      id,
      name: uniqueName(preset.name),
      // New accounts inherit the last owner used, so filling out one person's
      // accounts back to back does not mean retyping their name every time.
      owner: accounts.length ? accounts[accounts.length - 1].owner : "",
      tax: preset.tax,
      balance: 0,
      contribution: preset.contribution,
      matchPct: preset.matchPct,
      matchCap: preset.matchCap,
      annualReturn: 7,
      volatility: preset.volatility,
      collapsed: false,
    };
    accounts.push(acc);
    renderAccountsList();
    recalculate();
    saveState();
  }

  function removeAccount(id) {
    accounts = accounts.filter((a) => a.id !== id);
    renderAccountsList();
    recalculate();
    saveState();
  }

  // Rebuilds the whole list, grouped by owner. Called on add/remove and whenever an
  // owner name is committed — never on every keystroke, which would steal focus.
  function renderAccountsList() {
    el.accountsList.innerHTML = "";

    if (accounts.length === 0) {
      el.accountsList.innerHTML =
        '<p class="empty-note">No accounts yet. Pick a type below and add one to start the projection.</p>';
      refreshOwnerDatalist();
      return;
    }

    const owners = distinctOwners();
    const showGroups = owners.length > 1;

    owners.forEach((owner) => {
      if (showGroups) {
        const hd = document.createElement("div");
        hd.className = "owner-hd";
        hd.textContent = owner;
        el.accountsList.appendChild(hd);
      }
      accounts
        .filter((a) => ownerLabel(a.owner) === owner)
        .forEach((acc) => el.accountsList.appendChild(buildAccountCard(acc, showGroups)));
    });

    refreshOwnerDatalist();
  }

  function refreshOwnerDatalist() {
    el.ownerNames.innerHTML = distinctOwners()
      .filter((o) => o !== UNASSIGNED)
      .map((o) => `<option value="${escapeHtml(o)}"></option>`)
      .join("");
  }

  function buildAccountCard(acc, inOwnerGroup) {
    const tpl = $("#accountTemplate-tpl").content.cloneNode(true);
    const card = tpl.querySelector(".acct");
    const idx = accounts.indexOf(acc);
    card.dataset.id = acc.id;
    card.dataset.open = String(!acc.collapsed && accounts.length <= 2);
    card.style.setProperty("--sc", ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length]);

    const head = card.querySelector(".acct-head");
    head.setAttribute("aria-expanded", card.dataset.open);

    card.querySelector(".account-name-display").textContent = acc.name;
    card.querySelector(".acc-name").value = acc.name;
    card.querySelector(".acc-owner").value = acc.owner;
    card.querySelector(".acc-tax").value = acc.tax;
    card.querySelector(".acc-balance").value = acc.balance;
    card.querySelector(".acc-contribution").value = acc.contribution;
    card.querySelector(".acc-match-pct").value = acc.matchPct;
    card.querySelector(".acc-match-cap").value = acc.matchCap;
    card.querySelector(".acc-return").value = acc.annualReturn;
    card.querySelector(".acc-volatility").value = acc.volatility;
    card.querySelector(".amt").textContent = fmt(acc.balance);

    updateBadge(card, acc.tax);
    updateMatchVisibility(card, acc.tax);
    updateReturnOverrideUI(card);

    head.addEventListener("click", () => {
      const open = card.dataset.open !== "true";
      card.dataset.open = String(open);
      head.setAttribute("aria-expanded", String(open));
      acc.collapsed = !open;
      saveState();
    });

    card.querySelector(".remove-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      removeAccount(acc.id);
    });

    card.querySelectorAll("input, select").forEach((inp) => {
      inp.addEventListener("input", () => syncAccount(acc.id, card));
    });

    // Committing an owner name can move this card into a different group
    card.querySelector(".acc-owner").addEventListener("change", () => {
      syncAccount(acc.id, card);
      renderAccountsList();
    });

    return card;
  }

  function syncAccount(id, card) {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return;
    acc.name = card.querySelector(".acc-name").value || "Account";
    acc.owner = card.querySelector(".acc-owner").value.trim();
    acc.tax = card.querySelector(".acc-tax").value;
    acc.balance = getVal(card.querySelector(".acc-balance"));
    acc.contribution = getVal(card.querySelector(".acc-contribution"));
    acc.matchPct = getVal(card.querySelector(".acc-match-pct"));
    acc.matchCap = getVal(card.querySelector(".acc-match-cap"));
    // While the override is on, the return input displays the global rate. Reading it
    // back would overwrite — and permanently lose — the account's own rate.
    if (globalReturnOverride() === null) {
      acc.annualReturn = getVal(card.querySelector(".acc-return"));
    }
    acc.volatility = getVal(card.querySelector(".acc-volatility"));

    card.querySelector(".account-name-display").textContent = acc.name;
    card.querySelector(".amt").textContent = fmt(acc.balance);
    updateBadge(card, acc.tax);
    updateMatchVisibility(card, acc.tax);
    refreshOwnerDatalist();
    recalculate();
    saveState();
  }

  function updateOwnerChip() { /* owner is shown as a group heading now */ }

  function updateBadge(card, tax) {
    const labels = { pretax: "Pre-tax", roth: "Roth", taxable: "Taxable" };
    card.querySelector(".tax-badge").textContent = labels[tax] || tax;
  }

  function updateMatchVisibility(card, tax) {
    const showMatch = tax === "pretax";
    card.querySelectorAll(".employer-match-field").forEach((f) => {
      f.classList.toggle("hidden", !showMatch);
    });
  }

  // ── Global return override ──
  // Returns the return (%) every account should use, or null to use each account's own.
  function globalReturnOverride() {
    if (!el.globalReturnEnabled.checked) return null;
    const v = parseFloat(el.globalReturn.value);
    return isFinite(v) ? v : null;
  }

  // The per-account return input stays visible but goes read-only while the override
  // is on, so the number on screen never contradicts the number being projected.
  function updateReturnOverrideUI(card) {
    const override = globalReturnOverride();
    const input = card.querySelector(".acc-return");
    const note = card.querySelector(".override-note");
    input.disabled = override !== null;
    input.classList.toggle("is-overridden", override !== null);
    note.hidden = override === null;
    if (note.hidden) {
      const acc = accounts.find((a) => String(a.id) === card.dataset.id);
      if (acc) input.value = acc.annualReturn;
    } else {
      input.value = override;
    }
  }

  function applyReturnOverrideToCards() {
    $$(".acct").forEach(updateReturnOverrideUI);
  }

  // ── Calculation Engine ──
  // Reads every input into a plain snapshot. Returns null when the inputs are
  // not yet coherent (the same guard the old recalculate() used).
  function readConfig() {
    const currentAge = getAgeFromBirthdate();
    const retireAge = getVal(el.retirementAge);
    const lifeExp = getVal(el.lifeExpectancy);

    if (currentAge <= 0 || currentAge >= lifeExp || currentAge >= retireAge) return null;

    // Applying the override here means every downstream consumer — the deterministic
    // projection, the Monte Carlo draws, the income estimate — picks it up for free.
    const override = globalReturnOverride();

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
      returnOverride: override,
      // Snapshot so a long simulation is not disturbed by edits mid-run
      accounts: accounts.map((a) => ({
        ...a,
        annualReturn: override !== null ? override : a.annualReturn,
      })),
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
      let yearTax = 0;

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

          // "fixed" states a spending need — money the retiree must have left after
          // tax — so the withdrawal has to be grossed up to cover the tax bill. The
          // 4% rule and custom-% strategies instead state a share of the balance,
          // which is already a gross withdrawal; grossing those up again charged the
          // tax twice and drained the portfolio faster than the strategy calls for.
          const needIsGross = cfg.strategy !== "fixed";

          accs.forEach((acc, ai) => {
            const monthlyRate = monthlyRateFor(acc, ai, y, draw);
            const proportion = totalBal > 0 ? Math.max(balances[acc.id], 0) / totalBal : 0;

            const share = monthlyNeed * proportion;
            const rate = effectiveTaxRate(acc, cfg.taxRatePct);
            const rawWithdrawal = needIsGross ? share : share / (1 - rate);

            yearWithdrawal += rawWithdrawal * monthsThisYear;
            yearTax += rawWithdrawal * rate * monthsThisYear;

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
          tax: yearTax,
          inflFactor: inflationFactor,
        });
      }
    }

    return { yearlyData, totals, depletionAge };
  }

  // Share of a withdrawal lost to tax, by account type.
  //   pre-tax  — never taxed going in, so every dollar out is ordinary income
  //   roth     — taxed going in, so withdrawals come out clean
  //   taxable  — only the gain is taxed; assume ~50% of the balance is gain, at 15%
  const TAXABLE_GAIN_FRACTION = 0.5;
  const CAP_GAINS_RATE = 0.15;

  function effectiveTaxRate(acc, taxRatePct) {
    if (acc.tax === "pretax") return taxRatePct;
    if (acc.tax === "taxable") return TAXABLE_GAIN_FRACTION * CAP_GAINS_RATE;
    return 0;
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

    const { retireAge, lifeExp, yearsToRetire } = cfg;

    const { yearlyData } = runProjection(cfg);

    // Monte Carlo results describe the inputs as they were when it ran
    markMonteCarloStale(cfg);

    // ── Summaries ──
    const retireIdx = yearsToRetire;
    const retireRow = yearlyData[retireIdx] || yearlyData[yearlyData.length - 1];
    const totalAtRetire = retireRow.total;
    const inflAdj = retireRow.inflAdj;

    // Sustainable monthly income from savings, in today's dollars
    const retirementYears = lifeExp - retireAge;
    const income = computeRetirementIncome(retireRow.balances, cfg, retireRow.inflFactor);

    el.summaryTotal.textContent = fmt(totalAtRetire);
    el.summaryAdj.textContent = fmt(inflAdj);
    el.summaryIncome.textContent = fmt(income.netMonthly);
    renderDigest(cfg);

    renderChart(yearlyData, retireAge);
    renderTable(yearlyData, retireAge);
    renderTaxSummary(cfg, income);
  }

  // What a balance can pay out each month, in today's dollars, if it keeps earning its
  // return through retirement and is drawn down to zero over `months`.
  //
  // The previous estimate was simply balance / months. That assumed the portfolio stops
  // growing the day you retire and that a dollar paid out in year 25 is worth the same
  // as one paid out in year 1 — so it both understated sustainable income and quietly
  // disagreed with the year-by-year projection right below it on the page.
  function annuityMonthlyPayment(balance, annualReturnPct, inflationPct, months) {
    if (months <= 0 || balance <= 0) return 0;
    const realAnnual = (1 + annualReturnPct / 100) / (1 + inflationPct) - 1;
    const r = realAnnual / 12;
    if (Math.abs(r) < 1e-9) return balance / months;
    return (balance * r) / (1 - Math.pow(1 + r, -months));
  }

  // Sustainable monthly retirement income in today's dollars, split by tax treatment.
  function computeRetirementIncome(balances, cfg, toToday) {
    const months = Math.max(cfg.lifeExp - cfg.retireAge, 0) * 12;
    // Payments come out in retirement-year dollars; divide through by the
    // inflation factor to retirement so they are quoted in today's money like
    // everything else. Skipping this overstates income badly on a long runway.
    const k = toToday || 1;
    const byTax = {
      pretax:  { balance: 0, gross: 0, tax: 0, net: 0 },
      roth:    { balance: 0, gross: 0, tax: 0, net: 0 },
      taxable: { balance: 0, gross: 0, tax: 0, net: 0 },
    };

    cfg.accounts.forEach((acc) => {
      const bucket = byTax[acc.tax] || byTax.taxable;
      const balance = balances[acc.id] || 0;
      const gross = annuityMonthlyPayment(balance, acc.annualReturn, cfg.inflationPct, months) / k;
      const tax = gross * effectiveTaxRate(acc, cfg.taxRatePct);
      bucket.balance += balance / k;
      bucket.gross += gross;
      bucket.tax += tax;
      bucket.net += gross - tax;
    });

    const ssActive = cfg.ssStartAge <= cfg.retireAge;
    const ssMonthly = ssActive ? cfg.ssMonthly : 0;

    return {
      byTax,
      months,
      totalBalance: byTax.pretax.balance + byTax.roth.balance + byTax.taxable.balance,
      grossMonthly: byTax.pretax.gross + byTax.roth.gross + byTax.taxable.gross,
      taxMonthly: byTax.pretax.tax + byTax.roth.tax + byTax.taxable.tax,
      netMonthly: byTax.pretax.net + byTax.roth.net + byTax.taxable.net + ssMonthly,
      ssActive,
      ssMonthly,
    };
  }

  // Closed drawers hide the controls, never the facts — the digest keeps every
  // value that drives the projection on screen.
  function renderDigest(cfg) {
    if (!cfg) { el.digest.textContent = ""; el.filedFor.textContent = "your plan"; return; }

    const strategy = {
      fixed: fmt(cfg.monthlyExpenses) + "/mo",
      "4pct": "4% rule",
      pct: (cfg.withdrawalPct * 100).toFixed(1) + "% of balance",
    }[cfg.strategy] || "";

    el.digest.textContent = [
      "Age " + cfg.currentAge + " → " + cfg.lifeExp,
      "retires " + cfg.retireAge,
      strategy,
      (cfg.inflationPct * 100).toFixed(1).replace(/\.0$/, "") + "% inflation",
      (cfg.taxRatePct * 100).toFixed(0) + "% tax",
      "SS " + fmt(cfg.ssMonthly) + " at " + cfg.ssStartAge,
      cfg.accounts.length + (cfg.accounts.length === 1 ? " account" : " accounts"),
    ].filter(Boolean).join(" · ");

    const owners = distinctOwners().filter((o) => o !== UNASSIGNED);
    el.filedFor.textContent = owners.length ? owners.join(" & ") : "your plan";
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
    setMcState("Simulating " + trials.toLocaleString("en-US") + " paths…");
    el.mcProgress.hidden = false;
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
      // The chart bands the interquartile range; the 10th percentile is kept as
      // a single end-of-plan figure rather than a line that flattens the chart.
      const p25 = [], p75 = [];
      for (let y = 0; y < years; y++) {
        const col = totalsByYear[y];
        col.sort(); // typed arrays sort numerically
        p25.push(percentileOf(col, 0.25));
        p75.push(percentileOf(col, 0.75));
      }
      depletionAges.sort((a, b) => a - b);

      const lastCol = totalsByYear[years - 1];
      const lastInfl = Math.pow(1 + cfg.inflationPct, years - 1);

      mcResults = {
        trials,
        successRate: successes / trials,
        failures: trials - successes,
        medianDepletionAge: depletionAges.length
          ? depletionAges[Math.floor(depletionAges.length / 2)]
          : null,
        lifeExp: cfg.lifeExp,
        p25, p75,
        p10End: percentileOf(lastCol, 0.10) / lastInfl,
        signature,
        stale: false,
      };

      mcRunning = false;
      el.runMcBtn.disabled = false;
      el.runMcBtn.textContent = "Run simulation";
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
  }

  function renderMonteCarlo() {
    const box = el.mcSuccessRate;
    box.classList.remove("level-good", "level-fair", "level-poor");

    if (!mcResults) {
      box.textContent = "—";
      el.mcSuccessNote.textContent = "Run a simulation to test the plan against random markets";
      setMcState(Number(el.mcTrials.value).toLocaleString("en-US") + " trials ready");
      return;
    }

    const r = mcResults;
    const n = (v) => v.toLocaleString("en-US");
    const pct = r.successRate * 100;
    box.textContent = pct.toFixed(1) + "%";
    box.classList.add(pct >= 85 ? "level-good" : pct >= 70 ? "level-fair" : "level-poor");

    el.mcSuccessNote.textContent =
      n(r.trials - r.failures) + " of " + n(r.trials) + " paths funded at " + r.lifeExp +
      " · poor market ends at " + fmtAxis(r.p10End) +
      (r.medianDepletionAge !== null ? " · median depletion age " + r.medianDepletionAge : "");

    setMcState(n(r.trials) + " trials", r.stale);
  }

  function setMcState(text, stale) {
    el.mcState.textContent = stale ? text + " — inputs changed, re-run" : text;
    el.mcState.classList.toggle("stale", !!stale);
  }

  function clearOutputs() {
    el.summaryTotal.textContent = "$0";
    el.summaryAdj.textContent = "$0";
    el.summaryIncome.textContent = "$0";
    el.tableA.innerHTML = "";
    el.tableB.innerHTML = "";
    el.taxBar.innerHTML = "";
    el.taxRows.innerHTML = "";
    el.taxNote.innerHTML =
      '<p class="empty-note">Add an account and set a birth date, retirement age and ' +
      "life expectancy that make sense together, and the projection appears here.</p>";
    while (el.chartSvg.firstChild) el.chartSvg.removeChild(el.chartSvg.firstChild);
    el.chartLegend.innerHTML = "";
    chartHover = null;
    chartLeave = null;
    el.tip.classList.remove("on");

    // Any simulation on screen described inputs that are no longer valid
    mcRunToken++;
    mcRunning = false;
    mcResults = null;
    el.runMcBtn.disabled = false;
    el.runMcBtn.textContent = "Run simulation";
    el.mcProgress.hidden = true;
    renderMonteCarlo();
    renderDigest(null);
  }


  // ── Chart ──
  const SVG_NS = "http://www.w3.org/2000/svg";
  const mkSvg = (tag, attrs) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  const fmtAxis = (n) => n >= 1e6 ? "$" + (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + "M"
                       : n >= 1e3 ? "$" + Math.round(n / 1e3) + "k" : "$" + Math.round(n);

  let chartHover = null;
  let chartLeave = null;

  // Balances are plotted in today's dollars. Over a 40-year horizon a nominal
  // chart is dominated by inflation — a plan that merely holds its purchasing
  // power looks like exponential growth — so the real series is the honest one.
  function renderChart(data, retireAge) {
    const svg = el.chartSvg;
    const vb = svg.getAttribute("viewBox").split(" ").map(Number);
    const W = vb[2], H = vb[3];
    const P = { t: 26, r: 100, b: 74, l: 88 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;

    const ink = inkVar("--ink"), ink3 = inkVar("--ink-3");
    const rule2 = inkVar("--rule-2"), plate = inkVar("--plate");
    const accent = inkVar("--accent"), band = ACCOUNT_COLORS[0];

    const real = (vals) => vals.map((v, i) => v / data[i].inflFactor);
    const totals = real(data.map((d) => d.total));

    // The simulated band is the interquartile range. A 10th-90th spread runs
    // several times the projection over this horizon and squashes the line the
    // chart exists to show; the downside figure lives in the stat instead.
    const hasBand = mcResults && mcResults.p25 && mcResults.p25.length === data.length;
    const LO = hasBand ? real(mcResults.p25) : null;
    const HI = hasBand ? real(mcResults.p75) : null;

    let yMax = Math.max(...totals);
    if (hasBand) yMax = Math.max(yMax, Math.max(...HI));
    yMax = (yMax || 1) * 1.08;

    const x = (i) => P.l + (i / Math.max(data.length - 1, 1)) * iw;
    const y = (v) => P.t + ih - (Math.max(v, 0) / yMax) * ih;
    const line = (vals) => vals.map((d, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(d).toFixed(1)).join(" ");

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const defs = mkSvg("defs", {});
    const pat = mkSvg("pattern", { id: "mcHatch", width: "6", height: "6",
      patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pat.appendChild(mkSvg("line", { x1: "0", y1: "0", x2: "0", y2: "6",
      stroke: band, "stroke-width": "1", "stroke-opacity": "0.24" }));
    defs.appendChild(pat);
    svg.appendChild(defs);

    for (let i = 0; i <= 5; i++) {
      const val = (yMax / 5) * i, yy = y(val);
      svg.appendChild(mkSvg("line", { x1: P.l, y1: yy, x2: W - P.r, y2: yy,
        stroke: rule2, "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
      const t = mkSvg("text", { x: P.l - 12, y: yy + 5, "text-anchor": "end",
        fill: ink3, "font-family": "var(--f-disp)", "font-size": 15 });
      t.textContent = i === 0 ? "0" : fmtAxis(val);
      svg.appendChild(t);
    }

    if (hasBand) {
      const bandPath = line(HI) + " " + LO.map((d, i) => {
        const j = LO.length - 1 - i;
        return "L" + x(j).toFixed(1) + " " + y(LO[j]).toFixed(1);
      }).join(" ") + " Z";
      svg.appendChild(mkSvg("path", { d: bandPath, fill: "url(#mcHatch)", stroke: "none" }));
      [HI, LO].forEach((series) => svg.appendChild(mkSvg("path", {
        d: line(series), fill: "none", stroke: band, "stroke-width": 1,
        "stroke-opacity": 0.5, "stroke-dasharray": "3 4", "vector-effect": "non-scaling-stroke" })));
    }

    accounts.forEach((acc, i) => svg.appendChild(mkSvg("path", {
      d: line(real(data.map((d) => Math.max(d.balances[acc.id] || 0, 0)))),
      fill: "none", stroke: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
      "stroke-width": 1.4, "stroke-opacity": 0.9,
      "stroke-linecap": "round", "stroke-linejoin": "round",
      "vector-effect": "non-scaling-stroke" })));

    svg.appendChild(mkSvg("path", { d: line(totals), fill: "none", stroke: ink,
      "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round",
      "vector-effect": "non-scaling-stroke" }));

    const retireI = data.findIndex((d) => d.age === retireAge);
    if (retireI >= 0) {
      const rx = x(retireI);
      svg.appendChild(mkSvg("line", { x1: rx, y1: P.t - 6, x2: rx, y2: P.t + ih,
        stroke: accent, "stroke-width": 1.5, "stroke-dasharray": "5 4",
        "vector-effect": "non-scaling-stroke" }));
      const flag = mkSvg("text", { x: rx + 8, y: P.t + 6, fill: accent,
        "font-family": "var(--f-disp)", "font-size": 15 });
      flag.textContent = "retires at " + retireAge;
      svg.appendChild(flag);

      const peak = totals[retireI];
      svg.appendChild(mkSvg("circle", { cx: rx, cy: y(peak), r: 4.5, fill: plate,
        stroke: ink, "stroke-width": 2.5, "vector-effect": "non-scaling-stroke" }));
      const pk = mkSvg("text", { x: rx - 10, y: y(peak) - 13, "text-anchor": "end", fill: ink,
        "font-family": "var(--f-disp)", "font-size": 18 });
      pk.textContent = fmt(peak);
      svg.appendChild(pk);
    }

    data.forEach((d, i) => {
      if (d.age % 5 !== 0) return;
      const t = mkSvg("text", { x: x(i), y: P.t + ih + 26, "text-anchor": "middle",
        fill: ink3, "font-family": "var(--f-disp)", "font-size": 15 });
      t.textContent = d.age;
      svg.appendChild(t);
    });
    const ax = mkSvg("text", { x: P.l, y: P.t + ih + 52, fill: ink3,
      "font-family": "var(--f-disp)", "font-size": 13, "letter-spacing": "0.1em" });
    ax.textContent = "AGE";
    svg.appendChild(ax);

    // ── Hover layer ──
    const cross = mkSvg("line", { x1: 0, y1: P.t, x2: 0, y2: P.t + ih, stroke: ink3,
      "stroke-width": 1, "stroke-opacity": 0, "vector-effect": "non-scaling-stroke" });
    svg.appendChild(cross);
    const dots = accounts.map((acc, i) => {
      const c = mkSvg("circle", { r: 4, fill: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
        stroke: plate, "stroke-width": 2, opacity: 0, "vector-effect": "non-scaling-stroke" });
      svg.appendChild(c);
      return c;
    });

    chartHover = function (ev) {
      const rect = el.hit.getBoundingClientRect();
      if (!rect.width) return;
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(data.length - 1,
        Math.round(((px - P.l) / iw) * (data.length - 1))));
      const row = data[i], gx = x(i), k = row.inflFactor;

      cross.setAttribute("x1", gx);
      cross.setAttribute("x2", gx);
      cross.setAttribute("stroke-opacity", 0.45);
      accounts.forEach((acc, n) => {
        dots[n].setAttribute("cx", gx);
        dots[n].setAttribute("cy", y(Math.max(row.balances[acc.id] || 0, 0) / k));
        dots[n].setAttribute("opacity", 1);
      });

      el.tip.innerHTML =
        '<div class="tip-age">Age ' + row.age + (row.age === retireAge ? " &middot; retires" : "") + "</div>" +
        accounts.map((acc, n) =>
          '<div class="tip-row"><span class="k"><span class="tip-dot" style="background:' +
          ACCOUNT_COLORS[n % ACCOUNT_COLORS.length] + '"></span>' +
          escapeHtml(acc.owner ? acc.owner + " " + acc.name : acc.name) +
          '</span><span class="v">' + fmtAxis(Math.max(row.balances[acc.id] || 0, 0) / k) + "</span></div>"
        ).join("") +
        '<div class="tip-rule"></div>' +
        '<div class="tip-row"><span class="k">Total</span><span class="v">' + fmt(row.total / k) + "</span></div>" +
        (row.withdrawal > 0
          ? '<div class="tip-row"><span class="k">Withdrawn</span><span class="v">' + fmt(row.withdrawal / k) + "</span></div>" +
            '<div class="tip-row"><span class="k">of which tax</span><span class="v">' + fmt(row.tax / k) + "</span></div>"
          : "");

      el.tip.classList.add("on");
      const left = (gx / W) * rect.width;
      const want = (gx / W) > 0.62 ? left - el.tip.offsetWidth - 16 : left + 16;
      // Clamp inside the plot: unclamped, the tooltip pushes the page sideways
      // on a narrow viewport.
      el.tip.style.left = Math.max(0, Math.min(want, rect.width - el.tip.offsetWidth)) + "px";
      el.tip.style.top = Math.max(6, (y(row.total / k) / H) * rect.height - el.tip.offsetHeight / 2) + "px";
    };

    chartLeave = function () {
      cross.setAttribute("stroke-opacity", 0);
      dots.forEach((d) => d.setAttribute("opacity", 0));
      el.tip.classList.remove("on");
    };

    renderLegend();
  }

  function renderLegend() {
    const parts = ['<span class="li"><span class="sw" style="background:' + inkVar("--ink") +
      ';height:.2rem"></span>Total</span>'];
    accounts.forEach((acc, i) => {
      parts.push('<span class="li"><span class="sw" style="background:' +
        ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] + '"></span>' +
        escapeHtml(acc.owner ? acc.owner + " " + acc.name : acc.name) + "</span>");
    });
    if (mcResults && mcResults.p25) {
      parts.push('<span class="li"><span class="sw band" style="background:' +
        ACCOUNT_COLORS[0] + '"></span>25th&ndash;75th simulated</span>');
    }
    el.chartLegend.innerHTML = parts.join("");
  }

  // ── Table ──
  // Subtotal columns, one per owner. These used to be a hard-coded pair of names
  // matched against the start of each account's name, so they read $0 for anyone whose
  // accounts were not named that way. They now follow the owner field on each account.
  function ownerColumns() {
    const owners = distinctOwners();
    // A single owner's subtotal is just the grand total — no point printing it twice
    return owners.length > 1 ? owners : [];
  }

  function getOwnerTotal(balances, owner) {
    return accounts
      .filter((a) => ownerLabel(a.owner) === owner)
      .reduce((s, a) => s + (balances[a.id] || 0), 0);
  }

  function renderTable(data, retireAge) {
    const owners = ownerColumns();
    const head = "<thead><tr><th>Age</th>" +
      owners.map((o) => "<th>" + escapeHtml(o) + "</th>").join("") +
      "<th>Total</th><th>Withdrawn</th><th>Tax</th></tr></thead>";

    const body = (rows) => "<tbody>" + rows.map((row) => {
      const k = row.inflFactor;
      const cells = [row.age]
        .concat(owners.map((o) => fmtAxis(getOwnerTotal(row.balances, o) / k)))
        .concat([
          fmtAxis(row.total / k),
          row.withdrawal > 0 ? fmtAxis(row.withdrawal / k) : "&mdash;",
          row.tax > 0 ? fmtAxis(row.tax / k) : "&mdash;",
        ]);
      return '<tr class="' + (row.age === retireAge ? "retirement-row" : "") + '">' +
        cells.map((c) => "<td>" + c + "</td>").join("") + "</tr>";
    }).join("") + "</tbody>";

    // Facing pages: every year is on screen at once, the way a ledger spread
    // works, rather than a scroll box hiding the drawdown years.
    const half = Math.ceil(data.length / 2);
    el.tableA.innerHTML = head + body(data.slice(0, half));
    el.tableB.innerHTML = data.length > half ? head + body(data.slice(half)) : "";
  }

  // ── Tax Summary ──
  function renderTaxSummary(cfg, income) {
    const { byTax } = income;
    const total = income.totalBalance;
    const buckets = [
      { key: "pretax",  label: "Pre-tax" },
      { key: "roth",    label: "Roth" },
      { key: "taxable", label: "Taxable" },
    ];
    const colors = [ACCOUNT_COLORS[0], ACCOUNT_COLORS[1], ACCOUNT_COLORS[2]];
    const taxRatePct = (cfg.taxRatePct * 100).toFixed(0);
    const capGainsPct = (TAXABLE_GAIN_FRACTION * CAP_GAINS_RATE * 100).toFixed(1);

    el.taxBar.innerHTML = total > 0
      ? '<div class="track">' + buckets.map((b, i) => {
          const pc = (byTax[b.key].balance / total) * 100;
          if (pc <= 0) return "";
          return '<div class="seg" style="flex:' + pc.toFixed(2) + ";background:" + colors[i] +
            ';opacity:.85" title="' + b.label + " " + pc.toFixed(1) + '%"></div>';
        }).join("") + "</div>" +
        '<div class="keys">' + buckets.map((b, i) => {
          const d = byTax[b.key], pc = (d.balance / total) * 100;
          return '<span class="key"><span class="dot" style="background:' + colors[i] + '"></span>' +
            b.label + " <b>" + fmtAxis(d.balance) + '</b> <span class="pc">' + pc.toFixed(0) + "%</span></span>";
        }).join("") + "</div>"
      : "";

    el.taxRows.innerHTML =
      '<div class="lr head"><span>Treatment</span><span>Balance</span><span>Monthly tax</span></div>' +
      buckets.map((b, i) => {
        const d = byTax[b.key];
        return '<div class="lr"><span class="nm"><span class="sw" style="background:' + colors[i] + '"></span>' +
          b.label + '</span><span class="amt">' + fmt(d.balance) + "</span>" +
          '<span class="tax">' + (d.tax > 0.5 ? fmt(d.tax) : "&mdash;") + "</span></div>";
      }).join("") +
      '<div class="lr total"><span class="nm">Total</span><span class="amt">' + fmt(total) +
      '</span><span class="tax">' + fmt(income.taxMonthly) + "</span></div>";

    // Name where the bill comes from: a 100%-pre-tax portfolio showing monthly
    // tax is correct, not a bug, and the panel should say why.
    const taxed = [];
    if (byTax.pretax.balance > 0) taxed.push("pre-tax withdrawals at " + taxRatePct + "%");
    if (byTax.taxable.balance > 0) taxed.push("taxable gains at ~" + capGainsPct + "% effective");

    const ssLine = income.ssActive
      ? "Includes Social Security of " + fmt(income.ssMonthly) + "."
      : "Social Security is not included — it starts at age " + cfg.ssStartAge +
        ", after you retire at " + cfg.retireAge + ".";

    el.taxNote.innerHTML =
      "<p>Pre-tax contributions were never taxed, so the whole withdrawal is ordinary income. " +
      "A portfolio that is mostly pre-tax owes tax on the way out — that is the deferral " +
      "coming due, not an error. <b>Roth balances withdraw clean.</b></p>" +
      "<p>Sustainable income is " + fmt(income.grossMonthly) + " a month gross, " +
      (taxed.length ? "less " + fmt(income.taxMonthly) + " from " + taxed.join(" and ") : "with nothing taxed on withdrawal") +
      ", leaving <b>" + fmt(income.netMonthly) + "</b> a month. " + ssLine + "</p>" +
      "<p>Today's dollars, assuming the portfolio keeps earning and is drawn down to zero by age " +
      cfg.lifeExp + ".</p>";
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
        GLOBAL_CHECKBOXES.forEach((key) => {
          el[key].checked = !!data.globals[key];
        });
        // Clear existing accounts
        accounts = [];
        el.accountsList.innerHTML = "";
        // Restore accounts
        nextId = data.nextId || 1;
        data.accounts.forEach((acc) => accounts.push(normalizeAccount(acc)));
        renderAccountsList();
        updateStrategyVisibility();
        applyReturnOverrideToCards();
        recalculate();
        saveState();
      } catch (err) {
        alert("Could not read file: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ── Drawers ──
  // No scrim: a blocking overlay would dim the chart and swallow toolbar
  // clicks, which fights the reason the panel is open — watching the
  // projection move as a number changes.
  const PANELS = [
    { btn: el.btnPlan, el: el.drawerPlan },
    { btn: el.btnAccounts, el: el.drawerAccounts },
  ];

  function setPanel(target, open) {
    PANELS.forEach((pn) => {
      const on = open && pn === target;
      pn.btn.setAttribute("aria-expanded", String(on));
      if (on) {
        pn.el.hidden = false;
        requestAnimationFrame(() => pn.el.classList.add("on"));
      } else {
        pn.el.classList.remove("on");
      }
    });
    if (open && target) {
      const first = target.el.querySelector("input, select, button");
      if (first) first.focus({ preventScroll: true });
    }
  }

  // A drawer starts at the toolbar's bottom edge, so it never covers the trigger
  // that opened it or the one next to it — switching panels stays a single click.
  // The toolbar is sticky, so that edge moves until it docks; track it.
  const toolbarEl = document.querySelector(".toolbar");
  let drawerTopQueued = false;
  function fitDrawerTop() {
    drawerTopQueued = false;
    const bottom = toolbarEl ? Math.max(0, Math.round(toolbarEl.getBoundingClientRect().bottom)) : 0;
    document.documentElement.style.setProperty("--drawer-top", bottom + "px");
  }
  function queueDrawerTop() {
    if (drawerTopQueued) return;
    drawerTopQueued = true;
    requestAnimationFrame(fitDrawerTop);
  }
  fitDrawerTop();
  window.addEventListener("resize", queueDrawerTop);
  window.addEventListener("scroll", queueDrawerTop, { passive: true });

  const anyPanelOpen = () => PANELS.some((pn) => pn.btn.getAttribute("aria-expanded") === "true");

  PANELS.forEach((pn) => {
    pn.btn.addEventListener("click", () =>
      setPanel(pn, pn.btn.getAttribute("aria-expanded") !== "true"));
    pn.el.querySelector(".drawer-close").addEventListener("click", () => {
      setPanel(null, false);
      pn.btn.focus();
    });
    // Keep a closed drawer out of the tab order without killing the slide-out
    pn.el.addEventListener("transitionend", (e) => {
      if (e.propertyName === "transform" && !pn.el.classList.contains("on")) pn.el.hidden = true;
    });
  });

  document.addEventListener("pointerdown", (e) => {
    if (!anyPanelOpen()) return;
    const inside = PANELS.some((pn) => pn.el.contains(e.target) || pn.btn.contains(e.target));
    if (!inside) setPanel(null, false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !anyPanelOpen()) return;
    const open = PANELS.find((pn) => pn.btn.getAttribute("aria-expanded") === "true");
    setPanel(null, false);
    if (open) open.btn.focus();
  });

  // ── Event Binding ──
  el.hit.addEventListener("pointermove", (e) => { if (chartHover) chartHover(e); });
  el.hit.addEventListener("pointerleave", () => { if (chartLeave) chartLeave(); });
  // A stale tooltip keeps a position computed for the old width
  window.addEventListener("resize", () => { if (chartLeave) chartLeave(); });

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
  el.mcTrials.addEventListener("change", () => {
    saveState();
    if (!mcResults) renderMonteCarlo();
  });

  [el.globalReturnEnabled, el.globalReturn].forEach((input) => {
    input.addEventListener("input", applyReturnOverrideToCards);
  });

  // Recalculate on any global input change. Account fields bind their own
  // handlers when their card is built, so they are excluded here.
  document.querySelectorAll("#drawerPlan input, #drawerPlan select").forEach((inp) => {
    inp.addEventListener("input", () => {
      recalculate();
      saveState();
    });
  });

  // ── Init: load saved state or add a default 401(k) ──
  const loaded = loadState();
  if (!loaded) {
    addAccount("401k");
  }
  updateStrategyVisibility();
  applyReturnOverrideToCards();
  recalculate();
  renderMonteCarlo();
})();
