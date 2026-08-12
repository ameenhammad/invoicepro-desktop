import { state } from "./state.js";
import { formatCurrency, formatDate, escapeHtml } from "../../shared/utils.js";
import { PROJECT_TYPES, PROJECT_STATUS } from "../../shared/constants.js";

export async function loadReports() {
  const clientsResult = await window.api.clients.getAll(state.sessionToken);
  if (clientsResult.success) {
    const select = document.getElementById("report-client");
    select.innerHTML =
      '<option value="">All Clients</option>' +
      clientsResult.data
        .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
        .join("");
  }

  const statusSelect = document.getElementById("report-project-status-filter");
  if (statusSelect && statusSelect.options.length <= 1) {
    statusSelect.innerHTML +=
      Object.values(PROJECT_STATUS)
        .map((s) => `<option value="${s}">${escapeHtml(s.replace("_", " "))}</option>`)
        .join("");
  }
  const typeSelect = document.getElementById("report-project-type-filter");
  if (typeSelect && typeSelect.options.length <= 1) {
    typeSelect.innerHTML +=
      PROJECT_TYPES.map((t) => `<option value="${t}">${escapeHtml(t)}</option>`).join("");
  }

  await loadManagementSummary();
}

document
  .getElementById("apply-report-filters-btn")
  ?.addEventListener("click", applyReportFilters);

// Management Summary — every figure here comes from an endpoint that
// already exists elsewhere in the app (cashflow, purchases, workers,
// inventory, projects). Nothing is recalculated here, so it can never
// drift from what those other pages show. Cash flow and project profit
// are kept in visually separate sections and never combined into one
// "profit" number.
async function loadManagementSummary() {
  const month = new Date().toISOString().slice(0, 7);

  const [cashflowResult, purchasesResult, inventoryResult, projectsResult] = await Promise.all([
    window.api.cashflow.summary(state.sessionToken, { scope: "business", accountingMonth: month }),
    window.api.purchases.dashboardSummary(state.sessionToken),
    window.api.reports.inventoryValue(state.sessionToken),
    window.api.projects.dashboardSummary(state.sessionToken),
  ]);

  if (cashflowResult.success) {
    const { cashIn, cashOut, net } = cashflowResult.data;
    document.getElementById("summary-business-income").textContent = formatCurrency(cashIn);
    document.getElementById("summary-business-expenses").textContent = formatCurrency(cashOut);
    const netEl = document.getElementById("summary-net-cash-flow");
    netEl.textContent = formatCurrency(net);
    netEl.className = `card-value ${net >= 0 ? "text-success" : "text-danger"}`;
  }

  // Outstanding receivables is already computed by cashflow:dashboard —
  // reuse it rather than a third copy of the same accrual query.
  const dashboardResult = await window.api.cashflow.dashboard(state.sessionToken);
  if (dashboardResult.success) {
    document.getElementById("summary-receivables").textContent =
      formatCurrency(dashboardResult.data.month.outstanding);
  }

  if (purchasesResult.success) {
    document.getElementById("summary-payables").textContent =
      formatCurrency(purchasesResult.data.outstandingSupplierPayments);
  }

  if (inventoryResult.success) {
    document.getElementById("summary-inventory-value").textContent =
      formatCurrency(inventoryResult.data.cost_value);
  }

  if (projectsResult.success) {
    const { revenue, cost, profit } = projectsResult.data;
    document.getElementById("summary-project-revenue").textContent = formatCurrency(revenue);
    document.getElementById("summary-project-cost").textContent = formatCurrency(cost);
    const profitEl = document.getElementById("summary-project-profit");
    profitEl.textContent = formatCurrency(profit);
    profitEl.className = `card-value ${profit >= 0 ? "text-success" : "text-danger"}`;
  }
}

// Income by category — same Today/Month/Custom/All-time period pattern as
// the Cash Flow page.
let incomePeriod = "today";

function incomePeriodFilters() {
  if (incomePeriod === "today") {
    const d = new Date().toISOString().split("T")[0];
    return { fromDate: d, toDate: d };
  }
  if (incomePeriod === "month") {
    return { accountingMonth: new Date().toISOString().slice(0, 7) };
  }
  if (incomePeriod === "custom") {
    const fromDate = document.getElementById("income-from-date")?.value;
    const toDate = document.getElementById("income-to-date")?.value;
    return { fromDate: fromDate || undefined, toDate: toDate || undefined };
  }
  return {}; // all time
}

