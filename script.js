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
    globalReturnEnabled: $("#globalReturnEnabled"),
    globalReturn:   $("#globalReturn"),
    globalReturnLabel: $("#globalReturnLabel"),
    ownerNames:     $("#ownerNames"),
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
      // Saves written before accounts had an owner encoded the person in the name
      // ("Peter 401(k)"), which is what the old hard-coded Peter/Lisa subtotal
      // columns matched on. Lift that prefix into a real owner field so those
      // subtotals keep working instead of silently reading $0.
      const m = /^([A-Za-z][A-Za-z.'-]*)\s+(.*\S)$/.exec(acc.name || "");
      if (m && LEGACY_OWNER_PREFIXES.includes(m[1].toLowerCase())) {
        acc.owner = m[1];
        acc.name = m[2];
      } else {
        acc.owner = "";
      }
    }
    if (typeof acc.collapsed !== "boolean") acc.collapsed = false;
    return acc;
  }

  // Owner names the pre-owner-field version of the app grouped on.
  const LEGACY_OWNER_PREFIXES = ["peter", "lisa"];

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

    const owners = distinctOwners();
    const showGroups = owners.length > 1;

    owners.forEach((owner) => {
      let container = el.accountsList;
      if (showGroups) {
        const group = document.createElement("div");
        group.className = "owner-group";
        const header = document.createElement("div");
        header.className = "owner-group-header";
        header.innerHTML = `<span>${escapeHtml(owner)}</span>`;
        group.appendChild(header);
        el.accountsList.appendChild(group);
        container = group;
      }
      accounts
        .filter((a) => ownerLabel(a.owner) === owner)
        .forEach((acc) => container.appendChild(buildAccountCard(acc, showGroups)));
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
    const card = tpl.querySelector(".account-card");
    card.dataset.id = acc.id;
    if (acc.collapsed) card.classList.add("collapsed");

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

    updateBadge(card, acc.tax);
    updateMatchVisibility(card, acc.tax);
    updateReturnOverrideUI(card);
    // The group heading already names the owner — repeating it on every card is noise.
    updateOwnerChip(card, acc.owner, inOwnerGroup);

    function toggleCollapse() {
      card.classList.toggle("collapsed");
      acc.collapsed = card.classList.contains("collapsed");
      saveState();
    }

    card.querySelector(".collapse-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCollapse();
    });

    card.querySelector(".account-header").addEventListener("click", toggleCollapse);

    // Keep clicks inside the form from bubbling up to the header's collapse handler
    card.querySelector(".account-body").addEventListener("click", (e) => e.stopPropagation());

    card.querySelector(".remove-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      removeAccount(acc.id);
    });

    // Input changes
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
    updateBadge(card, acc.tax);
    updateMatchVisibility(card, acc.tax);
    updateOwnerChip(card, acc.owner, !!card.closest(".owner-group"));
    refreshOwnerDatalist();
    recalculate();
    saveState();
  }

  function updateOwnerChip(card, owner, inOwnerGroup) {
    const chip = card.querySelector(".owner-chip");
    const show = !inOwnerGroup && owner && owner.trim();
    chip.textContent = show ? owner.trim() : "";
    chip.hidden = !show;
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
    $$(".account-card").forEach(updateReturnOverrideUI);
    el.globalReturnLabel.classList.toggle("is-active", el.globalReturnEnabled.checked);
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
    const income = computeRetirementIncome(retireRow.balances, cfg);

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
    el.summaryIncome.textContent = fmt(income.netMonthly);
    el.summaryCoverage.textContent = coverageYears + (coverageYears >= retirementYears ? "+" : "") + " yrs";

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
  function computeRetirementIncome(balances, cfg) {
    const months = Math.max(cfg.lifeExp - cfg.retireAge, 0) * 12;
    const byTax = {
      pretax:  { balance: 0, gross: 0, tax: 0, net: 0 },
      roth:    { balance: 0, gross: 0, tax: 0, net: 0 },
      taxable: { balance: 0, gross: 0, tax: 0, net: 0 },
    };

    cfg.accounts.forEach((acc) => {
      const bucket = byTax[acc.tax] || byTax.taxable;
      const balance = balances[acc.id] || 0;
      const gross = annuityMonthlyPayment(balance, acc.annualReturn, cfg.inflationPct, months);
      const tax = gross * effectiveTaxRate(acc, cfg.taxRatePct);
      bucket.balance += balance;
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
    // Chart.js comes from a CDN, so it is missing whenever the page is opened offline.
    // Without this guard the throw propagates out of recalculate() and takes the table
    // and tax panel down with it — the whole page goes blank over one failed request.
    if (typeof Chart === "undefined") return;

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

    const showOwnerInLegend = distinctOwners().length > 1;
    accounts.forEach((acc, i) => datasets.push({
      label: showOwnerInLegend ? `${ownerLabel(acc.owner)} — ${acc.name}` : acc.name,
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
  // Subtotal columns, one per owner. These used to be a hard-coded ["Peter", "Lisa"]
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

    // Header
    let headerHTML = "<th>Age</th>";
    owners.forEach((o) => { headerHTML += `<th>${escapeHtml(o)} Total</th>`; });
    headerHTML += "<th>Grand Total</th><th>Inf Adj Tot</th><th>Withdrawals</th><th>Inf Adj Withdrawals</th><th>Est. Tax</th>";
    el.tableHeader.innerHTML = headerHTML;

    // Body
    let bodyHTML = "";
    data.forEach((row) => {
      const cls = row.age === retireAge ? ' class="retirement-row"' : "";
      bodyHTML += `<tr${cls}><td>${row.age}</td>`;
      owners.forEach((o) => {
        bodyHTML += `<td>${fmt(getOwnerTotal(row.balances, o))}</td>`;
      });
      const wd = row.withdrawal > 0 ? fmt(row.withdrawal) : "—";
      const inflAdjWd = row.withdrawal > 0 ? fmt(row.withdrawal / row.inflFactor) : "—";
      const tax = row.withdrawal > 0 ? fmt(row.tax) : "—";
      bodyHTML += `<td>${fmt(row.total)}</td><td>${fmt(row.inflAdj)}</td><td>${wd}</td><td>${inflAdjWd}</td><td>${tax}</td></tr>`;
    });
    el.tableBody.innerHTML = bodyHTML;
  }

  // ── Tax Summary ──
  function renderTaxSummary(cfg, income) {
    const { byTax } = income;
    const total = income.totalBalance;
    const pct = (v) => (total > 0 ? ((v / total) * 100).toFixed(1) : "0.0");
    const taxRatePct = (cfg.taxRatePct * 100).toFixed(0);
    const capGainsPct = (TAXABLE_GAIN_FRACTION * CAP_GAINS_RATE * 100).toFixed(1);

    const ssLine = income.ssActive
      ? `Includes Social Security: ${fmt(income.ssMonthly)}`
      : `Social Security not included — starts at age ${cfg.ssStartAge}, after you retire at ${cfg.retireAge}`;

    // Naming which balances actually generate the tax bill: a 100% pre-tax portfolio
    // showing a monthly tax figure is correct, not a bug, and the card should say why.
    const taxedBuckets = [];
    if (byTax.pretax.balance > 0) taxedBuckets.push(`pre-tax withdrawals at ${taxRatePct}%`);
    if (byTax.taxable.balance > 0) taxedBuckets.push(`taxable gains at ~${capGainsPct}% effective`);
    const sourceLine = taxedBuckets.length
      ? `From ${taxedBuckets.join(" and ")}`
      : "Nothing here is taxed on withdrawal";

    el.taxSummary.innerHTML = `
      <div class="tax-group">
        <h3 style="color: var(--clr-pretax)">Pre-tax</h3>
        <div class="amount">${fmt(byTax.pretax.balance)}</div>
        <div class="detail">${pct(byTax.pretax.balance)}% of portfolio</div>
        <div class="detail">Contributions were never taxed, so every dollar withdrawn is taxed as income at ${taxRatePct}%</div>
        <div class="detail">Est. ${fmt(byTax.pretax.tax)}/mo in tax</div>
      </div>
      <div class="tax-group">
        <h3 style="color: var(--clr-roth)">Roth / Post-tax</h3>
        <div class="amount">${fmt(byTax.roth.balance)}</div>
        <div class="detail">${pct(byTax.roth.balance)}% of portfolio</div>
        <div class="detail">Already taxed going in — withdrawals are tax-free</div>
        <div class="detail">Est. $0/mo in tax</div>
      </div>
      <div class="tax-group">
        <h3 style="color: var(--clr-taxable)">Taxable</h3>
        <div class="amount">${fmt(byTax.taxable.balance)}</div>
        <div class="detail">${pct(byTax.taxable.balance)}% of portfolio</div>
        <div class="detail">Est. ${(CAP_GAINS_RATE * 100).toFixed(0)}% on ~${(TAXABLE_GAIN_FRACTION * 100).toFixed(0)}% gains</div>
        <div class="detail">Est. ${fmt(byTax.taxable.tax)}/mo in tax</div>
      </div>
      <div class="tax-group tax-impact">
        <h3>Monthly Tax Impact</h3>
        <div class="amount">${fmt(income.netMonthly)} <span style="font-size:0.75rem;font-weight:400;color:var(--clr-text-muted)">/ month after tax</span></div>
        <div class="detail">Gross withdrawal ${fmt(income.grossMonthly)} &minus; tax ${fmt(income.taxMonthly)}</div>
        <div class="detail">${sourceLine}</div>
        <div class="detail">${ssLine}</div>
        <div class="detail tax-note">Today's dollars, assuming the portfolio keeps earning and is drawn down to zero by age ${cfg.lifeExp}</div>
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

  [el.globalReturnEnabled, el.globalReturn].forEach((input) => {
    input.addEventListener("input", applyReturnOverrideToCards);
  });

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
  applyReturnOverrideToCards();
  recalculate();
  renderMonteCarlo();
})();
