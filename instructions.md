# Retirement Planner — Instructions

## Getting Started

Open `index.html` in any modern browser. No installation or build step required.

## Input Panel

### Personal Info
- **Current Age** — Your age today.
- **Retirement Age** — When you plan to stop working.
- **Life Expectancy** — How long to project finances (default: 90).
- **Annual Income** — Your current gross salary. Used to calculate employer match amounts.
- **Monthly Expenses in Retirement** — Estimated monthly spending after you retire.

### Retirement Accounts
Click **+ Add Account** to add an account. Choose a preset (401(k), Roth IRA, Traditional IRA, Brokerage, HSA) or select "Custom Account" to name your own.

Each account has:
- **Tax Treatment** — Determines how withdrawals are taxed:
  - *Pre-tax* (401(k), Traditional IRA) — taxed at your effective rate on withdrawal.
  - *Roth / Post-tax* (Roth IRA, HSA) — tax-free withdrawals.
  - *Taxable* (Brokerage) — estimated capital gains tax on growth portion.
- **Current Balance** — What you have in the account today.
- **Monthly Contribution** — How much you add each month.
- **Employer Match** — Only shown for pre-tax accounts. Enter the match percentage and the salary cap it applies to.
- **Annual Return** — Expected yearly growth rate (default: 7%).

Click an account header to collapse/expand it. Click the **X** to remove it.

### General Settings
- **Inflation Rate** — Annual inflation assumption (default: 3%).
- **Monthly Social Security** — Expected Social Security benefit (default: $1,800).
- **Social Security Start Age** — When benefits begin (default: 67).
- **Effective Tax Rate in Retirement** — Applied to pre-tax withdrawals (default: 20%).

## Output Panel

### Summary Cards
Four cards showing totals at retirement age:
- **Total at Retirement** — Combined balance across all accounts.
- **Inflation-Adjusted** — That total in today's dollars.
- **Monthly Income (After Tax)** — Estimated monthly income from savings + Social Security.
- **Years of Coverage** — How many years your savings can fund your expenses.

### Portfolio Projection Chart
A line chart showing each account's balance and the combined total from now through life expectancy. A dashed red line marks your retirement age.

### Tax Breakdown
Shows how your retirement savings split across tax treatments and the estimated monthly tax impact on your income.

### Year-by-Year Table
A scrollable table with per-account balances, total, and inflation-adjusted total for every year. The retirement year row is highlighted.

## Saving Your Data
All inputs and accounts are automatically saved to your browser's local storage. Your data persists across page refreshes and browser restarts. To start fresh, clear your browser's local storage for this page.

## Notes
- All calculations use monthly compounding.
- Post-retirement, withdrawals are drawn proportionally from all accounts.
- The app runs entirely in your browser — no data is sent anywhere.