async function loadIncomeBreakdown() {
  document.querySelectorAll("#income-period-selector [data-period]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.period === incomePeriod);
  });
  document
    .getElementById("income-custom-range")
    ?.classList.toggle("hidden", incomePeriod !== "custom");

  const result = await window.api.reports.incomeBreakdown(state.sessionToken, incomePeriodFilters());
  if (!result.success) return;
  document.getElementById("income-breakdown-body").innerHTML =
    result.data
      .map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${formatCurrency(row.amount)}</td></tr>`)
      .join("") || `<tr><td colspan="2" class="text-muted">No income in this period</td></tr>`;
}

document.querySelectorAll("#income-period-selector [data-period]").forEach((btn) => {
  btn.addEventListener("click", () => {
    incomePeriod = btn.dataset.period;
    loadIncomeBreakdown();
  });
});
document.getElementById("apply-income-range-btn")?.addEventListener("click", loadIncomeBreakdown);

async function loadBusinessVsPersonal() {
  const month = new Date().toISOString().slice(0, 7);
  const [businessResult, personalResult] = await Promise.all([
    window.api.cashflow.summary(state.sessionToken, { scope: "business", accountingMonth: month }),
    window.api.cashflow.summary(state.sessionToken, { scope: "personal", accountingMonth: month }),
  ]);

  const rows = (r) =>
    r.success
      ? `
      <tr><td>Income</td><td>${formatCurrency(r.data.cashIn)}</td></tr>
      <tr><td>Expenses</td><td>${formatCurrency(r.data.cashOut)}</td></tr>
      <tr><td>Net</td><td class="${r.data.net >= 0 ? "text-success" : "text-danger"}">${formatCurrency(r.data.net)}</td></tr>
    `
      : "";

  document.getElementById("bp-business-body").innerHTML = rows(businessResult);
  document.getElementById("bp-personal-body").innerHTML = rows(personalResult);
}

async function loadDataIntegrity() {
  const body = document.getElementById("data-integrity-body");
  body.innerHTML = `<tr><td colspan="3" class="text-muted">Running checks…</td></tr>`;

  const result = await window.api.reports.dataIntegrityCheck(state.sessionToken);
  if (!result.success) {
    body.innerHTML = `<tr><td colspan="3" class="text-danger">Failed to run checks: ${escapeHtml(result.error?.message || "unknown error")}</td></tr>`;
    return;
  }

  body.innerHTML = result.data.checks
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.label)}</td>
      <td><span class="status-badge ${c.status === "pass" ? "paid" : "pending"}">${c.status === "pass" ? "Pass" : "Fail"}</span></td>
      <td>${c.status === "pass" ? "—" : `${c.details.length} issue(s) found`}</td>
    </tr>
  `,
    )
    .join("");
}

document.getElementById("run-data-integrity-btn")?.addEventListener("click", loadDataIntegrity);

async function applyReportFilters() {
  const filters = {};
  const fromDate = document.getElementById("report-from-date").value;
  const toDate = document.getElementById("report-to-date").value;
  const clientId = document.getElementById("report-client").value;
  if (fromDate) filters.fromDate = fromDate;
  if (toDate) filters.toDate = toDate;
  if (clientId) filters.clientId = parseInt(clientId);

  const result = await window.api.reports.revenue(state.sessionToken, filters);
  if (result.success) {
    document.getElementById("report-total-revenue").textContent =
      formatCurrency(result.data.total);
    document.getElementById("report-product-revenue").textContent =
      formatCurrency(result.data.productRevenue);
    document.getElementById("report-service-revenue").textContent =
      formatCurrency(result.data.serviceRevenue);
    document.getElementById("report-invoice-count").textContent =
      result.data.invoices.length;
    document.getElementById("revenue-body").innerHTML = result.data.invoices
      .map(
        (inv) => `
      <tr>
        <td>${escapeHtml(inv.invoice_number)}</td>
        <td>${escapeHtml(inv.client_name)}</td>
        <td>${formatDate(inv.issue_date)}</td>
        <td>${formatCurrency(inv.total)}</td>
      </tr>
    `,
      )
      .join("");
  }
}

