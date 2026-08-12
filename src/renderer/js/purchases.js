import { state } from "./state.js";
import { escapeHtml, formatCurrency, formatDate } from "../../shared/utils.js";
import { PAYMENT_METHODS } from "../../shared/constants.js";
import { showModal, closeModal, modalTitle, modalBody, modalFooter } from "./modal.js";
import { navigateTo } from "./navigation.js";

let purchaseItems = [];
let allVariants = []; // flattened {id, label, product_id} across every product, for the item picker
let currentPurchaseId = null;

export async function loadPurchases() {
  const supplierFilter = document.getElementById("purchase-supplier-filter")?.value || "";
  const statusFilter = document.getElementById("purchase-status-filter")?.value || "";

  const filters = {};
  if (supplierFilter) filters.supplierId = parseInt(supplierFilter);
  if (statusFilter) filters.status = statusFilter;

  const suppliersResult = await window.api.suppliers.getAll(state.sessionToken);
  if (suppliersResult.success) {
    const select = document.getElementById("purchase-supplier-filter");
    if (select && !select.dataset.loaded) {
      select.innerHTML =
        '<option value="">All Suppliers</option>' +
        suppliersResult.data.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
      select.dataset.loaded = "1";
    }
  }

  const result = await window.api.purchases.getAll(state.sessionToken, filters);
  if (!result.success) return;

  const tbody = document.getElementById("purchases-body");
  tbody.innerHTML =
    result.data
      .map(
        (p) => `
    <tr>
      <td>${escapeHtml(p.purchase_number)}</td>
      <td>${escapeHtml(p.supplier_name)}</td>
      <td>${formatDate(p.purchase_date)}</td>
      <td>${formatCurrency(p.total)}</td>
      <td>${formatCurrency(p.paid_amount || 0)}</td>
      <td class="${p.total - (p.paid_amount || 0) > 0 ? "text-warning" : "text-success"}">${formatCurrency(p.total - (p.paid_amount || 0))}</td>
      <td><span class="status-badge ${p.status}">${p.status}</span></td>
      <td class="actions" data-id="${p.id}">
        <button class="view-purchase-btn">View</button>
      </td>
    </tr>
  `,
      )
      .join("") || `<tr><td colspan="8" class="text-muted">No purchases yet</td></tr>`;

  tbody.querySelectorAll(".view-purchase-btn").forEach((btn) => {
    btn.addEventListener("click", () => viewPurchase(parseInt(btn.closest("td").dataset.id)));
  });
}

document.getElementById("create-purchase-btn")?.addEventListener("click", () => showCreatePurchaseView());
document.getElementById("purchase-supplier-filter")?.addEventListener("change", () => loadPurchases());
document.getElementById("purchase-status-filter")?.addEventListener("change", () => loadPurchases());

function emptyPurchaseItem() {
  return { variant_id: null, description: "", quantity: 1, unit_cost: 0 };
}

export async function showCreatePurchaseView() {
  purchaseItems = [emptyPurchaseItem()];

  const numResult = await window.api.purchases.nextNumber(state.sessionToken);
  document.getElementById("purchase-number").value = numResult.success ? numResult.data : "";

  const today = new Date().toISOString().split("T")[0];
  document.getElementById("purchase-date").value = today;
  document.getElementById("purchase-accounting-month").value = today.slice(0, 7);
  document.getElementById("purchase-notes").value = "";
  document.getElementById("purchase-status").value = "unpaid";
  document.getElementById("purchase-method").value = "cash";

  const [suppliersResult, projectsResult, productsResult] = await Promise.all([
    window.api.suppliers.getAll(state.sessionToken),
    window.api.projects.getAll(state.sessionToken),
    window.api.products.getAll(state.sessionToken),
  ]);

  const supplierSelect = document.getElementById("purchase-supplier");
  supplierSelect.innerHTML =
    '<option value="">Select a supplier...</option>' +
    (suppliersResult.success ? suppliersResult.data.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("") : "");

  const projectSelect = document.getElementById("purchase-project");
  projectSelect.innerHTML =
    '<option value="">Not linked to a project</option>' +
    (projectsResult.success
      ? projectsResult.data.map((p) => `<option value="${p.id}">${escapeHtml(p.project_number)} — ${escapeHtml(p.name)}</option>`).join("")
      : "");

  // Flatten every active product's variants into one pickable list —
  // purchase items always reference an existing variant, never free text.
  allVariants = [];
  if (productsResult.success) {
    for (const product of productsResult.data) {
      const variantsResult = await window.api.products.getVariants(state.sessionToken, product.id);
      if (variantsResult.success) {
        for (const v of variantsResult.data) {
          allVariants.push({ id: v.id, label: `${product.name} — ${v.size_name}`, product_id: product.id });
        }
      }
    }
  }

  await renderPurchaseItems();
  calculatePurchaseTotal();
  navigateTo("create-purchase");
}

