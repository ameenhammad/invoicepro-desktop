// InvoicePro - Main Renderer Application
(function () {
  "use strict";

  // State
  let currentView = "dashboard";
  let currentInvoiceId = null;
  let sessionToken = localStorage.getItem("sessionToken");
  let products = [];
  let clients = [];

  // DOM Elements
  const loginView = document.getElementById("login-view");
  const mainView = document.getElementById("main-view");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const logoutBtn = document.getElementById("logout-btn");
  const modalOverlay = document.getElementById("modal-overlay");
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  const modalFooter = document.getElementById("modal-footer");
  const modalClose = document.getElementById("modal-close");

  // Initialize app
  async function init() {
    // Check for existing session
    if (sessionToken) {
      const result = await window.api.auth.check();
      if (result.valid) {
        showMainView();
        return;
      }
    }
    showLoginView();
  }

  // Show login view
  function showLoginView() {
    loginView.classList.remove("hidden");
    mainView.classList.add("hidden");
  }

  // Show main view
  function showMainView() {
    loginView.classList.add("hidden");
    mainView.classList.remove("hidden");
    navigateTo("dashboard");
  }

  // Navigation
  function navigateTo(view) {
    currentView = view;
    document
      .querySelectorAll(".content-view")
      .forEach((v) => v.classList.add("hidden"));
    document
      .querySelectorAll(".nav-item")
      .forEach((n) => n.classList.remove("active"));

    const viewEl = document.getElementById(`${view}-view`);
    if (viewEl) viewEl.classList.remove("hidden");
    const navLink = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navLink) navLink.classList.add("active");

    loadViewData(view);
  }

  // Load data for each view
  async function loadViewData(view) {
    switch (view) {
      case "dashboard":
        await loadDashboard();
        break;
      case "products":
        await loadProducts();
        break;
      case "clients":
        await loadClients();
        break;
      case "invoices":
        await loadInvoices();
        break;
      case "payments":
        await loadPayments();
        break;
      case "reports":
        await loadReports();
        break;
      case "settings":
        await loadSettings();
        break;
    }
  }

  // ============ AUTH ============
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    loginError.textContent = "";
    const result = await window.api.auth.login(username, password);

    if (result.success) {
      sessionToken = result.data.token;
      localStorage.setItem("sessionToken", sessionToken);
      showMainView();
    } else {
      loginError.textContent = result.error.message;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await window.api.auth.logout();
    sessionToken = null;
    localStorage.removeItem("sessionToken");
    showLoginView();
  });

  // ============ DASHBOARD ============
  async function loadDashboard() {
    const result = await window.api.reports.summary();
    if (!result.success) return;

    document.getElementById("total-revenue").textContent = formatCurrency(
      result.data.totalRevenue,
    );
    document.getElementById("pending-amount").textContent = formatCurrency(
      result.data.pendingAmount,
    );
    document.getElementById("total-invoices").textContent =
      result.data.totalInvoices;
    document.getElementById("total-clients").textContent =
      result.data.totalClients;

    // Load recent invoices
    const recentResult = await window.api.invoices.getAll();
    if (recentResult.success) {
      const tbody = document.getElementById("recent-invoices-body");
      tbody.innerHTML = recentResult.data
        .slice(0, 5)
        .map(
          (inv) => `
        <tr>
          <td>${inv.invoice_number}</td>
          <td>${inv.client_name}</td>
          <td>${formatCurrency(inv.total)}</td>
          <td><span class="status-badge ${inv.status}">${inv.status}</span></td>
          <td>${formatDate(inv.issue_date)}</td>
        </tr>
      `,
        )
        .join("");
    }

    // Load pending payments
    const pendingResult = await window.api.reports.pending();
    if (pendingResult.success) {
      const tbody = document.getElementById("pending-payments-body");
      tbody.innerHTML = pendingResult.data
        .map(
          (inv) => `
        <tr>
          <td>${inv.invoice_number}</td>
          <td>${inv.client_name}</td>
          <td>${formatCurrency(inv.total - (inv.paid_amount || 0))}</td>
          <td>${formatDate(inv.due_date)}</td>
        </tr>
      `,
        )
        .join("");
    }
  }

  // ============ PRODUCTS ============
  async function loadProducts() {
    const result = await window.api.products.getAll();
    if (!result.success) return;
    products = result.data;

    const tbody = document.getElementById("products-body");
    tbody.innerHTML = products
      .map(
        (p) => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.description || "")}</td>
        <td>${formatCurrency(p.price)}</td>
        <td>${escapeHtml(p.unit)}</td>
        <td>${escapeHtml(p.sku || "")}</td>
        <td class="actions">
          <button onclick="editProduct(${p.id})">Edit</button>
          <button class="delete" onclick="deleteProduct(${p.id})">Delete</button>
        </td>
      </tr>
    `,
      )
      .join("");
  }

  window.editProduct = function (id) {
    const product = products.find((p) => p.id === id);
    showProductModal(product);
  };

  window.deleteProduct = function (id) {
    if (confirm("Are you sure you want to delete this product?")) {
      window.api.products.delete(id).then(() => loadProducts());
    }
  };

  document
    .getElementById("add-product-btn")
    .addEventListener("click", () => showProductModal());
  document
    .getElementById("product-search")
    .addEventListener("input", (e) => loadProducts(e.target.value));

  function showProductModal(product = null) {
    modalTitle.textContent = product ? "Edit Product" : "Add Product";
    modalBody.innerHTML = `
      <form id="product-form">
        <div class="form-group">
          <label for="product-name">Name *</label>
          <input type="text" id="product-name" required value="${product ? escapeHtml(product.name) : ""}">
        </div>
        <div class="form-group">
          <label for="product-description">Description</label>
          <textarea id="product-description">${product ? escapeHtml(product.description || "") : ""}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="product-price">Price *</label>
            <input type="number" id="product-price" required step="0.01" min="0" value="${product ? product.price : ""}">
          </div>
          <div class="form-group">
            <label for="product-unit">Unit</label>
            <input type="text" id="product-unit" value="${product ? escapeHtml(product.unit) : "unit"}">
          </div>
        </div>
        <div class="form-group">
          <label for="product-sku">SKU</label>
          <input type="text" id="product-sku" value="${product ? escapeHtml(product.sku || "") : ""}">
        </div>
      </form>
    `;
    modalFooter.innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveProduct(${product ? product.id : "null"})">Save</button>
    `;
    showModal();
  }

  window.saveProduct = async function (id) {
    const data = {
      name: document.getElementById("product-name").value,
      description: document.getElementById("product-description").value,
      price: parseFloat(document.getElementById("product-price").value) || 0,
      unit: document.getElementById("product-unit").value || "unit",
      sku: document.getElementById("product-sku").value,
    };

    if (!data.name) {
      alert("Product name is required");
      return;
    }

    const result = id
      ? await window.api.products.update(id, data)
      : await window.api.products.create(data);

    if (result.success) {
      closeModal();
      loadProducts();
    }
  };

  // ============ CLIENTS ============
  async function loadClients() {
    const result = await window.api.clients.getAll();
    if (!result.success) return;
    clients = result.data;

    const tbody = document.getElementById("clients-body");
    tbody.innerHTML = clients
      .map(
        (c) => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.email || "")}</td>
        <td>${escapeHtml(c.phone || "")}</td>
        <td>${escapeHtml(c.city || "")}</td>
        <td class="actions">
          <button onclick="editClient(${c.id})">Edit</button>
          <button class="delete" onclick="deleteClient(${c.id})">Delete</button>
        </td>
      </tr>
    `,
      )
      .join("");
  }

  window.editClient = function (id) {
    const client = clients.find((c) => c.id === id);
    showClientModal(client);
  };

  window.deleteClient = function (id) {
    if (confirm("Are you sure you want to delete this client?")) {
      window.api.clients.delete(id).then(() => loadClients());
    }
  };

  document
    .getElementById("add-client-btn")
    .addEventListener("click", () => showClientModal());
  document
    .getElementById("client-search")
    .addEventListener("input", (e) => loadClients(e.target.value));

  function showClientModal(client = null) {
    modalTitle.textContent = client ? "Edit Client" : "Add Client";
    modalBody.innerHTML = `
      <form id="client-form">
        <div class="form-group">
          <label for="client-name">Name *</label>
          <input type="text" id="client-name" required value="${client ? escapeHtml(client.name) : ""}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="client-email">Email</label>
            <input type="email" id="client-email" value="${client ? escapeHtml(client.email || "") : ""}">
          </div>
          <div class="form-group">
            <label for="client-phone">Phone</label>
            <input type="text" id="client-phone" value="${client ? escapeHtml(client.phone || "") : ""}">
          </div>
        </div>
        <div class="form-group">
          <label for="client-address1">Address Line 1</label>
          <input type="text" id="client-address1" value="${client ? escapeHtml(client.address_line1 || "") : ""}">
        </div>
        <div class="form-group">
          <label for="client-address2">Address Line 2</label>
          <input type="text" id="client-address2" value="${client ? escapeHtml(client.address_line2 || "") : ""}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="client-city">City</label>
            <input type="text" id="client-city" value="${client ? escapeHtml(client.city || "") : ""}">
          </div>
          <div class="form-group">
            <label for="client-state">State</label>
            <input type="text" id="client-state" value="${client ? escapeHtml(client.state || "") : ""}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="client-postal">Postal Code</label>
            <input type="text" id="client-postal" value="${client ? escapeHtml(client.postal_code || "") : ""}">
          </div>
          <div class="form-group">
            <label for="client-country">Country</label>
            <input type="text" id="client-country" value="${client ? escapeHtml(client.country || "United States") : "United States"}">
          </div>
        </div>
      </form>
    `;
    modalFooter.innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveClient(${client ? client.id : "null"})">Save</button>
    `;
    showModal();
  }

  window.saveClient = async function (id) {
    const data = {
      name: document.getElementById("client-name").value,
      email: document.getElementById("client-email").value,
      phone: document.getElementById("client-phone").value,
      address_line1: document.getElementById("client-address1").value,
      address_line2: document.getElementById("client-address2").value,
      city: document.getElementById("client-city").value,
      state: document.getElementById("client-state").value,
      postal_code: document.getElementById("client-postal").value,
      country: document.getElementById("client-country").value,
    };

    if (!data.name) {
      alert("Client name is required");
      return;
    }

    const result = id
      ? await window.api.clients.update(id, data)
      : await window.api.clients.create(data);

    if (result.success) {
      closeModal();
      loadClients();
    }
  };

  // ============ INVOICES ============
  let lineItems = [];

  async function loadInvoices(filters = {}) {
    const result = await window.api.invoices.getAll(filters);
    if (!result.success) return;

    const tbody = document.getElementById("invoices-body");
    tbody.innerHTML = result.data
      .map(
        (inv) => `
      <tr>
        <td>${escapeHtml(inv.invoice_number)}</td>
        <td>${escapeHtml(inv.client_name)}</td>
        <td>${formatCurrency(inv.total)}</td>
        <td><span class="status-badge ${inv.status}">${inv.status}</span></td>
        <td>${formatDate(inv.issue_date)}</td>
        <td>${formatDate(inv.due_date)}</td>
        <td class="actions">
          <button onclick="viewInvoice(${inv.id})">View</button>
          <button class="delete" onclick="deleteInvoice(${inv.id})">Delete</button>
        </td>
      </tr>
    `,
      )
      .join("");
  }

  window.viewInvoice = async function (id) {
    currentInvoiceId = id;
    const result = await window.api.invoices.get(id);
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
    document.getElementById("vi-due-date").textContent = formatDate(
      inv.due_date,
    );
    document.getElementById("vi-client-name").textContent = inv.client_name;
    document.getElementById("vi-client-address").innerHTML = formatAddress(inv);
    document.getElementById("vi-client-contact").innerHTML =
      `${inv.client_email || ""}<br>${inv.client_phone || ""}`;

    const itemsBody = document.getElementById("vi-items-body");
    itemsBody.innerHTML = (inv.items || [])
      .map(
        (item) => `
      <tr>
        <td>${escapeHtml(item.description)}</td>
        <td>${item.quantity}</td>
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
        : "$0.00";
    document.getElementById("vi-discount-row").style.display =
      inv.discount_amount > 0 ? "block" : "none";
    document.getElementById("vi-tax").textContent = formatCurrency(
      inv.tax_amount,
    );
    document.getElementById("vi-total").textContent = formatCurrency(inv.total);

    // Payments
    const paymentsBody = document.getElementById("vi-payments-body");
    paymentsBody.innerHTML = (inv.payments || [])
      .map(
        (p) => `
      <tr>
        <td>${formatDate(p.payment_date)}</td>
        <td>${formatCurrency(p.amount)}</td>
        <td>${p.method || "N/A"}</td>
        <td>${p.reference || ""}</td>
        <td><button class="delete" onclick="deletePayment(${p.id})">Delete</button></td>
      </tr>
    `,
      )
      .join("");

    document.getElementById("add-payment-btn").onclick = () =>
      showPaymentModal(inv.id, inv.total, inv.payments);
    document.getElementById("download-pdf-btn").onclick = () => downloadPdf(id);
    document.getElementById("back-to-invoices-btn").onclick = () =>
      navigateTo("invoices");

    navigateTo("view-invoice");
  };

  window.deleteInvoice = function (id) {
    if (confirm("Are you sure you want to delete this invoice?")) {
      window.api.invoices.delete(id).then(() => loadInvoices());
    }
  };

  document
    .getElementById("create-invoice-btn")
    .addEventListener("click", () => showCreateInvoiceView());
  document
    .getElementById("cancel-invoice-btn")
    .addEventListener("click", () => navigateTo("invoices"));
  document
    .getElementById("invoice-status-filter")
    .addEventListener("change", (e) => {
      loadInvoices(e.target.value ? { status: e.target.value } : {});
    });

  async function showCreateInvoiceView() {
    lineItems = [];

    // Get next invoice number
    const numResult = await window.api.invoices.nextNumber();
    document.getElementById("invoice-number").value = numResult.success
      ? numResult.data
      : "";

    // Set default dates
    const today = new Date().toISOString().split("T")[0];
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    document.getElementById("invoice-issue-date").value = today;
    document.getElementById("invoice-due-date").value = dueDate;

    // Load clients for dropdown
    const clientsResult = await window.api.clients.getAll();
    if (clientsResult.success) {
      const select = document.getElementById("invoice-client");
      select.innerHTML =
        '<option value="">Select a client...</option>' +
        clientsResult.data
          .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
          .join("");
    }

    // Load products for line items
    const productsResult = await window.api.products.getAll();
    if (productsResult.success) {
      products = productsResult.data;
    }

    renderLineItems();
    calculateTotals();
    navigateTo("create-invoice");
  }

  document.getElementById("add-line-item-btn").addEventListener("click", () => {
    lineItems.push({
      product_id: null,
      description: "",
      quantity: 1,
      unit_price: 0,
      tax_percent: 0,
      line_total: 0,
    });
    renderLineItems();
  });

  document
    .getElementById("invoice-discount")
    .addEventListener("input", calculateTotals);
  document
    .getElementById("invoice-tax")
    .addEventListener("input", calculateTotals);

  function renderLineItems() {
    const tbody = document.getElementById("line-items-body");
    tbody.innerHTML = lineItems
      .map(
        (item, idx) => `
      <tr data-index="${idx}">
        <td>
          <select class="product-select" onchange="onProductSelect(${idx}, this.value)">
            <option value="">-- Select Product --</option>
            ${products.map((p) => `<option value="${p.id}" ${item.product_id == p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </td>
        <td><input type="text" class="item-description" value="${escapeHtml(item.description || "")}" onchange="onItemChange(${idx}, 'description', this.value)"></td>
        <td><input type="number" class="item-qty" value="${item.quantity}" min="1" step="1" onchange="onItemChange(${idx}, 'quantity', this.value)"></td>
        <td><input type="number" class="item-price" value="${item.unit_price}" step="0.01" onchange="onItemChange(${idx}, 'unit_price', this.value)"></td>
        <td><input type="number" class="item-tax" value="${item.tax_percent || 0}" min="0" max="100" step="0.01" onchange="onItemChange(${idx}, 'tax_percent', this.value)"></td>
        <td class="line-total">${formatCurrency(item.line_total)}</td>
        <td><button class="delete" onclick="removeLineItem(${idx})">&times;</button></td>
      </tr>
    `,
      )
      .join("");
  }

  window.onProductSelect = function (idx, productId) {
    const product = products.find((p) => p.id == productId);
    if (product) {
      lineItems[idx].product_id = product.id;
      lineItems[idx].description = product.name;
      lineItems[idx].unit_price = product.price;
      lineItems[idx].tax_percent = 0;
      lineItems[idx].line_total = product.price * lineItems[idx].quantity;
    } else {
      lineItems[idx].product_id = null;
      lineItems[idx].description = "";
      lineItems[idx].unit_price = 0;
      lineItems[idx].line_total = 0;
    }
    renderLineItems();
    calculateTotals();
  };

  window.onItemChange = function (idx, field, value) {
    lineItems[idx][field] =
      field === "description" ? value : parseFloat(value) || 0;
    if (field === "quantity" || field === "unit_price") {
      lineItems[idx].line_total =
        lineItems[idx].quantity * lineItems[idx].unit_price;
    }
    renderLineItems();
    calculateTotals();
  };

  window.removeLineItem = function (idx) {
    lineItems.splice(idx, 1);
    renderLineItems();
    calculateTotals();
  };

  function calculateTotals() {
    let subtotal = 0;
    lineItems.forEach((item) => {
      subtotal += item.line_total || 0;
    });

    const discountPercent =
      parseFloat(document.getElementById("invoice-discount").value) || 0;
    const taxPercent =
      parseFloat(document.getElementById("invoice-tax").value) || 0;

    const discountAmount = subtotal * (discountPercent / 100);
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

  document
    .getElementById("invoice-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!document.getElementById("invoice-client").value) {
        alert("Please select a client");
        return;
      }

      if (
        lineItems.length === 0 ||
        lineItems.every((i) => !i.description && !i.product_id)
      ) {
        alert("Please add at least one item");
        return;
      }

      // Clean up line items
      lineItems = lineItems.filter((i) => i.description || i.product_id);
      lineItems.forEach((item) => {
        if (!item.product_id && item.description) {
          item.line_total = item.quantity * item.unit_price;
        }
      });

      const data = {
        client_id: parseInt(document.getElementById("invoice-client").value),
        issue_date: document.getElementById("invoice-issue-date").value,
        due_date: document.getElementById("invoice-due-date").value,
        discount_percent:
          parseFloat(document.getElementById("invoice-discount").value) || 0,
        tax_percent:
          parseFloat(document.getElementById("invoice-tax").value) || 0,
        notes: document.getElementById("invoice-notes").value,
        items: lineItems,
      };

      const result = await window.api.invoices.create(data);
      if (result.success) {
        navigateTo("invoices");
      } else {
        alert(result.error.message);
      }
    });

  // ============ PAYMENTS ============
  async function loadPayments() {
    const result = await window.api.invoices.getAll();
    if (!result.success) return;

    const tbody = document.getElementById("payments-body");
    tbody.innerHTML = result.data
      .map((inv) => {
        const paid = inv.paid_amount || 0;
        const due = inv.total - paid;
        return `
        <tr>
          <td>${escapeHtml(inv.invoice_number)}</td>
          <td>${escapeHtml(inv.client_name)}</td>
          <td>${formatCurrency(inv.total)}</td>
          <td>${formatCurrency(paid)}</td>
          <td class="${due > 0 ? "text-warning" : "text-success"}">${formatCurrency(due)}</td>
          <td><span class="status-badge ${inv.status}">${inv.status}</span></td>
          <td>
            ${inv.status !== "paid" ? `<button onclick="showPaymentModal(${inv.id}, ${inv.total})">Record Payment</button>` : ""}
          </td>
        </tr>
      `;
      })
      .join("");
  }

  window.showPaymentModal = function (invoiceId, total, existingPayments = []) {
    const paid = existingPayments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = total - paid;

    modalTitle.textContent = "Record Payment";
    modalBody.innerHTML = `
      <form id="payment-form">
        <div class="form-group">
          <label for="payment-amount">Amount *</label>
          <input type="number" id="payment-amount" required step="0.01" min="0.01" max="${remaining}" value="${remaining.toFixed(2)}">
          <small class="helper-text">Remaining: ${formatCurrency(remaining)}</small>
        </div>
        <div class="form-group">
          <label for="payment-date">Payment Date</label>
          <input type="date" id="payment-date" value="${new Date().toISOString().split("T")[0]}">
        </div>
        <div class="form-group">
          <label for="payment-method">Payment Method</label>
          <select id="payment-method">
            <option value="cash">Cash</option>
            <option value="check">Check</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="card">Card</option>
          </select>
        </div>
        <div class="form-group">
          <label for="payment-reference">Reference</label>
          <input type="text" id="payment-reference" placeholder="Check #, transaction ID, etc.">
        </div>
      </form>
    `;
    modalFooter.innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="savePayment(${invoiceId})">Save Payment</button>
    `;
    showModal();
  };

  window.savePayment = async function (invoiceId) {
    const amount = parseFloat(document.getElementById("payment-amount").value);
    if (!amount || amount <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    const data = {
      invoice_id: invoiceId,
      amount,
      payment_date: document.getElementById("payment-date").value,
      method: document.getElementById("payment-method").value,
      reference: document.getElementById("payment-reference").value,
    };

    const result = await window.api.payments.create(data);
    if (result.success) {
      closeModal();
      loadPayments();
    }
  };

  window.deletePayment = async function (id) {
    if (confirm("Delete this payment?")) {
      await window.api.payments.delete(id);
      if (currentInvoiceId) {
        viewInvoice(currentInvoiceId);
      }
      loadPayments();
    }
  };

  // ============ REPORTS ============
  async function loadReports() {
    // Load clients for filter
    const clientsResult = await window.api.clients.getAll();
    if (clientsResult.success) {
      const select = document.getElementById("report-client");
      select.innerHTML =
        '<option value="">All Clients</option>' +
        clientsResult.data
          .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
          .join("");
    }

    applyReportFilters();
  }

  document
    .getElementById("apply-report-filters-btn")
    .addEventListener("click", applyReportFilters);

  async function applyReportFilters() {
    const filters = {};
    const fromDate = document.getElementById("report-from-date").value;
    const toDate = document.getElementById("report-to-date").value;
    const clientId = document.getElementById("report-client").value;

    if (fromDate) filters.fromDate = fromDate;
    if (toDate) filters.toDate = toDate;
    if (clientId) filters.clientId = parseInt(clientId);

    const result = await window.api.reports.revenue(filters);
    if (result.success) {
      document.getElementById("report-total-revenue").textContent =
        formatCurrency(result.data.total);
      document.getElementById("report-invoice-count").textContent =
        result.data.invoices.length;

      const tbody = document.getElementById("revenue-body");
      tbody.innerHTML = result.data.invoices
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

  // ============ SETTINGS ============
  async function loadSettings() {
    const result = await window.api.auth.getSettings();
    if (result.success) {
      document.getElementById("company-name").value =
        result.data.company_name || "";
      document.getElementById("company-address").value =
        result.data.company_address || "";
      document.getElementById("company-phone").value =
        result.data.company_phone || "";
      document.getElementById("company-email").value =
        result.data.company_email || "";
    }
  }

  document
    .getElementById("settings-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const settings = {
        company_name: document.getElementById("company-name").value,
        company_address: document.getElementById("company-address").value,
        company_phone: document.getElementById("company-phone").value,
        company_email: document.getElementById("company-email").value,
      };

      const result = await window.api.auth.updateSettings(settings);
      if (result.success) {
        alert("Settings saved successfully");
      }
    });

  // ============ PDF DOWNLOAD ============
  async function downloadPdf(invoiceId) {
    const result = await window.api.invoices.generatePdf(invoiceId);
    if (!result.success) {
      alert("Failed to generate PDF");
      return;
    }

    const saveResult = await window.api.dialog.saveFile({
      defaultPath: `invoice-${invoiceId}.pdf`,
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
    });

    if (saveResult.canceled) return;

    // Convert Uint8Array to regular array for IPC transfer
    const buffer = Array.from(result.data);
    await window.api.dialog.writePdf(saveResult.filePath, buffer);
  }

  // ============ MODAL ============
  function showModal() {
    modalOverlay.classList.remove("hidden");
  }

  window.closeModal = function () {
    modalOverlay.classList.add("hidden");
  };

  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // ============ NAVIGATION ============
  document.querySelectorAll(".nav-item[data-view]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo(link.dataset.view);
    });
  });

  // ============ UTILITIES ============
  function formatCurrency(amount) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount || 0);
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatAddress(inv) {
    const parts = [
      inv.client_address_line1,
      inv.client_address_line2,
      [inv.client_city, inv.client_state, inv.client_postal_code]
        .filter(Boolean)
        .join(", "),
      inv.client_country,
    ].filter(Boolean);
    return parts.join("<br>");
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Start app
  init();
})();
