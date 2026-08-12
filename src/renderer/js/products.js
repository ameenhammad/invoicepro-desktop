import { state } from "./state.js";
import { escapeHtml } from "../../shared/utils.js";
import { PRODUCT_CATEGORIES } from "../../shared/constants.js";
import { showModal, closeModal, modalTitle, modalBody, modalFooter } from "./modal.js";

export async function loadProducts() {
  const searchInput = document.getElementById("product-search");
  const search = searchInput ? searchInput.value : "";
  const result = await window.api.products.getAll(state.sessionToken, search);
  if (!result.success) return;
  state.products = result.data;

  const tbody = document.getElementById("products-body");
  tbody.innerHTML = state.products
    .map((p) => {
      const lowStock = p.low_stock_count > 0;
      return `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.category || "Other")}</td>
      <td>${escapeHtml(p.description || "-")}</td>
      <td>${p.variant_count || 0} sizes</td>
      <td>
        ${p.total_stock || 0}
        ${lowStock ? `<span class="badge badge-warning" title="${p.low_stock_count} size(s) at or below the low stock alert">Low Stock</span>` : ""}
      </td>
      <td>
        <span class="badge ${p.is_active ? "badge-success" : "badge-muted"}">${p.is_active ? "Active" : "Inactive"}</span>
      </td>
      <td class="actions" data-id="${p.id}">
        <button class="edit-product-btn">Edit</button>
        <button class="delete delete-product-btn">Delete</button>
      </td>
    </tr>
  `;
    })
    .join("");

  tbody.querySelectorAll(".edit-product-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      editProduct(id);
    });
  });
  tbody.querySelectorAll(".delete-product-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.closest("td").dataset.id);
      deleteProduct(id);
    });
  });
}

async function editProduct(id) {
  const result = await window.api.products.get(state.sessionToken, id);
  if (!result.success) return;
  showProductModal(result.data);
}

async function deleteProduct(id) {
  if (confirm("Are you sure you want to delete this product?")) {
    await window.api.products.delete(state.sessionToken, id);
    loadProducts();
  }
}

document
  .getElementById("add-product-btn")
  ?.addEventListener("click", () => showProductModal());
document
  .getElementById("product-search")
  ?.addEventListener("input", () => loadProducts());

export function showProductModal(product = null) {
  modalTitle.textContent = product ? "Edit Product" : "Add Product";
  modalBody.innerHTML = `
    <form id="product-form">
      <div class="form-group">
        <label for="product-name">Product Name *</label>
        <input type="text" id="product-name" required value="${product ? escapeHtml(product.name) : ""}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="product-category">Category</label>
          <select id="product-category">
            ${PRODUCT_CATEGORIES.map(
              (cat) =>
                `<option value="${cat}" ${(product?.category || "Other") === cat ? "selected" : ""}>${cat}</option>`,
            ).join("")}
          </select>
        </div>
        <div class="form-group product-active-group">
          <label for="product-active">Status</label>
          <label class="checkbox-label">
            <input type="checkbox" id="product-active" ${!product || product.is_active ? "checked" : ""}>
            Active (visible for new invoices)
          </label>
        </div>
      </div>
      <div class="form-group">
        <label for="product-description">Description</label>
        <textarea id="product-description">${product ? escapeHtml(product.description || "") : ""}</textarea>
      </div>
      <div class="form-group">
        <label>Variants</label>
        <p class="helper-text">
          Each row below is one variant of this product — identified by its
          <strong>Size</strong> (e.g., a thickness, dimension, or spec). Add a
          row for every size you stock.
        </p>
        <div id="variants-container">
          <div class="variant-row variant-row-header">
            <span>Size / Variant *</span>
            <span>SKU</span>
            <span>Cost Price</span>
            <span>Selling Price</span>
            <span>Stock</span>
            <span>Low Stock Alert</span>
            <span></span>
          </div>
          ${(product?.variants || [])
            .map(
              (v) => `
            <div class="variant-row" data-variant-id="${v.id}">
              <input type="hidden" class="variant-id" value="${v.id}">
              <input type="text" class="variant-size" placeholder="Size (e.g., 18mm)" value="${escapeHtml(v.size_name)}">
              <input type="text" class="variant-sku" placeholder="SKU" value="${escapeHtml(v.sku || "")}">
              <input type="number" class="variant-cost-price" placeholder="Cost" step="0.01" min="0" value="${v.cost_price || 0}">
              <input type="number" class="variant-price" placeholder="Price" step="0.01" min="0" value="${v.price}">
              <input type="number" class="variant-quantity" placeholder="Stock" min="0" value="${v.quantity}" readonly title="Use Adjust Stock below to change quantity, so it stays traceable">
              <input type="number" class="variant-threshold" placeholder="Low Stock Alert" min="0" value="${v.low_stock_threshold || 10}">
              <button type="button" class="btn btn-danger btn-sm remove-variant-btn">×</button>
            </div>
            <div class="variant-row variant-adjust-row" data-variant-id="${v.id}">
              <span class="text-muted">Adjust stock for ${escapeHtml(v.size_name)}:</span>
              <select class="adjust-type">
                <option value="stock_in">Stock In</option>
                <option value="stock_out">Stock Out</option>
                <option value="adjustment">Set Exact Count</option>
              </select>
              <input type="number" class="adjust-quantity" placeholder="Quantity" min="0" step="1">
              <input type="text" class="adjust-notes" placeholder="Note (optional)">
              <button type="button" class="btn btn-secondary btn-sm apply-adjust-btn">Apply</button>
              <span class="adjust-result text-muted"></span>
            </div>
          `,
            )
            .join("")}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="add-variant-row-btn">+ Add Variant (Size)</button>
      </div>
    </form>
  `;

  document
    .getElementById("add-variant-row-btn")
    ?.addEventListener("click", addVariantRow);
  document
    .getElementById("variants-container")
    ?.addEventListener("click", (e) => {
      if (e.target.classList.contains("remove-variant-btn")) {
        removeVariantRow(e.target);
      }
      if (e.target.classList.contains("apply-adjust-btn")) {
        applyStockAdjustment(e.target);
      }
    });

  modalFooter.innerHTML = `
    <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
    <button class="btn btn-primary" id="modal-save-product-btn">Save</button>
  `;
  document
    .getElementById("modal-cancel-btn")
    ?.addEventListener("click", closeModal);
  document
    .getElementById("modal-save-product-btn")
    ?.addEventListener("click", () => {
      saveProduct(product ? product.id : null);
    });
  showModal();
}

