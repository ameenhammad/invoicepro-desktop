import { state } from "./state.js";
import { escapeHtml } from "../../shared/utils.js";
import { showModal, closeModal, modalTitle, modalBody, modalFooter } from "./modal.js";

let clients = [];

export async function loadClients() {
  const searchInput = document.getElementById("client-search");
  const search = searchInput ? searchInput.value : "";
  const result = await window.api.clients.getAll(state.sessionToken, search);
  if (!result.success) return;
  clients = result.data;

  const tbody = document.getElementById("clients-body");
  tbody.innerHTML = clients
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone || "-")}</td>
      <td>${escapeHtml(c.address_line1 || "-")}</td>
      <td class="actions" data-id="${c.id}">
        <button class="edit-client-btn">Edit</button>
        <button class="delete delete-client-btn">Delete</button>
      </td>
    </tr>
  `,
    )
    .join("");

  tbody.querySelectorAll(".edit-client-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      const client = clients.find((c) => c.id === id);
      showClientModal(client);
    });
  });
  tbody.querySelectorAll(".delete-client-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      deleteClient(id);
    });
  });
}

async function deleteClient(id) {
  if (confirm("Are you sure you want to delete this client?")) {
    const result = await window.api.clients.delete(state.sessionToken, id);
    if (!result.success) {
      alert(result.error?.message || "Cannot delete client with invoices");
      return;
    }
    loadClients();
  }
}

document
  .getElementById("add-client-btn")
  ?.addEventListener("click", () => showClientModal());
document
  .getElementById("client-search")
  ?.addEventListener("input", () => loadClients());

export function showClientModal(client = null) {
  modalTitle.textContent = client ? "Edit Client" : "Add Client";
  modalBody.innerHTML = `
    <form id="client-form">
      <div class="form-group">
        <label for="client-name">Client Name *</label>
        <input type="text" id="client-name" required value="${client ? escapeHtml(client.name) : ""}">
      </div>
      <div class="form-group">
        <label for="client-phone">Phone Number</label>
        <input type="text" id="client-phone" value="${client ? escapeHtml(client.phone || "") : ""}">
      </div>
      <div class="form-group">
        <label for="client-address1">Address</label>
        <input type="text" id="client-address1" value="${client ? escapeHtml(client.address_line1 || "") : ""}">
      </div>
    </form>
  `;
  modalFooter.innerHTML = `
    <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="modal-save-client-btn">Save</button>
  `;
  document
    .getElementById("modal-cancel-btn")
    ?.addEventListener("click", closeModal);
  document
    .getElementById("modal-save-client-btn")
    ?.addEventListener("click", () => saveClient(client));
  showModal();
}

// Email/address2/city/state/postal/country are no longer collected by the
// simplified form, but existing clients may still have values in them —
// carry those through unchanged so editing a client never wipes older data.
async function saveClient(existingClient) {
  const data = {
    name: document.getElementById("client-name").value,
    phone: document.getElementById("client-phone").value,
    address_line1: document.getElementById("client-address1").value,
    email: existingClient?.email || "",
    address_line2: existingClient?.address_line2 || "",
    city: existingClient?.city || "",
    state: existingClient?.state || "",
    postal_code: existingClient?.postal_code || "",
    country: existingClient?.country || "Pakistan",
  };

  if (!data.name) {
    alert("Client name is required");
    return;
  }

  const id = existingClient?.id || null;
  const result = id
    ? await window.api.clients.update(state.sessionToken, id, data)
    : await window.api.clients.create(state.sessionToken, data);

  if (result.success) {
    closeModal();
    loadClients();
  } else alert(result.error?.message || "Failed to save client");
}
