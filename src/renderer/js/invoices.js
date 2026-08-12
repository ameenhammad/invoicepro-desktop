import { state } from "./state.js";
import { formatCurrency, formatDate, escapeHtml } from "../../shared/utils.js";
import { navigateTo } from "./navigation.js";
import { showPaymentModal, deletePayment } from "./payments.js";

let lineItems = [];

export async function loadInvoices(filters = {}) {
  const result = await window.api.invoices.getAll(state.sessionToken, filters);
  if (!result.success) return;

  const tbody = document.getElementById("invoices-body");
  tbody.innerHTML = result.data
    .map(
      (inv) => `
    <tr>
      <td>${escapeHtml(inv.invoice_number)}</td>
      <td>${escapeHtml(inv.walkin_customer_name || inv.client_name)}</td>
      <td>${formatCurrency(inv.total)}</td>
      <td><span class="status-badge ${inv.status}">${inv.status}</span></td>
      <td>${formatDate(inv.issue_date)}</td>
      <td>${formatDate(inv.due_date)}</td>
      <td class="actions" data-id="${inv.id}">
        <button class="view-invoice-btn">View</button>
        <button class="delete delete-invoice-btn">Delete</button>
      </td>
    </tr>
  `,
    )
    .join("");

  tbody.querySelectorAll(".view-invoice-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      viewInvoice(id);
    });
  });
  tbody.querySelectorAll(".delete-invoice-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      deleteInvoice(id);
    });
  });
}

