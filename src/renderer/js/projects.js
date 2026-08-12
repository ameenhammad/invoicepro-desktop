import { state } from "./state.js";
import { escapeHtml, formatCurrency, formatDate } from "../../shared/utils.js";
import { PROJECT_TYPES } from "../../shared/constants.js";
import { showModal, closeModal, modalTitle, modalBody, modalFooter } from "./modal.js";
import { navigateTo } from "./navigation.js";

let projects = [];
let currentProjectId = null;

const STATUS_LABELS = {
  quotation: "Quotation",
  confirmed: "Confirmed",
  in_progress: "In Progress",
  completed: "Completed",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export async function loadProjects() {
  const statusFilter = document.getElementById("project-status-filter")?.value || "";
  const filters = {};
  if (statusFilter) filters.status = statusFilter;

  const result = await window.api.projects.getAll(state.sessionToken, filters);
  if (!result.success) return;
  projects = result.data;

  const tbody = document.getElementById("projects-body");
  tbody.innerHTML =
    projects
      .map(
        (p) => `
    <tr>
      <td>${escapeHtml(p.project_number)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.customer_name)}</td>
      <td>${escapeHtml(p.project_type)}</td>
      <td><span class="status-badge project-status-${p.status}">${STATUS_LABELS[p.status] || p.status}</span></td>
      <td>${formatCurrency(p.quoted_amount)}</td>
      <td>${formatCurrency(p.amount_received)}</td>
      <td>${formatCurrency(p.total_cost)}</td>
      <td class="${p.profit >= 0 ? "text-success" : "text-danger"}">${formatCurrency(p.profit)}</td>
      <td class="actions" data-id="${p.id}">
        <button class="view-project-btn">View</button>
      </td>
    </tr>
  `,
      )
      .join("") || `<tr><td colspan="10" class="text-muted">No projects yet</td></tr>`;

  tbody.querySelectorAll(".view-project-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      viewProject(id);
    });
  });
}

document.getElementById("add-project-btn")?.addEventListener("click", () => showProjectModal());
document.getElementById("project-status-filter")?.addEventListener("change", () => loadProjects());