function addVariantRow() {
  const container = document.getElementById("variants-container");
  const row = document.createElement("div");
  row.className = "variant-row";
  // A brand-new variant has no id yet, so there's nothing for Adjust Stock
  // to target — its opening quantity is just entered directly here, and
  // gets logged as a single "stock_in" movement when the variant is created.
  row.innerHTML = `
    <input type="hidden" class="variant-id" value="">
    <input type="text" class="variant-size" placeholder="Size (e.g., 10mm)">
    <input type="text" class="variant-sku" placeholder="SKU">
    <input type="number" class="variant-cost-price" placeholder="Cost" step="0.01" min="0" value="0">
    <input type="number" class="variant-price" placeholder="Price" step="0.01" min="0" value="0">
    <input type="number" class="variant-quantity" placeholder="Opening stock" min="0" value="0">
    <input type="number" class="variant-threshold" placeholder="Low Stock Alert" min="0" value="10">
    <button type="button" class="btn btn-danger btn-sm remove-variant-btn">×</button>
  `;
  container.appendChild(row);
}

async function applyStockAdjustment(btn) {
  const row = btn.closest(".variant-adjust-row");
  const variantId = parseInt(row.dataset.variantId);
  const type = row.querySelector(".adjust-type").value;
  const quantity = parseFloat(row.querySelector(".adjust-quantity").value);
  const notes = row.querySelector(".adjust-notes").value;
  const resultEl = row.querySelector(".adjust-result");

  if (!quantity || quantity <= 0) {
    resultEl.textContent = "Enter a positive quantity";
    resultEl.className = "adjust-result text-danger";
    return;
  }

  const result = await window.api.products.adjustStock(state.sessionToken, {
    variant_id: variantId,
    type,
    quantity,
    notes,
  });

  if (!result.success) {
    resultEl.textContent = result.error?.message || "Failed";
    resultEl.className = "adjust-result text-danger";
    return;
  }

  resultEl.textContent = `Done — now ${result.data.quantity} in stock`;
  resultEl.className = "adjust-result text-success";
  // Reflect the new quantity in the (readonly) stock field above this row
  // without needing to close/reopen the whole modal.
  const variantRow = document.querySelector(`.variant-row[data-variant-id="${variantId}"]`);
  const qtyInput = variantRow?.querySelector(".variant-quantity");
  if (qtyInput) qtyInput.value = result.data.quantity;
  row.querySelector(".adjust-quantity").value = "";
}

function removeVariantRow(btn) {
  const row = btn.closest(".variant-row");
  const variantId = row.querySelector(".variant-id")?.value;
  if (variantId) {
    if (confirm("Delete this variant?")) {
      window.api.products.deleteVariant(state.sessionToken, parseInt(variantId));
      row.remove();
    }
  } else {
    row.remove();
  }
}

async function saveProduct(id) {
  const name = document.getElementById("product-name").value;
  const description = document.getElementById("product-description").value;
  const category = document.getElementById("product-category").value;
  const is_active = document.getElementById("product-active").checked ? 1 : 0;

  if (!name) {
    alert("Product name is required");
    return;
  }

  let result = id
    ? await window.api.products.update(state.sessionToken, id, {
        name,
        description,
        category,
        is_active,
      })
    : await window.api.products.create(state.sessionToken, {
        name,
        description,
        category,
      });

  if (!result.success) {
    alert(result.error?.message || "Failed to save product");
    return;
  }

  const productId = id || result.data.id;

  const variantRows = document.querySelectorAll(
    ".variant-row:not(.variant-row-header):not(.variant-adjust-row)",
  );
  for (const row of variantRows) {
    const variantId = row.querySelector(".variant-id")?.value;
    const sizeName = row.querySelector(".variant-size")?.value;
    const sku = row.querySelector(".variant-sku")?.value;
    const costPrice = parseFloat(row.querySelector(".variant-cost-price")?.value) || 0;
    const price = parseFloat(row.querySelector(".variant-price")?.value) || 0;
    const quantity =
      parseInt(row.querySelector(".variant-quantity")?.value) || 0;
    const threshold =
      parseInt(row.querySelector(".variant-threshold")?.value) || 10;

    if (!sizeName) continue;

    if (variantId) {
      await window.api.products.updateVariant(
        state.sessionToken,
        parseInt(variantId),
        {
          size_name: sizeName,
          sku,
          cost_price: costPrice,
          price,
          quantity,
          low_stock_threshold: threshold,
        },
      );
    } else {
      await window.api.products.addVariant(state.sessionToken, {
        product_id: productId,
        size_name: sizeName,
        sku,
        cost_price: costPrice,
        price,
        quantity,
        low_stock_threshold: threshold,
      });
    }
  }

  closeModal();
  loadProducts();
}