async function loadSalesAnalytics(period = "monthly") {
  document
    .querySelectorAll(".report-period-selector [data-period]")
    .forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.period === period);
    });
  const result = await window.api.reports.salesAnalytics(
    state.sessionToken,
    period,
  );
  if (!result.success) return;
  document.getElementById("sales-analytics-body").innerHTML = result.data
    .map(
      (row) => `
    <tr>
      <td>${row.period}</td>
      <td>${row.invoice_count}</td>
      <td>${formatCurrency(row.total_revenue)}</td>
    </tr>
  `,
    )
    .join("");
}

async function loadTopProducts(limit = 10) {
  const result = await window.api.reports.topProducts(state.sessionToken, limit);
  if (!result.success) return;
  document.getElementById("top-products-body").innerHTML = result.data
    .map(
      (row) => `
    <tr>
      <td>${escapeHtml(row.product_name)}</td>
      <td>${escapeHtml(row.variant_name)}</td>
      <td>${row.total_sold}</td>
      <td>${formatCurrency(row.total_revenue)}</td>
    </tr>
  `,
    )
    .join("");
}

async function loadTopServices(limit = 10) {
  const result = await window.api.reports.topServices(state.sessionToken, limit);
  if (!result.success) return;
  document.getElementById("top-services-body").innerHTML = result.data
    .map(
      (row) => `
    <tr>
      <td>${escapeHtml(row.service_name)}</td>
      <td>${row.total_sold}</td>
      <td>${formatCurrency(row.total_revenue)}</td>
    </tr>
  `,
    )
    .join("");
}

async function loadOutstanding() {
  const result = await window.api.reports.pending(state.sessionToken);
  if (!result.success) return;
  document.getElementById("outstanding-body").innerHTML = result.data
    .map((inv) => {
      const paid = inv.paid_amount || 0;
      const due = inv.total - paid;
      return `
    <tr>
      <td>${escapeHtml(inv.invoice_number)}</td>
      <td>${escapeHtml(inv.client_name)}</td>
      <td>${formatCurrency(inv.total)}</td>
      <td>${formatCurrency(paid)}</td>
      <td class="text-warning">${formatCurrency(due)}</td>
      <td>${formatDate(inv.due_date)}</td>
    </tr>
  `;
    })
    .join("");
}

async function loadStockLevels() {
  const [levelsResult, valueResult, receivedResult] = await Promise.all([
    window.api.reports.stockLevels(state.sessionToken),
    window.api.reports.inventoryValue(state.sessionToken),
    window.api.reports.stockReceived(state.sessionToken),
  ]);
  if (levelsResult.success) {
    document.getElementById("stock-levels-body").innerHTML = levelsResult.data
      .map(
        (row) => `
    <tr>
      <td>${escapeHtml(row.product_name)}</td>
      <td>${escapeHtml(row.variant_name)}</td>
      <td>${escapeHtml(row.sku || "-")}</td>
      <td>${formatCurrency(row.price)}</td>
      <td class="${row.stock <= row.low_stock_threshold ? "text-danger" : ""}">${row.stock}</td>
      <td>${row.low_stock_threshold}</td>
    </tr>
  `,
      )
      .join("");
  }
  if (valueResult.success) {
    document.getElementById("report-inventory-cost-value").textContent = formatCurrency(valueResult.data.cost_value);
    document.getElementById("report-inventory-retail-value").textContent = formatCurrency(valueResult.data.retail_value);
  }
  if (receivedResult.success) {
    document.getElementById("stock-received-body").innerHTML =
      receivedResult.data
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.product_name)}</td>
        <td>${escapeHtml(row.variant_name)}</td>
        <td>${row.quantity_received}</td>
        <td>${formatCurrency(row.value_received)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">No purchases received yet</td></tr>`;
  }
}

async function loadLowStock() {
  const result = await window.api.reports.lowStock(state.sessionToken);
  if (!result.success) return;
  document.getElementById("low-stock-body").innerHTML = result.data
    .map(
      (row) => `
    <tr>
      <td>${escapeHtml(row.product_name)}</td>
      <td>${escapeHtml(row.variant_name)}</td>
      <td>${escapeHtml(row.sku || "-")}</td>
      <td class="text-danger">${row.stock}</td>
      <td>${row.low_stock_threshold}</td>
    </tr>
  `,
    )
    .join("");
}

