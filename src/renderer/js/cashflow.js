import { state } from "./state.js";
import { escapeHtml, formatCurrency, formatDate } from "../../shared/utils.js";

// 'today' | 'month' | 'custom' — drives which filters get sent to the
// backend; 'today'/'month' are computed here, 'custom' reads the date
// inputs directly.
let activePeriod = "today";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function currentPeriodFilters() {
  const scope = document.getElementById("cashflow-scope")?.value || "business";
  if (activePeriod === "today") {
    const d = todayStr();
    return { scope, fromDate: d, toDate: d };
  }
  if (activePeriod === "month") {
    return { scope, accountingMonth: todayStr().slice(0, 7) };
  }
  // custom
  const fromDate = document.getElementById("cashflow-from-date")?.value;
  const toDate = document.getElementById("cashflow-to-date")?.value;
  return { scope, fromDate: fromDate || undefined, toDate: toDate || undefined };
}

export async function loadCashFlow() {
  document.querySelectorAll(".cashflow-period-selector [data-period]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.period === activePeriod);
  });
  document
    .getElementById("cashflow-custom-range")
    ?.classList.toggle("hidden", activePeriod !== "custom");

  const filters = currentPeriodFilters();

  const [summaryResult, incomeResult, expenseResult, methodResult, txnResult] = await Promise.all([
    window.api.cashflow.summary(state.sessionToken, filters),
    window.api.cashflow.incomeBySource(state.sessionToken, filters),
    window.api.cashflow.expensesByCategory(state.sessionToken, filters),
    window.api.cashflow.byPaymentMethod(state.sessionToken, filters),
    window.api.cashflow.transactions(state.sessionToken, { ...filters, limit: 50 }),
  ]);

  if (summaryResult.success) {
    const { cashIn, cashOut, net, balance, openingBalance } = summaryResult.data;
    document.getElementById("cf-cash-in").textContent = formatCurrency(cashIn);
    document.getElementById("cf-cash-out").textContent = formatCurrency(cashOut);
    const netEl = document.getElementById("cf-net");
    netEl.textContent = formatCurrency(net);
    netEl.className = `card-value ${net >= 0 ? "text-success" : "text-danger"}`;
    document.getElementById("cf-opening-balance").textContent =
      openingBalance === null ? "—" : formatCurrency(openingBalance);
    document.getElementById("cf-balance").textContent = formatCurrency(balance);
  }

  if (incomeResult.success) {
    document.getElementById("cf-income-by-source-body").innerHTML =
      incomeResult.data
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(formatSourceType(row.source_type))}</td>
        <td>${formatCurrency(row.total)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="2" class="text-muted">No income in this period</td></tr>`;
  }

  if (expenseResult.success) {
    document.getElementById("cf-expenses-by-category-body").innerHTML =
      expenseResult.data
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.category)}</td>
        <td>${formatCurrency(row.total)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="2" class="text-muted">No expenses in this period</td></tr>`;
  }

  if (methodResult.success) {
    document.getElementById("cf-by-method-body").innerHTML =
      methodResult.data
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.method)}</td>
        <td>${row.direction === "in" ? "Cash In" : "Cash Out"}</td>
        <td>${formatCurrency(row.total)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="3" class="text-muted">No transactions in this period</td></tr>`;
  }

  if (txnResult.success) {
    document.getElementById("cf-transactions-body").innerHTML =
      txnResult.data
        .map(
          (t) => `
      <tr>
        <td>${formatDate(t.txn_date)}</td>
        <td class="${t.direction === "in" ? "text-success" : "text-danger"}">${t.direction === "in" ? "In" : "Out"}</td>
        <td>${formatCurrency(t.amount)}</td>
        <td>${escapeHtml(t.method || "-")}</td>
        <td>${escapeHtml(formatSourceType(t.source_type))}</td>
        <td>${escapeHtml(t.description || "-")}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="6" class="text-muted">No transactions in this period</td></tr>`;
  }
}

function formatSourceType(sourceType) {
  if (!sourceType) return "-";
  return sourceType
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

document.querySelectorAll(".cashflow-period-selector [data-period]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activePeriod = btn.dataset.period;
    loadCashFlow();
  });
});
document.getElementById("cashflow-scope")?.addEventListener("change", () => loadCashFlow());
document.getElementById("apply-cashflow-range-btn")?.addEventListener("click", () => loadCashFlow());
