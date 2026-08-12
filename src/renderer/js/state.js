// Shared mutable state used across renderer modules. Plain object so that
// property mutations (state.sessionToken = ...) are visible to every module
// that imported this object, without needing per-field setter functions.
export const state = {
  sessionToken: sessionStorage.getItem("sessionToken"),
  currentView: "dashboard",
  currentInvoiceId: null,
  products: [],
  services: [],
  appSettings: {},
};
