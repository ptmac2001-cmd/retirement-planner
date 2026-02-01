# Retirement Planner

A single-page web app for planning retirement finances. Built with plain HTML, CSS, and JavaScript — no frameworks or build tools required.

## Features

- **Multiple retirement accounts** — Add 401(k), Roth IRA, Traditional IRA, Brokerage, HSA, or custom accounts
- **Three withdrawal strategies** — Fixed monthly amount, 4% rule, or custom percentage
- **Tax modeling** — Pre-tax, Roth, and taxable accounts handled differently with gross-up calculations
- **Projection chart** — Interactive Chart.js line chart showing portfolio growth through retirement
- **Year-by-year breakdown** — Detailed table with group subtotals, withdrawals, and inflation-adjusted values
- **Inflation adjustment** — All projections account for purchasing power over time
- **Social Security** — Factored into post-retirement income at your specified start age
- **Employer match** — Configurable match percentage and salary cap for applicable accounts
- **Auto-save** — All inputs saved to localStorage automatically
- **Export/Import** — Download your data as JSON for backup or transfer between devices

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