async function loadProjectProfitability() {
  const filters = {};
  const status = document.getElementById("report-project-status-filter")?.value;
  const projectType = document.getElementById("report-project-type-filter")?.value;
  const fromDate = document.getElementById("report-project-from-date")?.value;
  const toDate = document.getElementById("report-project-to-date")?.value;
  if (status) filters.status = status;
  if (projectType) filters.projectType = projectType;
  if (fromDate) filters.fromDate = fromDate;
  if (toDate) filters.toDate = toDate;

  const result = await window.api.projects.getAll(state.sessionToken, filters);
  if (!result.success) return;
  document.getElementById("report-projects-body").innerHTML =
    result.data
      .map(
        (p) => `
    <tr>
      <td>${escapeHtml(p.project_number)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.status)}</td>
      <td>${formatCurrency(p.quoted_amount)}</td>
      <td>${formatCurrency(p.amount_received)}</td>
      <td>${formatCurrency(p.total_cost)}</td>
      <td class="${p.profit >= 0 ? "text-success" : "text-danger"}">${formatCurrency(p.profit)}</td>
      <td>${p.profit_margin === null ? "—" : p.profit_margin.toFixed(1) + "%"}</td>
    </tr>
  `,
      )
      .join("") || `<tr><td colspan="8" class="text-muted">No projects match these filters</td></tr>`;
}

document
  .getElementById("apply-project-report-filter-btn")
  ?.addEventListener("click", loadProjectProfitability);

async function loadWorkshopRevenue() {
  const [serviceRevenueResult, hardwareRevenueResult, serviceSalesResult, hardwareSalesResult, byMonthResult] = await Promise.all([
    window.api.reports.serviceRevenue(state.sessionToken),
    window.api.reports.hardwareRevenue(state.sessionToken),
    window.api.reports.serviceSalesByType(state.sessionToken),
    window.api.reports.hardwareSalesByProduct(state.sessionToken),
    window.api.reports.serviceSalesByMonth(state.sessionToken),
  ]);

  if (serviceRevenueResult.success)
    document.getElementById("report-workshop-service-revenue").textContent = formatCurrency(serviceRevenueResult.data.value);
  if (hardwareRevenueResult.success)
    document.getElementById("report-workshop-hardware-revenue").textContent = formatCurrency(hardwareRevenueResult.data.value);

  if (serviceSalesResult.success) {
    document.getElementById("report-service-sales-body").innerHTML =
      serviceSalesResult.data
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.service_name)}</td>
        <td>${escapeHtml(row.unit)}</td>
        <td>${row.quantity_sold}</td>
        <td>${formatCurrency(row.revenue)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">No service sales yet</td></tr>`;
  }

  if (hardwareSalesResult.success) {
    document.getElementById("report-hardware-sales-body").innerHTML =
      hardwareSalesResult.data
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.product_name)}</td>
        <td>${escapeHtml(row.variant_name)}</td>
        <td>${row.quantity_sold}</td>
        <td>${formatCurrency(row.revenue)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">No hardware sales yet</td></tr>`;
  }

  if (byMonthResult.success) {
    document.getElementById("report-service-sales-by-month-body").innerHTML =
      byMonthResult.data
        .map((row) => `<tr><td>${escapeHtml(row.period)}</td><td>${formatCurrency(row.revenue)}</td></tr>`)
        .join("") || `<tr><td colspan="2" class="text-muted">No service sales yet</td></tr>`;
  }
}

async function loadStockMovements() {
  const reason = document.getElementById("stock-movement-reason-filter")?.value || "";
  const filters = {};
  if (reason) filters.reason = reason;

  const result = await window.api.reports.stockMovements(state.sessionToken, filters);
  if (!result.success) return;

  document.getElementById("stock-movements-body").innerHTML =
    result.data
      .map(
        (m) => `
    <tr>
      <td>${formatDate(m.created_at)}</td>
      <td>${escapeHtml(m.product_name)}</td>
      <td>${escapeHtml(m.variant_name)}</td>
      <td class="${m.change_qty >= 0 ? "text-success" : "text-danger"}">${m.change_qty >= 0 ? "+" : ""}${m.change_qty}</td>
      <td>${m.quantity_before} &rarr; ${m.quantity_after}</td>
      <td>${escapeHtml(m.reason)}</td>
      <td>${escapeHtml(m.notes || "-")}</td>
    </tr>
  `,
      )
      .join("") || `<tr><td colspan="7" class="text-muted">No stock movements yet</td></tr>`;
}

document
  .getElementById("apply-stock-movement-filter-btn")
  ?.addEventListener("click", loadStockMovements);

