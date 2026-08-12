import { state } from "./state.js";
import { formatCurrency, formatDate, escapeHtml } from "../../shared/utils.js";
import { showProductModal } from "./products.js";
import { showClientModal } from "./clients.js";
import { showCreateInvoiceView } from "./invoices.js";
import { showExpenseModal } from "./expenses.js";

// Every cash figure here comes from the cash_transactions ledger
// (cashflow:dashboard), never computed from invoices/expenses directly —
// this is the practical "how's the shop doing" view, not a catalog summary.
export async function loadDashboard() {
  const result = await window.api.cashflow.dashboard(state.sessionToken);
  if (!result.success) return;

  const { today, month, recentTransactions, recentExpenses, recentPayments } = result.data;

  document.getElementById("today-cash-in").textContent = formatCurrency(today.cashIn);
  document.getElementById("today-cash-out").textContent = formatCurrency(today.cashOut);
  const todayNetEl = document.getElementById("today-net-cash");
  todayNetEl.textContent = formatCurrency(today.net);
  todayNetEl.className = `card-value ${today.net >= 0 ? "text-success" : "text-danger"}`;
  document.getElementById("today-sales-received").textContent = formatCurrency(today.salesReceived);
  document.getElementById("today-sales").textContent = formatCurrency(today.sales);
  document.getElementById("today-expenses").textContent = formatCurrency(today.expenses);

  document.getElementById("month-income").textContent = formatCurrency(month.income);
  document.getElementById("month-expenses").textContent = formatCurrency(month.expenses);
  const monthNetEl = document.getElementById("month-net-cash-flow");
  monthNetEl.textContent = formatCurrency(month.net);
  monthNetEl.className = `card-value ${month.net >= 0 ? "text-success" : "text-danger"}`;
  document.getElementById("month-outstanding").textContent = formatCurrency(month.outstanding);
  document.getElementById("month-project-revenue").textContent = formatCurrency(month.projectRevenue);
  document.getElementById("month-workshop-revenue").textContent = formatCurrency(month.workshopRevenue);
  document.getElementById("month-hardware-revenue").textContent = formatCurrency(month.hardwareRevenue);
  document.getElementById("month-purchases").textContent = formatCurrency(month.purchases);
  document.getElementById("month-wages").textContent = formatCurrency(month.wages);
  document.getElementById("month-rent").textContent = formatCurrency(month.rent);
  document.getElementById("month-supplier-payables").textContent = formatCurrency(month.supplierPayables);

  const txnBody = document.getElementById("recent-transactions-body");
  txnBody.innerHTML =
    recentTransactions
      .map(
        (t) => `
      <tr>
        <td>${formatDate(t.txn_date)}</td>
        <td class="${t.direction === "in" ? "text-success" : "text-danger"}">${t.direction === "in" ? "In" : "Out"}</td>
        <td>${formatCurrency(t.amount)}</td>
        <td>${escapeHtml(t.description || "-")}</td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="4" class="text-muted">No cash movement yet</td></tr>`;

  const expBody = document.getElementById("recent-expenses-body");
  expBody.innerHTML =
    recentExpenses
      .map(
        (e) => `
      <tr>
        <td>${formatDate(e.expense_date)}</td>
        <td>${escapeHtml(e.category)}</td>
        <td>${formatCurrency(e.amount)}</td>
        <td><span class="status-badge ${e.status}">${e.status}</span></td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="4" class="text-muted">No expenses recorded yet</td></tr>`;

  const paymentsBody = document.getElementById("recent-payments-body");
  paymentsBody.innerHTML =
    recentPayments
      .map(
        (p) => `
      <tr>
        <td>${formatDate(p.payment_date)}</td>
        <td>${escapeHtml(p.invoice_number)}</td>
        <td>${escapeHtml(p.client_name)}</td>
        <td>${formatCurrency(p.amount)}</td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="4" class="text-muted">No payments received yet</td></tr>`;

  const lowStockResult = await window.api.reports.lowStock(state.sessionToken);
  const lowStockBody = document.getElementById("dash-low-stock-body");
  if (lowStockResult.success) {
    lowStockBody.innerHTML =
      lowStockResult.data
        .slice(0, 6)
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.product_name)}</td>
        <td>${escapeHtml(row.variant_name)}</td>
        <td class="text-danger">${row.stock}</td>
        <td>${row.low_stock_threshold}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">Nothing low on stock</td></tr>`;
  }

  const projectsResult = await window.api.projects.dashboardSummary(state.sessionToken);
  if (projectsResult.success) {
    const pd = projectsResult.data;
    document.getElementById("dash-active-projects").textContent = pd.activeCount;
    document.getElementById("dash-project-outstanding").textContent = formatCurrency(pd.outstandingPayments);
    document.getElementById("dash-project-revenue").textContent = formatCurrency(pd.revenue);
    document.getElementById("dash-project-cost").textContent = formatCurrency(pd.cost);
    const profitEl = document.getElementById("dash-project-profit");
    profitEl.textContent = formatCurrency(pd.profit);
    profitEl.className = `card-value ${pd.profit >= 0 ? "text-success" : "text-danger"}`;

    document.getElementById("dash-nearing-completion-body").innerHTML =
      pd.nearingCompletion
        .map(
          (p) => `
      <tr>
        <td>${escapeHtml(p.project_number)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${formatDate(p.expected_completion_date)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="3" class="text-muted">Nothing due soon</td></tr>`;
  }

  const workshopResult = await window.api.reports.workshopSummary(state.sessionToken);
  if (workshopResult.success) {
    const w = workshopResult.data;
    document.getElementById("dash-sheet-cutting-revenue").textContent = formatCurrency(w.sheetCuttingRevenue);
    document.getElementById("dash-edge-banding-revenue").textContent = formatCurrency(w.edgeBandingRevenue);
    document.getElementById("dash-hardware-sales").textContent = formatCurrency(w.hardwareSales);
    document.getElementById("dash-low-stock-items").textContent = w.lowStockItems;

    document.getElementById("dash-recent-service-sales-body").innerHTML =
      w.recentServiceSales
        .map(
          (s) => `
      <tr>
        <td>${escapeHtml(s.service_name)}</td>
        <td>${s.quantity} ${escapeHtml((s.unit || "").toLowerCase())}</td>
        <td>${formatCurrency(s.line_total)}</td>
        <td>${escapeHtml(s.invoice_number)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">No service sales yet</td></tr>`;

    document.getElementById("dash-recent-hardware-sales-body").innerHTML =
      w.recentHardwareSales
        .map(
          (s) => `
      <tr>
        <td>${escapeHtml(s.product_name)}</td>
        <td>${escapeHtml(s.variant_name || "-")}</td>
        <td>${s.quantity}</td>
        <td>${formatCurrency(s.line_total)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">No hardware sales yet</td></tr>`;
  }

  const [purchasesResult, workersResult] = await Promise.all([
    window.api.purchases.dashboardSummary(state.sessionToken),
    window.api.workers.dashboardSummary(state.sessionToken),
  ]);

  if (purchasesResult.success) {
    const pu = purchasesResult.data;
    document.getElementById("dash-total-purchases").textContent = formatCurrency(pu.totalPurchases);
    document.getElementById("dash-supplier-payables").textContent = formatCurrency(pu.outstandingSupplierPayments);
    document.getElementById("dash-recent-purchases-body").innerHTML =
      pu.recentPurchases
        .map(
          (p) => `
      <tr>
        <td>${escapeHtml(p.purchase_number)}</td>
        <td>${escapeHtml(p.supplier_name)}</td>
        <td>${formatCurrency(p.total)}</td>
        <td><span class="status-badge ${p.status}">${p.status}</span></td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">No purchases yet</td></tr>`;
  }

  if (workersResult.success) {
    const wk = workersResult.data;
    document.getElementById("dash-worker-payments").textContent = formatCurrency(wk.workerPayments);
    document.getElementById("dash-wage-expenses").textContent = formatCurrency(wk.wageExpenses);
    document.getElementById("dash-recent-wage-payments-body").innerHTML =
      wk.recentWagePayments
        .map(
          (p) => `
      <tr>
        <td>${escapeHtml(p.worker_name)}</td>
        <td>${formatCurrency(p.amount)}</td>
        <td>${formatDate(p.expense_date)}</td>
        <td><span class="status-badge ${p.status}">${p.status}</span></td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">No wage payments yet</td></tr>`;
  }
}

document
  .getElementById("dash-add-product-btn")
  ?.addEventListener("click", () => showProductModal());
document
  .getElementById("dash-add-client-btn")
  ?.addEventListener("click", () => showClientModal());
document
  .getElementById("dash-create-invoice-btn")
  ?.addEventListener("click", () => showCreateInvoiceView());
document
  .getElementById("dash-add-expense-btn")
  ?.addEventListener("click", () => showExpenseModal());