async function renderPurchaseItems() {
  const tbody = document.getElementById("purchase-items-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  purchaseItems.forEach((item, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <select class="purchase-item-variant">
          <option value="">-- Select Product/Variant --</option>
          ${allVariants.map((v) => `<option value="${v.id}" ${item.variant_id == v.id ? "selected" : ""}>${escapeHtml(v.label)}</option>`).join("")}
        </select>
      </td>
      <td><input type="number" class="purchase-item-qty" value="${item.quantity}" min="0.01" step="0.01"></td>
      <td><input type="number" class="purchase-item-cost" value="${item.unit_cost}" min="0" step="0.01"></td>
      <td class="purchase-item-total">${formatCurrency(item.quantity * item.unit_cost)}</td>
      <td><button type="button" class="delete remove-purchase-item-btn">&times;</button></td>
    `;
    tbody.appendChild(tr);

    tr.querySelector(".purchase-item-variant").addEventListener("change", (e) => {
      purchaseItems[idx].variant_id = parseInt(e.target.value) || null;
      const variant = allVariants.find((v) => v.id === purchaseItems[idx].variant_id);
      purchaseItems[idx].description = variant?.label || "";
    });
    tr.querySelector(".purchase-item-qty").addEventListener("input", (e) => {
      purchaseItems[idx].quantity = parseFloat(e.target.value) || 0;
      updateItemRowTotal(tr, purchaseItems[idx]);
    });
    tr.querySelector(".purchase-item-cost").addEventListener("input", (e) => {
      purchaseItems[idx].unit_cost = parseFloat(e.target.value) || 0;
      updateItemRowTotal(tr, purchaseItems[idx]);
    });
    tr.querySelector(".remove-purchase-item-btn").addEventListener("click", async () => {
      purchaseItems.splice(idx, 1);
      await renderPurchaseItems();
      calculatePurchaseTotal();
    });
  });
}

function updateItemRowTotal(row, item) {
  row.querySelector(".purchase-item-total").textContent = formatCurrency(item.quantity * item.unit_cost);
  calculatePurchaseTotal();
}

function calculatePurchaseTotal() {
  const total = purchaseItems.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
  document.getElementById("purchase-total").textContent = formatCurrency(total);
}

document.getElementById("add-purchase-item-btn")?.addEventListener("click", async () => {
  purchaseItems.push(emptyPurchaseItem());
  await renderPurchaseItems();
  calculatePurchaseTotal();
});
document.getElementById("cancel-purchase-btn")?.addEventListener("click", () => navigateTo("purchases"));

document.getElementById("purchase-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const supplierId = parseInt(document.getElementById("purchase-supplier").value);
  if (!supplierId) {
    alert("Please select a supplier");
    return;
  }

  const validItems = purchaseItems.filter((i) => i.variant_id && i.quantity > 0);
  if (validItems.length === 0) {
    alert("At least one item is required");
    return;
  }

  const projectValue = document.getElementById("purchase-project").value;
  const data = {
    supplier_id: supplierId,
    project_id: projectValue ? parseInt(projectValue) : null,
    purchase_date: document.getElementById("purchase-date").value,
    accounting_month: document.getElementById("purchase-accounting-month").value,
    status: document.getElementById("purchase-status").value,
    payment_method: document.getElementById("purchase-method").value,
    notes: document.getElementById("purchase-notes").value,
    items: validItems,
  };

  const result = await window.api.purchases.create(state.sessionToken, data);
  if (result.success) {
    navigateTo("purchases");
  } else {
    alert(result.error?.message || "Failed to create purchase");
  }
});

export async function viewPurchase(id) {
  currentPurchaseId = id;
  const result = await window.api.purchases.get(state.sessionToken, id);
  if (!result.success) return;

  const p = result.data;
  const paid = p.paid_amount || 0;
  const outstanding = p.total - paid;

  document.getElementById("vpu-title").textContent = `Purchase ${p.purchase_number}`;
  document.getElementById("vpu-status").innerHTML = `<span class="status-badge ${p.status}">${p.status}</span>`;
  document.getElementById("vpu-supplier").textContent = p.supplier_name;
  document.getElementById("vpu-date").textContent = formatDate(p.purchase_date);
  document.getElementById("vpu-accounting-month").textContent = p.accounting_month;
  document.getElementById("vpu-notes").textContent = p.notes || "-";

  const projectRow = document.getElementById("vpu-project-row");
  if (p.project_number) {
    document.getElementById("vpu-project").textContent = `${p.project_number} — ${p.project_name}`;
    projectRow.classList.remove("hidden");
  } else {
    projectRow.classList.add("hidden");
  }

  document.getElementById("vpu-total").textContent = formatCurrency(p.total);
  document.getElementById("vpu-paid").textContent = formatCurrency(paid);
  document.getElementById("vpu-outstanding").textContent = formatCurrency(outstanding);

  document.getElementById("vpu-items-body").innerHTML = p.items
    .map(
      (item) => `
    <tr>
      <td>${escapeHtml(item.product_name)}</td>
      <td>${escapeHtml(item.variant_name)}</td>
      <td>${item.quantity}</td>
      <td>${formatCurrency(item.unit_cost)}</td>
      <td>${formatCurrency(item.line_total)}</td>
    </tr>
  `,
    )
    .join("");

  document.getElementById("vpu-payments-body").innerHTML =
    p.payments
      .map(
        (pay) => `
      <tr>
        <td>${formatDate(pay.payment_date)}</td>
        <td>${formatCurrency(pay.amount)}</td>
        <td>${escapeHtml(pay.method || "-")}</td>
        <td>${escapeHtml(pay.reference || "-")}</td>
      </tr>
    `,
      )
      .join("") || `<tr><td colspan="4" class="text-muted">No payments recorded yet</td></tr>`;

  const recordPaymentBtn = document.getElementById("vpu-record-payment-btn");
  recordPaymentBtn.style.display = outstanding > 0.005 ? "" : "none";
  recordPaymentBtn.onclick = () => showPurchasePaymentModal(id, p.total, outstanding);

  document.getElementById("vpu-back-btn").onclick = () => navigateTo("purchases");

  navigateTo("view-purchase");
}

function showPurchasePaymentModal(purchaseId, total, remaining) {
  modalTitle.textContent = "Record Purchase Payment";
  modalBody.innerHTML = `
    <form id="purchase-payment-form">
      <div class="form-group">
        <label for="purchase-payment-amount">Amount *</label>
        <input type="number" id="purchase-payment-amount" required step="0.01" min="0.01" value="${remaining.toFixed(2)}">
        <small class="helper-text">Remaining: ${formatCurrency(remaining)}</small>
      </div>
      <div class="form-group">
        <label for="purchase-payment-date">Payment Date</label>
        <input type="date" id="purchase-payment-date" value="${new Date().toISOString().split("T")[0]}">
      </div>
      <div class="form-group">
        <label for="purchase-payment-method">Payment Method</label>
        <select id="purchase-payment-method">
          ${Object.values(PAYMENT_METHODS)
            .map((m) => `<option value="${m}">${m.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}</option>`)
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label for="purchase-payment-reference">Reference</label>
        <input type="text" id="purchase-payment-reference" placeholder="Receipt #, transaction ID, etc.">
      </div>
    </form>
  `;
  modalFooter.innerHTML = `
    <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="modal-save-purchase-payment-btn">Save Payment</button>
  `;
  document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
  document
    .getElementById("modal-save-purchase-payment-btn")
    ?.addEventListener("click", () => savePurchasePayment(purchaseId));
  showModal();
}

async function savePurchasePayment(purchaseId) {
  const amount = parseFloat(document.getElementById("purchase-payment-amount").value);
  if (!amount || amount <= 0) {
    alert("Please enter a valid amount");
    return;
  }

  const data = {
    purchase_id: purchaseId,
    amount,
    payment_date: document.getElementById("purchase-payment-date").value,
    method: document.getElementById("purchase-payment-method").value,
    reference: document.getElementById("purchase-payment-reference").value,
  };

  const result = await window.api.purchasePayments.create(state.sessionToken, data);
  if (result.success) {
    closeModal();
    viewPurchase(purchaseId);
  } else {
    alert(result.error?.message || "Failed to record payment");
  }
}
