import { state } from "./state.js";
import { formatCurrency, escapeHtml } from "../../shared/utils.js";
import { showModal, closeModal, modalTitle, modalBody, modalFooter } from "./modal.js";
import { viewInvoice } from "./invoices.js";

export async function loadPayments() {
  const result = await window.api.invoices.getAll(state.sessionToken);
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
        <td class="actions" data-id="${inv.id}" data-total="${inv.total}">
          ${
            inv.status !== "paid"
              ? `<button class="record-payment-btn">Record Payment</button>`
              : ""
          }
        </td>
      </tr>
    `;
    })
    .join("");

  tbody.querySelectorAll(".record-payment-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const td = btn.closest("td");
      showPaymentModal(parseInt(td.dataset.id), parseFloat(td.dataset.total));
    });
  });
}

export function showPaymentModal(invoiceId, total, existingPayments = []) {
  const paid = existingPayments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = total - paid;

  modalTitle.textContent = "Record Payment";
  modalBody.innerHTML = `
    <form id="payment-form">
      <div class="form-group">
        <label for="payment-amount">Amount *</label>
        <input type="number" id="payment-amount" required step="0.01" min="0.01"
          value="${remaining.toFixed(2)}">
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
    <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="modal-save-payment-btn">Save Payment</button>
  `;
  document
    .getElementById("modal-cancel-btn")
    ?.addEventListener("click", closeModal);
  document
    .getElementById("modal-save-payment-btn")
    ?.addEventListener("click", () => savePayment(invoiceId));
  showModal();
}

async function savePayment(invoiceId) {
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

  const result = await window.api.payments.create(state.sessionToken, data);
  if (result.success) {
    closeModal();
    // Refresh whichever view is active
    if (state.currentView === "view-invoice" && state.currentInvoiceId) {
      viewInvoice(state.currentInvoiceId);
    } else {
      loadPayments();
    }
  } else {
    alert(result.error?.message || "Failed to record payment");
  }
}

export async function deletePayment(id) {
  if (confirm("Delete this payment?")) {
    await window.api.payments.delete(state.sessionToken, id);
    if (state.currentView === "view-invoice" && state.currentInvoiceId) {
      viewInvoice(state.currentInvoiceId);
    } else {
      loadPayments();
    }
  }
}
