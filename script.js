(function () {
  "use strict";

  // ── Account presets ──
  const PRESETS = {
    "401k":           { name: "401(k)",          tax: "pretax",  contribution: 500, matchPct: 50, matchCap: 6 },
    rothIra:          { name: "Roth IRA",        tax: "roth",    contribution: 500, matchPct: 0,  matchCap: 0 },
    traditionalIra:   { name: "Traditional IRA", tax: "pretax",  contribution: 400, matchPct: 0,  matchCap: 0 },
    brokerage:        { name: "Brokerage",       tax: "taxable", contribution: 300, matchPct: 0,  matchCap: 0 },
    hsa:              { name: "HSA",             tax: "roth",    contribution: 200, matchPct: 0,  matchCap: 0 },
    custom:           { name: "Custom Account",  tax: "taxable", contribution: 200, matchPct: 0,  matchCap: 0 },
  };

  const ACCOUNT_COLORS = [
    "#2563eb", "#10b981", "#f59e0b", "#6366f1",
    "#ef4444", "#06b6d4", "#ec4899", "#8b5cf6",
  ];

  let accounts = [];
  let nextId = 1;
  let chart = null;

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
  ];

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
          accounts.push(acc);
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
  function recalculate() {
    const currentAge = getAgeFromBirthdate();
    const retireAge = getVal(el.retirementAge);
    const lifeExp = getVal(el.lifeExpectancy);
    const annualIncome = getVal(el.annualIncome);
    const strategy = el.withdrawalStrategy.value;
    const monthlyExpenses = getVal(el.monthlyExpenses);
    const withdrawalPct = getVal(el.withdrawalPct) / 100;
    const inflationPct = getVal(el.inflationRate) / 100;
    const ssMonthly = getVal(el.socialSecurity);
    const ssStartAge = getVal(el.ssStartAge);
    const taxRatePct = getVal(el.taxRate) / 100;

    if (currentAge <= 0 || currentAge >= lifeExp || currentAge >= retireAge) {
      clearOutputs();
      return;
    }

    const totalYears = lifeExp - currentAge;
    const yearsToRetire = retireAge - currentAge;
    const firstYearMonths = getMonthsToNextBirthday();

    // Per-account yearly data
    // Each entry: { age, balances: { [accId]: number }, total, inflAdj }
    const yearlyData = [];

    // Initialize balances
    const balances = {};
    let retirementBalance = 0;
    accounts.forEach((a) => { balances[a.id] = a.balance; });

    for (let y = 0; y <= totalYears; y++) {
      const age = currentAge + y;
      // Year 1 = partial year (months until next birthday), all others = 12 months
      const monthsThisYear = y === 1 ? firstYearMonths : 12;

      let yearWithdrawal = 0;

      // Year 0 = current age: record starting balances, no growth yet
      if (y > 0) {
        const isRetired = age > retireAge;

        if (!isRetired) {
          // Accumulation phase: monthly compounding for this year
          accounts.forEach((acc) => {
            const monthlyRate = (acc.annualReturn / 100) / 12;
            let monthlyContrib = acc.contribution;

            // Employer match
            if (acc.tax === "pretax" && acc.matchPct > 0 && acc.matchCap > 0) {
              const monthlySalary = annualIncome / 12;
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
          const ssActive = age >= ssStartAge;
          const ssContrib = ssActive ? ssMonthly : 0;

          // Determine monthly withdrawal based on strategy
          let monthlyNeed;
          if (strategy === "4pct") {
            // 4% rule: 4% of retirement balance, inflation-adjusted from retirement year
            if (!retirementBalance) {
              retirementBalance = accounts.reduce((s, a) => s + Math.max(balances[a.id], 0), 0);
            }
            const yearsInRetirement = age - retireAge;
            const inflFactor = Math.pow(1 + inflationPct, yearsInRetirement);
            monthlyNeed = (retirementBalance * 0.04 / 12) * inflFactor - ssContrib;
          } else if (strategy === "pct") {
            // Custom %: percentage of current portfolio balance each year
            const totalBal = accounts.reduce((s, a) => s + Math.max(balances[a.id], 0), 0);
            monthlyNeed = (totalBal * withdrawalPct / 12) - ssContrib;
          } else {
            // Fixed: inflation-adjusted monthly expenses
            const inflationFactor = Math.pow(1 + inflationPct, y);
            monthlyNeed = monthlyExpenses * inflationFactor - ssContrib;
          }
          if (monthlyNeed < 0) monthlyNeed = 0;

          const totalBal = accounts.reduce((s, a) => s + Math.max(balances[a.id], 0), 0);

          accounts.forEach((acc) => {
            const monthlyRate = (acc.annualReturn / 100) / 12;
            const proportion = totalBal > 0 ? Math.max(balances[acc.id], 0) / totalBal : 0;

            let rawWithdrawal = monthlyNeed * proportion;
            if (acc.tax === "pretax") {
              rawWithdrawal = rawWithdrawal / (1 - taxRatePct);
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
      }

      const inflationFactor = Math.pow(1 + inflationPct, y);
      const total = accounts.reduce((s, a) => s + balances[a.id], 0);
      yearlyData.push({
        age,
        balances: { ...balances },
        total,
        inflAdj: total / inflationFactor,
        withdrawal: yearWithdrawal,
        inflFactor: inflationFactor,
      });
    }

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

  function clearOutputs() {
    el.summaryTotal.textContent = "$0";
    el.summaryAdj.textContent = "$0";
    el.summaryIncome.textContent = "$0";
    el.summaryCoverage.textContent = "0 yrs";
    el.tableBody.innerHTML = "";
    el.tableHeader.innerHTML = "";
    el.taxSummary.innerHTML = "";
    if (chart) { chart.destroy(); chart = null; }
  }

  // ── Chart ──
  function renderChart(data, retireAge) {
    const ctx = document.getElementById("projectionChart");
    const labels = data.map((d) => d.age);

    const datasets = accounts.map((acc, i) => ({
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
      borderColor: "#0f172a",
      backgroundColor: "#0f172a10",
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
            title: { display: true, text: "Age" },
            ticks: { maxTicksLimit: 15 },
          },
          y: {
            title: { display: true, text: "Portfolio Value" },
            ticks: {
              callback: (v) => fmt(v),
            },
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
          accounts.push(acc);
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
})();