async function loadPurchasesReport() {
  const [summaryResult, bySupplierResult, byMonthResult] = await Promise.all([
    window.api.reports.purchasesSummary(state.sessionToken),
    window.api.reports.purchasesBySupplier(state.sessionToken),
    window.api.reports.purchasesByMonth(state.sessionToken),
  ]);

  if (summaryResult.success) {
    document.getElementById("report-total-purchases").textContent = formatCurrency(summaryResult.data.totalPurchases);
    document.getElementById("report-purchases-outstanding").textContent = formatCurrency(summaryResult.data.outstandingSupplierPayments);
  }

  if (bySupplierResult.success) {
    document.getElementById("report-purchases-by-supplier-body").innerHTML =
      bySupplierResult.data
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.supplier_name)}</td>
        <td>${formatCurrency(row.total_purchases)}</td>
        <td>${formatCurrency(row.total_paid)}</td>
        <td class="${row.outstanding > 0 ? "text-warning" : "text-success"}">${formatCurrency(row.outstanding)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">No suppliers yet</td></tr>`;
  }

  if (byMonthResult.success) {
    document.getElementById("report-purchases-by-month-body").innerHTML =
      byMonthResult.data
        .map((row) => `<tr><td>${row.accounting_month}</td><td>${formatCurrency(row.total)}</td></tr>`)
        .join("") || `<tr><td colspan="2" class="text-muted">No purchases yet</td></tr>`;
  }
}

async function loadWorkersReport() {
  const [summaryResult, byWorkerResult, byMonthResult, labourResult] = await Promise.all([
    window.api.reports.wagesSummary(state.sessionToken),
    window.api.reports.wagesByWorker(state.sessionToken),
    window.api.reports.wagesByMonth(state.sessionToken),
    window.api.reports.projectLabourCost(state.sessionToken),
  ]);

  if (summaryResult.success) {
    document.getElementById("report-total-wages").textContent = formatCurrency(summaryResult.data.totalWages);
    document.getElementById("report-wages-paid").textContent = formatCurrency(summaryResult.data.wagesPaid);
  }

  if (byWorkerResult.success) {
    document.getElementById("report-wages-by-worker-body").innerHTML =
      byWorkerResult.data
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.worker_name)}</td>
        <td>${escapeHtml(row.role || "-")}</td>
        <td>${formatCurrency(row.total_wages)}</td>
        <td>${formatCurrency(row.paid)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="4" class="text-muted">No workers yet</td></tr>`;
  }

  if (byMonthResult.success) {
    document.getElementById("report-wages-by-month-body").innerHTML =
      byMonthResult.data
        .map((row) => `<tr><td>${row.accounting_month}</td><td>${formatCurrency(row.total)}</td></tr>`)
        .join("") || `<tr><td colspan="2" class="text-muted">No wages yet</td></tr>`;
  }

  if (labourResult.success) {
    document.getElementById("report-project-labour-body").innerHTML =
      labourResult.data
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.project_number)}</td>
        <td>${escapeHtml(row.project_name)}</td>
        <td>${formatCurrency(row.labour_cost)}</td>
      </tr>
    `,
        )
        .join("") || `<tr><td colspan="3" class="text-muted">No project-linked labour yet</td></tr>`;
  }
}

// Report tab switching
document.querySelectorAll(".report-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document
      .querySelectorAll(".report-tab-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".report-tab-content")
      .forEach((c) => c.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${tab}`)?.classList.remove("hidden");
    switch (tab) {
      case "summary":
        loadManagementSummary();
        break;
      case "income":
        loadIncomeBreakdown();
        break;
      case "business-personal":
        loadBusinessVsPersonal();
        break;
      case "data-integrity":
        loadDataIntegrity();
        break;
      case "sales":
        loadSalesAnalytics();
        break;
      case "top-products":
        loadTopProducts();
        break;
      case "top-services":
        loadTopServices();
        break;
      case "stock":
        loadStockLevels();
        break;
      case "low-stock":
        loadLowStock();
        break;
      case "outstanding":
        loadOutstanding();
        break;
      case "projects":
        loadProjectProfitability();
        break;
      case "workshop":
        loadWorkshopRevenue();
        break;
      case "stock-movements":
        loadStockMovements();
        break;
      case "purchases":
        loadPurchasesReport();
        break;
      case "workers":
        loadWorkersReport();
        break;
    }
  });
});

document
  .querySelectorAll(".report-period-selector [data-period]")
  .forEach((btn) => {
    btn.addEventListener("click", () =>
      loadSalesAnalytics(btn.dataset.period),
    );
  });