export async function showProjectModal(project = null) {
  const clientsResult = await window.api.clients.getAll(state.sessionToken);
  const clients = clientsResult.success ? clientsResult.data : [];

  modalTitle.textContent = project ? "Edit Project" : "Add Project";
  modalBody.innerHTML = `
    <form id="project-form">
      <div class="form-row">
        <div class="form-group">
          <label for="project-customer">Customer *</label>
          <select id="project-customer" required>
            <option value="">Select a customer...</option>
            ${clients.map((c) => `<option value="${c.id}" ${project?.customer_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="project-type">Project Type</label>
          <select id="project-type">
            ${PROJECT_TYPES.map((t) => `<option value="${t}" ${(project?.project_type || "Doors") === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label for="project-name">Project Name *</label>
        <input type="text" id="project-name" required value="${project ? escapeHtml(project.name) : ""}">
      </div>
      <div class="form-group">
        <label for="project-description">Description</label>
        <textarea id="project-description">${project ? escapeHtml(project.description || "") : ""}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="project-start-date">Start Date</label>
          <input type="date" id="project-start-date" value="${project?.start_date || ""}">
        </div>
        <div class="form-group">
          <label for="project-expected-completion">Expected Completion</label>
          <input type="date" id="project-expected-completion" value="${project?.expected_completion_date || ""}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="project-status">Status</label>
          <select id="project-status">
            ${Object.entries(STATUS_LABELS)
              .map(([val, label]) => `<option value="${val}" ${(project?.status || "quotation") === val ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="project-quoted-amount">Quoted / Contract Amount</label>
          <input type="number" id="project-quoted-amount" step="0.01" min="0" value="${project ? project.quoted_amount : "0"}">
        </div>
      </div>
      <div class="form-group">
        <label for="project-notes">Notes</label>
        <textarea id="project-notes">${project ? escapeHtml(project.notes || "") : ""}</textarea>
      </div>
    </form>
  `;
  modalFooter.innerHTML = `
    <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="modal-save-project-btn">Save</button>
  `;
  document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
  document
    .getElementById("modal-save-project-btn")
    ?.addEventListener("click", () => saveProject(project ? project.id : null));
  showModal();
}

async function saveProject(id) {
  const data = {
    customer_id: parseInt(document.getElementById("project-customer").value) || null,
    name: document.getElementById("project-name").value,
    project_type: document.getElementById("project-type").value,
    description: document.getElementById("project-description").value,
    start_date: document.getElementById("project-start-date").value,
    expected_completion_date: document.getElementById("project-expected-completion").value,
    status: document.getElementById("project-status").value,
    quoted_amount: parseFloat(document.getElementById("project-quoted-amount").value) || 0,
    notes: document.getElementById("project-notes").value,
  };

  if (!data.customer_id) {
    alert("Please select a customer");
    return;
  }
  if (!data.name) {
    alert("Project name is required");
    return;
  }

  const result = id
    ? await window.api.projects.update(state.sessionToken, id, data)
    : await window.api.projects.create(state.sessionToken, data);

  if (!result.success) {
    alert(result.error?.message || "Failed to save project");
    return;
  }

  closeModal();
  if (id && state.currentView === "view-project") {
    viewProject(id);
  } else {
    loadProjects();
  }
}

export async function viewProject(id) {
  currentProjectId = id;
  const result = await window.api.projects.get(state.sessionToken, id);
  if (!result.success) return;

  const p = result.data;
  document.getElementById("vp-title").textContent = `${p.project.project_number} — ${p.project.name}`;
  document.getElementById("vp-status").innerHTML =
    `<span class="status-badge project-status-${p.project.status}">${STATUS_LABELS[p.project.status] || p.project.status}</span>`;
  document.getElementById("vp-customer").textContent = p.customer?.name || "-";
  document.getElementById("vp-type").textContent = p.project.project_type;
  document.getElementById("vp-dates").textContent =
    `${formatDate(p.project.start_date) || "-"} → ${formatDate(p.project.expected_completion_date) || "-"}`;
  document.getElementById("vp-description").textContent = p.project.description || "-";
  document.getElementById("vp-notes").textContent = p.project.notes || "-";

  document.getElementById("vp-quoted-amount").textContent = formatCurrency(p.project.quoted_amount);
  document.getElementById("vp-invoiced").textContent = formatCurrency(p.invoiced);
  document.getElementById("vp-amount-received").textContent = formatCurrency(p.amountReceived);
  document.getElementById("vp-outstanding").textContent = formatCurrency(p.outstanding);
  document.getElementById("vp-total-cost").textContent = formatCurrency(p.totalCost);
  document.getElementById("vp-cost-paid").textContent = formatCurrency(p.costPaid);
  const profitEl = document.getElementById("vp-profit");
  profitEl.textContent = formatCurrency(p.profit);
  profitEl.className = `card-value ${p.profit >= 0 ? "text-success" : "text-danger"}`;
  document.getElementById("vp-profit-margin").textContent =
    p.profitMargin === null ? "—" : `${p.profitMargin.toFixed(1)}%`;
  document.getElementById("vp-estimated-profit").textContent = formatCurrency(p.estimatedProfit);

  document.getElementById("vp-cost-breakdown-body").innerHTML =
    p.costBreakdown
      .map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${formatCurrency(row.total)}</td></tr>`)
      .join("") || `<tr><td colspan="2" class="text-muted">No costs recorded yet</td></tr>`;

  document.getElementById("vp-invoices-body").innerHTML =
    p.invoices
      .map(
        (inv) => `
      <tr>
        <td>${escapeHtml(inv.invoice_number)}</td>
        <td>${formatCurrency(inv.total)}</td>
        <td>${formatCurrency(inv.paid_amount || 0)}</td>
        <td><span class="status-badge ${inv.status}">${inv.status}</span></td>
        <td>${formatDate(inv.issue_date)}</td>
        <td><button class="unlink-invoice-btn" data-id="${inv.id}">Unlink</button></td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="6" class="text-muted">No invoices linked yet</td></tr>`;
  document.getElementById("vp-invoices-body").querySelectorAll(".unlink-invoice-btn").forEach((btn) => {
    btn.addEventListener("click", () => unlinkInvoice(parseInt(btn.dataset.id)));
  });

  document.getElementById("vp-payments-body").innerHTML =
    p.payments
      .map(
        (pay) => `
      <tr>
        <td>${formatDate(pay.payment_date)}</td>
        <td>${escapeHtml(pay.invoice_number)}</td>
        <td>${formatCurrency(pay.amount)}</td>
        <td>${escapeHtml(pay.method || "-")}</td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="4" class="text-muted">No payments received yet</td></tr>`;

  document.getElementById("vp-expenses-body").innerHTML =
    p.expenses
      .map(
        (e) => `
      <tr>
        <td>${formatDate(e.expense_date)}</td>
        <td>${escapeHtml(e.category)}${e.worker_name ? ` <span class="text-muted">(${escapeHtml(e.worker_name)})</span>` : ""}</td>
        <td>${formatCurrency(e.amount)}</td>
        <td><span class="status-badge ${e.status}">${e.status}</span></td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="4" class="text-muted">No expenses linked yet</td></tr>`;

  document.getElementById("vp-purchases-body").innerHTML =
    (p.purchases || [])
      .map(
        (pu) => `
      <tr>
        <td>${escapeHtml(pu.purchase_number)}</td>
        <td>${escapeHtml(pu.supplier_name)}</td>
        <td>${formatCurrency(pu.total)}</td>
        <td>${formatCurrency(pu.paid_amount || 0)}</td>
        <td><span class="status-badge ${pu.status}">${pu.status}</span></td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="5" class="text-muted">No purchases linked yet</td></tr>`;

  await populateLinkInvoiceSelect(id);

  document.getElementById("vp-edit-btn").onclick = () => showProjectModal(p.project);
  document.getElementById("vp-back-btn").onclick = () => navigateTo("projects");

  navigateTo("view-project");
}

async function populateLinkInvoiceSelect(projectId) {
  const result = await window.api.invoices.getAll(state.sessionToken);
  if (!result.success) return;
  const unlinked = result.data.filter((inv) => !inv.project_id);
  const select = document.getElementById("vp-link-invoice-select");
  select.innerHTML =
    '<option value="">Select an invoice to link...</option>' +
    unlinked
      .map((inv) => `<option value="${inv.id}">${escapeHtml(inv.invoice_number)} — ${escapeHtml(inv.client_name)} (${formatCurrency(inv.total)})</option>`)
      .join("");
}

document.getElementById("vp-link-invoice-btn")?.addEventListener("click", async () => {
  const invoiceId = parseInt(document.getElementById("vp-link-invoice-select").value);
  if (!invoiceId || !currentProjectId) return;
  const result = await window.api.invoices.update(state.sessionToken, invoiceId, { project_id: currentProjectId });
  if (result.success) {
    viewProject(currentProjectId);
  } else {
    alert(result.error?.message || "Failed to link invoice");
  }
});

async function unlinkInvoice(invoiceId) {
  if (!confirm("Unlink this invoice from the project? The invoice itself is not affected.")) return;
  const result = await window.api.invoices.update(state.sessionToken, invoiceId, { project_id: null });
  if (result.success && currentProjectId) {
    viewProject(currentProjectId);
  } else if (!result.success) {
    alert(result.error?.message || "Failed to unlink invoice");
  }
}
