# Retirement Planner

A single-page web app for planning retirement finances. Built with plain HTML, CSS, and JavaScript — no frameworks or build tools required.

## Features

- **Multiple retirement accounts** — Add 401(k), Roth IRA, Traditional IRA, Brokerage, HSA, or custom accounts
- **Three withdrawal strategies** — Fixed monthly amount, 4% rule, or custom percentage
- **Tax modeling** — Pre-tax, Roth, and taxable accounts handled differently with gross-up calculations
- **Monte Carlo simulation** — Re-runs the whole plan across up to 10,000 randomized market paths and reports a success rate, percentile outcomes, and median depletion age
- **Projection chart** — Interactive Chart.js line chart showing portfolio growth through retirement, with a 10th–90th percentile band once a simulation has been run
- **Year-by-year breakdown** — Detailed table with group subtotals, withdrawals, and inflation-adjusted values
- **Inflation adjustment** — All projections account for purchasing power over time
- **Social Security** — Factored into post-retirement income at your specified start age
- **Employer match** — Configurable match percentage and salary cap for applicable accounts
- **Auto-save** — All inputs saved to localStorage automatically
- **Export/Import** — Download your data as JSON for backup or transfer between devices

## Monte Carlo Simulation

The main projection is deterministic: every account earns its expected return every year. The simulation relaxes that, drawing each year's return at random to show how the plan holds up across thousands of market paths.

- Returns are drawn from a **lognormal** distribution, moment-matched to each account's expected return and its **Volatility** setting. Setting all volatilities to 0% reproduces the deterministic projection exactly.
- The simulated median lands *below* the deterministic projection, by more the longer the horizon. That is correct: volatile returns compound to less than their average implies.
- Accounts share a common market factor controlled by the **Asset Correlation** setting, so a portfolio split across several accounts doesn't get unrealistic diversification.
- The RNG is seeded identically each run, so unchanged inputs give an unchanged success rate.

Everything runs in the browser. 10,000 trials takes roughly half a second, executed in batches that yield to the event loop so the page stays responsive — no server and no build step required. (A Web Worker would be the usual home for this, but workers are blocked on `file://` origins, and opening `index.html` directly is a design goal here.)

Inflation, Social Security, contributions, and tax rates are held fixed; only investment returns vary.

## Getting Started

Open `index.html` in any modern browser. No server, installation, or build step needed.

For detailed usage instructions and calculation explanations, open `instructions.html`.

## Files

| File | Description |
|------|-------------|
| `index.html` | Page structure and layout |
| `style.css` | Responsive styling |
| `script.js` | Calculations, chart rendering, DOM interactions |
| `instructions.html` | User guide with calculation appendix |

## Dependencies

- [Chart.js](https://www.chartjs.org/) (loaded via CDN) — for the projection chart
- No other external dependencies
