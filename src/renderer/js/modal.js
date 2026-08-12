export const modalOverlay = document.getElementById("modal-overlay");
export const modalTitle = document.getElementById("modal-title");
export const modalBody = document.getElementById("modal-body");
export const modalFooter = document.getElementById("modal-footer");
const modalClose = document.getElementById("modal-close");

export function showModal() {
  modalOverlay.classList.remove("hidden");
}

export function closeModal() {
  modalOverlay.classList.add("hidden");
}

modalClose?.addEventListener("click", closeModal);
modalOverlay?.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
