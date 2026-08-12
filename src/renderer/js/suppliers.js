import { state } from "./state.js";
import { escapeHtml } from "../../shared/utils.js";
import { showModal, closeModal, modalTitle, modalBody, modalFooter } from "./modal.js";

let suppliers = [];

export async function loadSuppliers() {
  const searchInput = document.getElementById("supplier-search");
  const search = searchInput ? searchInput.value : "";
  const result = await window.api.suppliers.getAll(state.sessionToken, search);
  if (!result.success) return;
  suppliers = result.data;

  const tbody = document.getElementById("suppliers-body");
  tbody.innerHTML =
    suppliers
      .map(
        (s) => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.phone || "-")}</td>
      <td>${escapeHtml(s.address || "-")}</td>
      <td class="actions" data-id="${s.id}">
        <button class="edit-supplier-btn">Edit</button>
        <button class="delete delete-supplier-btn">Delete</button>
      </td>
    </tr>
  `,
      )
      .join("") || `<tr><td colspan="4" class="text-muted">No suppliers yet</td></tr>`;

  tbody.querySelectorAll(".edit-supplier-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      const supplier = suppliers.find((s) => s.id === id);
      showSupplierModal(supplier);
    });
  });
  tbody.querySelectorAll(".delete-supplier-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      deleteSupplier(id);
    });
  });
}

async function deleteSupplier(id) {
  if (confirm("Are you sure you want to remove this supplier?")) {
    await window.api.suppliers.delete(state.sessionToken, id);
    loadSuppliers();
  }
}

document.getElementById("add-supplier-btn")?.addEventListener("click", () => showSupplierModal());
document.getElementById("supplier-search")?.addEventListener("input", () => loadSuppliers());

export function showSupplierModal(supplier = null) {
  modalTitle.textContent = supplier ? "Edit Supplier" : "Add Supplier";
  modalBody.innerHTML = `
    <form id="supplier-form">
      <div class="form-group">
        <label for="supplier-name">Supplier Name *</label>
        <input type="text" id="supplier-name" required value="${supplier ? escapeHtml(supplier.name) : ""}">
      </div>
      <div class="form-group">
        <label for="supplier-phone">Phone</label>
        <input type="text" id="supplier-phone" value="${supplier ? escapeHtml(supplier.phone || "") : ""}">
      </div>
      <div class="form-group">
        <label for="supplier-address">Address</label>
        <input type="text" id="supplier-address" value="${supplier ? escapeHtml(supplier.address || "") : ""}">
      </div>
      <div class="form-group">
        <label for="supplier-notes">Notes</label>
        <textarea id="supplier-notes">${supplier ? escapeHtml(supplier.notes || "") : ""}</textarea>
      </div>
      ${
        supplier
          ? `<div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="supplier-active" ${supplier.is_active ? "checked" : ""}>
          Active
        </label>
      </div>`
          : ""
      }
    </form>
  `;
  modalFooter.innerHTML = `
    <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="modal-save-supplier-btn">Save</button>
  `;
  document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
  document
    .getElementById("modal-save-supplier-btn")
    ?.addEventListener("click", () => saveSupplier(supplier ? supplier.id : null));
  showModal();
}

async function saveSupplier(id) {
  const data = {
    name: document.getElementById("supplier-name").value,
    phone: document.getElementById("supplier-phone").value,
    address: document.getElementById("supplier-address").value,
    notes: document.getElementById("supplier-notes").value,
  };
  if (id) {
    data.is_active = document.getElementById("supplier-active").checked ? 1 : 0;
  }

  if (!data.name) {
    alert("Supplier name is required");
    return;
  }

  const result = id
    ? await window.api.suppliers.update(state.sessionToken, id, data)
    : await window.api.suppliers.create(state.sessionToken, data);

  if (result.success) {
    closeModal();
    loadSuppliers();
  } else {
    alert(result.error?.message || "Failed to save supplier");
  }
}
