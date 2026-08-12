import { state } from "./state.js";
import { escapeHtml, formatCurrency } from "../../shared/utils.js";
import { SERVICE_UNITS } from "../../shared/constants.js";
import { showModal, closeModal, modalTitle, modalBody, modalFooter } from "./modal.js";

export async function loadServices() {
  const searchInput = document.getElementById("service-search");
  const search = searchInput ? searchInput.value : "";
  const result = await window.api.services.getAll(state.sessionToken, search);
  if (!result.success) return;
  state.services = result.data;

  const tbody = document.getElementById("services-body");
  tbody.innerHTML = state.services
    .map(
      (s) => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.description || "-")}</td>
      <td>${escapeHtml(s.unit || "Piece")}</td>
      <td>${formatCurrency(s.price)}</td>
      <td>
        <span class="badge ${s.is_active ? "badge-success" : "badge-muted"}">${s.is_active ? "Active" : "Inactive"}</span>
      </td>
      <td class="actions" data-id="${s.id}">
        <button class="edit-service-btn">Edit</button>
        <button class="delete delete-service-btn">Delete</button>
      </td>
    </tr>
  `,
    )
    .join("");

  tbody.querySelectorAll(".edit-service-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      editService(id);
    });
  });
  tbody.querySelectorAll(".delete-service-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      deleteService(id);
    });
  });
}

async function editService(id) {
  const result = await window.api.services.get(state.sessionToken, id);
  if (!result.success) return;
  showServiceModal(result.data);
}

async function deleteService(id) {
  if (confirm("Are you sure you want to delete this service?")) {
    await window.api.services.delete(state.sessionToken, id);
    loadServices();
  }
}

document
  .getElementById("add-service-btn")
  ?.addEventListener("click", () => showServiceModal());
document
  .getElementById("service-search")
  ?.addEventListener("input", () => loadServices());

function showServiceModal(service = null) {
  modalTitle.textContent = service ? "Edit Service" : "Add Service";
  modalBody.innerHTML = `
    <form id="service-form">
      <div class="form-group">
        <label for="service-name">Service Name *</label>
        <input type="text" id="service-name" required value="${service ? escapeHtml(service.name) : ""}">
      </div>
      <div class="form-group">
        <label for="service-description">Description</label>
        <textarea id="service-description">${service ? escapeHtml(service.description || "") : ""}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="service-price">Selling Rate *</label>
          <input type="number" id="service-price" step="0.01" min="0" value="${service ? service.price : "0"}">
        </div>
        <div class="form-group">
          <label for="service-unit">Unit</label>
          <select id="service-unit">
            ${SERVICE_UNITS.map(
              (u) => `<option value="${u}" ${(service?.unit || "Piece") === u ? "selected" : ""}>${u}</option>`,
            ).join("")}
          </select>
        </div>
      </div>
      <div class="form-group product-active-group">
        <label for="service-active">Status</label>
        <label class="checkbox-label">
          <input type="checkbox" id="service-active" ${!service || service.is_active ? "checked" : ""}>
          Active (available on new invoices)
        </label>
      </div>
    </form>
  `;
  modalFooter.innerHTML = `
    <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="modal-save-service-btn">Save</button>
  `;
  document
    .getElementById("modal-cancel-btn")
    ?.addEventListener("click", closeModal);
  document
    .getElementById("modal-save-service-btn")
    ?.addEventListener("click", () => saveService(service ? service.id : null));
  showModal();
}

async function saveService(id) {
  const name = document.getElementById("service-name").value;
  const description = document.getElementById("service-description").value;
  const price = parseFloat(document.getElementById("service-price").value) || 0;
  const unit = document.getElementById("service-unit").value;
  const is_active = document.getElementById("service-active").checked ? 1 : 0;

  if (!name) {
    alert("Service name is required");
    return;
  }

  const result = id
    ? await window.api.services.update(state.sessionToken, id, {
        name,
        description,
        price,
        unit,
        is_active,
      })
    : await window.api.services.create(state.sessionToken, {
        name,
        description,
        price,
        unit,
      });

  if (result.success) {
    closeModal();
    loadServices();
  } else alert(result.error?.message || "Failed to save service");
}