export async function viewInvoice(id) {
  state.currentInvoiceId = id;
  const result = await window.api.invoices.get(state.sessionToken, id);
  if (!result.success) return;

  const inv = result.data;
  document.getElementById("view-invoice-title").textContent =
    `Invoice ${inv.invoice_number}`;
  document.getElementById("vi-number").textContent = inv.invoice_number;
  document.getElementById("vi-status").innerHTML =
    `<span class="status-badge ${inv.status}">${inv.status}</span>`;
  document.getElementById("vi-issue-date").textContent = formatDate(
    inv.issue_date,
  );
  const latestPayment = (inv.payments || [])[0];
  document.getElementById("vi-payment-method").textContent = latestPayment
    ? formatPaymentMethod(latestPayment.method)
    : "-";
  const projectRow = document.getElementById("vi-project-row");
  if (inv.project_number) {
    document.getElementById("vi-project").textContent = `${inv.project_number} — ${inv.project_name}`;
    projectRow.classList.remove("hidden");
  } else {
    projectRow.classList.add("hidden");
  }
  document.getElementById("vi-client-name").textContent =
    inv.walkin_customer_name || inv.client_name;
  document.getElementById("vi-client-address").innerHTML = formatAddress(inv);
  document.getElementById("vi-client-contact").innerHTML =
    `${escapeHtml(inv.client_email || "")}<br>${escapeHtml(inv.client_phone || "")}`;

  const itemsBody = document.getElementById("vi-items-body");
  itemsBody.innerHTML = (inv.items || [])
    .map(
      (item) => `
    <tr>
      <td>${itemTypeBadge(item)}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.variant_name || "-")}</td>
      <td>${item.quantity}${item.service_unit ? ` <span class="text-muted">${escapeHtml(item.service_unit.toLowerCase())}</span>` : ""}</td>
      <td>${formatCurrency(item.unit_price)}</td>
      <td>${item.tax_percent || 0}%</td>
      <td>${formatCurrency(item.line_total)}</td>
    </tr>
  `,
    )
    .join("");

  document.getElementById("vi-subtotal").textContent = formatCurrency(
    inv.subtotal,
  );
  document.getElementById("vi-discount").textContent =
    inv.discount_amount > 0
      ? `-${formatCurrency(inv.discount_amount)}`
      : formatCurrency(0);
  document.getElementById("vi-discount-row").style.display =
    inv.discount_amount > 0 ? "block" : "none";
  document.getElementById("vi-tax").textContent = formatCurrency(
    inv.tax_amount,
  );
  document.getElementById("vi-total").textContent = formatCurrency(inv.total);

  const paymentsBody = document.getElementById("vi-payments-body");
  paymentsBody.innerHTML = "";
  (inv.payments || []).forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(p.payment_date)}</td>
      <td>${formatCurrency(p.amount)}</td>
      <td>${escapeHtml(p.method || "N/A")}</td>
      <td>${escapeHtml(p.reference || "")}</td>
      <td><button class="delete delete-payment-btn" data-id="${p.id}">Delete</button></td>
    `;
    paymentsBody.appendChild(tr);
  });

  paymentsBody.querySelectorAll(".delete-payment-btn").forEach((btn) => {
    btn.addEventListener("click", () =>
      deletePayment(parseInt(btn.dataset.id)),
    );
  });

  document.getElementById("add-payment-btn").onclick = () =>
    showPaymentModal(inv.id, inv.total, inv.payments);
  document.getElementById("download-pdf-btn").onclick = () => downloadPdf(id);
  document.getElementById("print-btn").onclick = () => window.print();
  document.getElementById("back-to-invoices-btn").onclick = () =>
    navigateTo("invoices");

  navigateTo("view-invoice");
}

async function deleteInvoice(id) {
  if (confirm("Are you sure you want to delete this invoice?")) {
    await window.api.invoices.delete(state.sessionToken, id);
    loadInvoices();
  }
}

document
  .getElementById("create-invoice-btn")
  ?.addEventListener("click", () => showCreateInvoiceView());
document
  .getElementById("cancel-invoice-btn")
  ?.addEventListener("click", () => navigateTo("invoices"));
document
  .getElementById("invoice-status-filter")
  ?.addEventListener("change", (e) => {
    loadInvoices(e.target.value ? { status: e.target.value } : {});
  });

export async function showCreateInvoiceView() {
  // Start with one blank line ready to fill in — most walk-in invoices need
  // at least one item, so this saves the extra "+ Add Item" click.
  lineItems = [emptyLineItem()];

  const numResult = await window.api.invoices.nextNumber(state.sessionToken);
  document.getElementById("invoice-number").value = numResult.success
    ? numResult.data
    : "";

  // Most jobs are walk-in and paid the same day, so Issue Date, Status, and
  // Payment Method all default to the fast path — every field stays
  // editable for the less common job that needs something different.
  // Due Date isn't shown on the form at all anymore — it's silently kept
  // equal to Issue Date at save time (see the submit handler below).
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("invoice-issue-date").value = today;
  document.getElementById("invoice-discount-type").value = "percent";
  document.getElementById("invoice-discount").value = "0";
  updateDiscountLabel();
  document.getElementById("invoice-walkin-name").value = "";
  document.getElementById("invoice-notes").value = "";
  document.getElementById("invoice-status").value = "paid";

  const settingsResult = await window.api.settings.getAppSettings(state.sessionToken);
  const settings = settingsResult.success ? settingsResult.data : {};
  state.appSettings = settings;
  document.getElementById("invoice-payment-method").value =
    settings.default_payment_method || "cash";
  document.getElementById("invoice-tax").value = settings.tax_rate || "0";

  const clientsResult = await window.api.clients.getAll(state.sessionToken);
  if (clientsResult.success) {
    const select = document.getElementById("invoice-client");
    select.innerHTML =
      '<option value="">Select a client...</option>' +
      clientsResult.data
        .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
        .join("");
    // Walk-in checkout: default to the configured Walk-in Customer so most
    // invoices need zero clicks to pick a client. Still fully changeable.
    if (settings.default_walkin_client_id) {
      select.value = settings.default_walkin_client_id;
    }
    select.focus();
  }
  updateWalkinNameVisibility();

  const [productsResult, servicesResult, projectsResult] = await Promise.all([
    window.api.products.getAll(state.sessionToken),
    window.api.services.getAll(state.sessionToken),
    window.api.projects.getAll(state.sessionToken),
  ]);
  if (productsResult.success) state.products = productsResult.data;
  if (servicesResult.success) state.services = servicesResult.data;
  const projectSelect = document.getElementById("invoice-project");
  projectSelect.innerHTML =
    '<option value="">Not linked to a project</option>' +
    (projectsResult.success
      ? projectsResult.data
          .map((p) => `<option value="${p.id}">${escapeHtml(p.project_number)} — ${escapeHtml(p.name)}</option>`)
          .join("")
      : "");

  await renderLineItems();
  calculateTotals();
  navigateTo("create-invoice");
}

function emptyLineItem() {
  return {
    product_id: null,
    variant_id: null,
    service_id: null,
    description: "",
    variant_name: "",
    quantity: 1,
    unit_price: 0,
    tax_percent: 0,
    line_total: 0,
  };
}

document
  .getElementById("add-line-item-btn")
  ?.addEventListener("click", async () => {
    lineItems.push(emptyLineItem());
    await renderLineItems();
    calculateTotals();
  });

document
  .getElementById("invoice-discount")
  ?.addEventListener("input", calculateTotals);
document
  .getElementById("invoice-tax")
  ?.addEventListener("input", calculateTotals);
document
  .getElementById("invoice-discount-type")
  ?.addEventListener("change", () => {
    updateDiscountLabel();
    calculateTotals();
  });
document
  .getElementById("invoice-client")
  ?.addEventListener("change", updateWalkinNameVisibility);

// The walk-in name field only makes sense when the selected client is the
// shared Walk-in Customer record — for any named client it's hidden and
// cleared so a stale name from a previous walk-in sale can never be sent.
function updateWalkinNameVisibility() {
  const group = document.getElementById("invoice-walkin-name-group");
  const clientSelect = document.getElementById("invoice-client");
  const walkinId = state.appSettings?.default_walkin_client_id;
  if (!group || !clientSelect) return;

  const isWalkin = !!walkinId && clientSelect.value === String(walkinId);
  group.classList.toggle("hidden", !isWalkin);
  if (!isWalkin) {
    document.getElementById("invoice-walkin-name").value = "";
  }
}

function updateDiscountLabel() {
  const type = document.getElementById("invoice-discount-type")?.value;
  const label = document.getElementById("invoice-discount-label");
  const input = document.getElementById("invoice-discount");
  if (!label || !input) return;
  if (type === "amount") {
    label.textContent = "Discount (Rs.)";
    input.removeAttribute("max");
  } else {
    label.textContent = "Discount (%)";
    input.setAttribute("max", "100");
  }
}

// Line-item picker values are prefixed to disambiguate products from
// services in a single combined <select> (their ids can otherwise collide).
function itemSelectValue(item) {
  if (item.product_id) return `p-${item.product_id}`;
  if (item.service_id) return `s-${item.service_id}`;
  return "";
}

async function renderLineItems() {
  const tbody = document.getElementById("line-items-body");
  if (!tbody) return;

  // Pre-fetch all variant options needed
  const variantOptionsMap = {};
  for (const item of lineItems) {
    if (item.product_id && !variantOptionsMap[item.product_id]) {
      const result = await window.api.products.getVariants(
        state.sessionToken,
        item.product_id,
      );
      variantOptionsMap[item.product_id] = result.success ? result.data : [];
    }
  }

  tbody.innerHTML = "";
  lineItems.forEach((item, idx) => {
    const variants = variantOptionsMap[item.product_id] || [];
    const selected = itemSelectValue(item);
    const serviceUnit = item.service_id
      ? state.services.find((s) => s.id === item.service_id)?.unit
      : null;

    const tr = document.createElement("tr");
    tr.dataset.index = idx;
    tr.innerHTML = `
      <td>${itemTypeBadge(item)}</td>
      <td>
        <select class="item-select">
          <option value="">-- Select Product/Service --</option>
          <optgroup label="Products">
            ${state.products.map((p) => `<option value="p-${p.id}" ${selected === `p-${p.id}` ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
          </optgroup>
          <optgroup label="Services">
            ${state.services.map((s) => `<option value="s-${s.id}" ${selected === `s-${s.id}` ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
          </optgroup>
        </select>
      </td>
      <td>
        <select class="variant-select" ${!item.product_id ? "disabled" : ""}>
          <option value="">-- Select Size --</option>
          ${variants.map((v) => `<option value="${v.id}" ${item.variant_id == v.id ? "selected" : ""}>${escapeHtml(v.size_name)} (Stock: ${v.quantity})</option>`).join("")}
        </select>
      </td>
      <td><input type="text" class="item-description" value="${escapeHtml(item.description || "")}"></td>
      <td>
        <input type="number" class="item-qty" value="${item.quantity}" min="1" step="1">
        ${serviceUnit ? `<span class="text-muted">${escapeHtml(serviceUnit.toLowerCase())}</span>` : ""}
      </td>
      <td>
        <input type="number" class="item-price" value="${item.unit_price}" min="0" step="0.01">
      </td>
      <td><input type="number" class="item-tax" value="${item.tax_percent || 0}" min="0" max="100" step="0.01"></td>
      <td class="line-total">${formatCurrency(item.line_total)}</td>
      <td><button class="delete remove-line-btn">&times;</button></td>
    `;
    tbody.appendChild(tr);

    // Quantity and price directly change this row's own total, not just the
    // invoice grand total — update the line-total cell in place (instead of
    // a full renderLineItems() re-render) so the per-line figure stays live
    // as the user types, without losing focus mid-edit.
    const lineTotalCell = tr.querySelector(".line-total");
    const refreshLineTotal = () => {
      lineTotalCell.textContent = formatCurrency(lineItems[idx].line_total);
    };

    tr.querySelector(".item-select").addEventListener("change", async (e) => {
      await onItemSelect(idx, e.target.value);
    });
    tr.querySelector(".variant-select").addEventListener(
      "change",
      async (e) => {
        await onVariantSelect(idx, e.target.value);
      },
    );
    tr.querySelector(".item-description").addEventListener("input", (e) => {
      onItemChange(idx, "description", e.target.value);
    });
    tr.querySelector(".item-qty").addEventListener("input", (e) => {
      onItemChange(idx, "quantity", e.target.value);
      refreshLineTotal();
    });
    // Editable even for catalog services/products — lets a specific invoice
    // give a client a one-off price without touching the price stored in
    // the Services/Products section.
    tr.querySelector(".item-price").addEventListener("input", (e) => {
      onItemChange(idx, "unit_price", e.target.value);
      refreshLineTotal();
    });
    tr.querySelector(".item-tax").addEventListener("input", (e) => {
      onItemChange(idx, "tax_percent", e.target.value);
    });
    tr.querySelector(".remove-line-btn").addEventListener(
      "click",
      async () => {
        lineItems.splice(idx, 1);
        await renderLineItems();
        calculateTotals();
      },
    );
  });
}

async function onItemSelect(idx, value) {
  const [kind, rawId] = value.split("-");
  const id = rawId ? parseInt(rawId) : null;

  if (kind === "s") {
    // Services have a flat price and no variants/stock — no second step needed.
    const service = state.services.find((s) => s.id === id);
    lineItems[idx] = {
      ...lineItems[idx],
      product_id: null,
      variant_id: null,
      variant_name: "",
      service_id: service ? service.id : null,
      description: service ? service.name : "",
      unit_price: service ? service.price : 0,
      line_total: service ? service.price * lineItems[idx].quantity : 0,
    };
  } else if (kind === "p") {
    const product = state.products.find((p) => p.id === id);
    lineItems[idx] = {
      ...lineItems[idx],
      product_id: product ? product.id : null,
      description: product ? product.name : "",
      variant_id: null,
      variant_name: "",
      service_id: null,
      unit_price: 0,
      line_total: 0,
    };
  } else {
    lineItems[idx] = {
      ...lineItems[idx],
      product_id: null,
      variant_id: null,
      variant_name: "",
      service_id: null,
      description: "",
      unit_price: 0,
      line_total: 0,
    };
  }
  await renderLineItems();
  calculateTotals();
}

async function onVariantSelect(idx, variantId) {
  if (!variantId) {
    lineItems[idx] = {
      ...lineItems[idx],
      variant_id: null,
      variant_name: "",
      unit_price: 0,
      line_total: 0,
    };
    await renderLineItems();
    calculateTotals();
    return;
  }
  const result = await window.api.products.getVariants(
    state.sessionToken,
    lineItems[idx].product_id,
  );
  if (result.success) {
    const variant = result.data.find((v) => v.id == variantId);
    if (variant) {
      lineItems[idx].variant_id = variant.id;
      lineItems[idx].variant_name = variant.size_name;
      lineItems[idx].unit_price = variant.price;
      lineItems[idx].line_total = variant.price * lineItems[idx].quantity;
    }
  }
  await renderLineItems();
  calculateTotals();
}

function onItemChange(idx, field, value) {
  lineItems[idx][field] =
    field === "description" || field === "variant_name"
      ? value
      : parseFloat(value) || 0;
  if (field === "quantity" || field === "unit_price") {
    lineItems[idx].line_total =
      lineItems[idx].quantity * lineItems[idx].unit_price;
  }
  calculateTotals();
}

function calculateTotals() {
  const subtotal = lineItems.reduce(
    (sum, item) => sum + (item.line_total || 0),
    0,
  );
  const discountType =
    document.getElementById("invoice-discount-type")?.value === "amount"
      ? "amount"
      : "percent";
  const discountInput =
    parseFloat(document.getElementById("invoice-discount")?.value) || 0;
  const taxPercent =
    parseFloat(document.getElementById("invoice-tax")?.value) || 0;
  const discountAmount =
    discountType === "amount"
      ? Math.min(Math.max(discountInput, 0), subtotal)
      : subtotal * (Math.max(discountInput, 0) / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * (taxPercent / 100);
  const total = afterDiscount + taxAmount;

  document.getElementById("invoice-subtotal").textContent =
    formatCurrency(subtotal);
  document.getElementById("invoice-discount-amount").textContent =
    `-${formatCurrency(discountAmount)}`;
  document.getElementById("invoice-tax-amount").textContent =
    formatCurrency(taxAmount);
  document.getElementById("invoice-total").textContent =
    formatCurrency(total);
}

// Shared by all three save actions (Save Invoice, Save & Print, Download
// PDF) — validates stock and builds the create payload. Returns null (after
// alerting) if validation fails, so callers can just bail out on a falsy
// return instead of duplicating the checks three times.
async function buildInvoicePayload() {
  if (!document.getElementById("invoice-client").value) {
    alert("Please select a client");
    return null;
  }

  // Stock validation
  for (const item of lineItems) {
    if (item.variant_id && item.quantity > 0) {
      const result = await window.api.products.getVariants(
        state.sessionToken,
        item.product_id,
      );
      if (result.success) {
        const variant = result.data.find((v) => v.id === item.variant_id);
        if (variant && variant.quantity < item.quantity) {
          alert(
            `Insufficient stock for ${item.description} (${item.variant_name}). Available: ${variant.quantity}`,
          );
          return null;
        }
      }
    }
  }

  const validItems = lineItems.filter(
    (i) => i.description || i.product_id || i.service_id,
  );
  validItems.forEach((item) => {
    if (!item.product_id && item.description) {
      item.line_total = item.quantity * item.unit_price;
    }
  });

  const projectValue = document.getElementById("invoice-project").value;
  const discountType =
    document.getElementById("invoice-discount-type").value === "amount"
      ? "amount"
      : "percent";
  const discountInput =
    parseFloat(document.getElementById("invoice-discount").value) || 0;
  const issueDate = document.getElementById("invoice-issue-date").value;

  return {
    client_id: parseInt(document.getElementById("invoice-client").value),
    issue_date: issueDate,
    // Due Date isn't on the form — walk-in jobs are same-day, so it just
    // mirrors Issue Date instead of asking for a separate value.
    due_date: issueDate,
    status: document.getElementById("invoice-status").value,
    payment_method: document.getElementById("invoice-payment-method").value,
    discount_type: discountType,
    discount_percent: discountType === "percent" ? discountInput : 0,
    discount_amount: discountType === "amount" ? discountInput : 0,
    // Tax isn't on the form either — it applies silently using the default
    // rate loaded from Settings into the hidden #invoice-tax field.
    tax_percent:
      parseFloat(document.getElementById("invoice-tax").value) || 0,
    notes: document.getElementById("invoice-notes").value,
    items: validItems,
    project_id: projectValue ? parseInt(projectValue) : null,
    walkin_customer_name:
      document.getElementById("invoice-walkin-name").value.trim() || null,
  };
}

// Saves the invoice and returns {id, invoice_number} on success, or null
// (after alerting) on failure — shared by all three save buttons.
async function saveInvoice() {
  const data = await buildInvoicePayload();
  if (!data) return null;

  const result = await window.api.invoices.create(state.sessionToken, data);
  if (!result.success) {
    alert(result.error?.message || "Failed to create invoice");
    return null;
  }
  return result.data;
}

document
  .getElementById("invoice-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saved = await saveInvoice();
    if (saved) navigateTo("invoices");
  });

document
  .getElementById("save-print-invoice-btn")
  ?.addEventListener("click", async () => {
    const saved = await saveInvoice();
    if (!saved) return;
    await viewInvoice(saved.id);
    window.print();
  });

document
  .getElementById("save-download-pdf-btn")
  ?.addEventListener("click", async () => {
    const saved = await saveInvoice();
    if (!saved) return;
    await downloadPdf(saved.id);
    navigateTo("invoices");
  });

async function downloadPdf(invoiceId) {
  const result = await window.api.invoices.generatePdf(
    state.sessionToken,
    invoiceId,
  );
  if (!result.success) {
    alert("Failed to generate PDF");
    return;
  }

  const saveResult = await window.api.dialog.saveFile({
    defaultPath: `invoice-${invoiceId}.pdf`,
    filters: [{ name: "PDF Files", extensions: ["pdf"] }],
  });
  if (saveResult.canceled) return;

  // Buffer is serialized by IPC as {type:'Buffer', data:[...]} — extract .data array
  const bufferData = result.data?.data ?? result.data;
  await window.api.dialog.writePdf(saveResult.filePath, bufferData);
}

// Products affect inventory, services never do — make that distinction
// visible on every invoice, not just inferable from which column is filled in.
function itemTypeBadge(item) {
  if (item.product_id) return `<span class="badge badge-success">Product</span>`;
  if (item.service_id) return `<span class="badge badge-muted">Service</span>`;
  return `<span class="badge">Other</span>`;
}

function formatPaymentMethod(method) {
  if (!method) return "-";
  return method
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Country isn't shown — every client defaults to Pakistan, so it was just
// dead weight under the client's name on every single invoice.
function formatAddress(inv) {
  const parts = [
    inv.client_address_line1,
    inv.client_address_line2,
    [inv.client_city, inv.client_state, inv.client_postal_code]
      .filter(Boolean)
      .join(", "),
  ].filter(Boolean);
  return parts.map(escapeHtml).join("<br>");
}
