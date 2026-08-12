import { state } from "./state.js";
import { loadDashboard } from "./dashboard.js";
import { loadProducts } from "./products.js";
import { loadServices } from "./services.js";
import { loadClients } from "./clients.js";
import { loadProjects } from "./projects.js";
import { loadInvoices } from "./invoices.js";
import { loadPayments } from "./payments.js";
import { loadExpenses } from "./expenses.js";
import { loadCashFlow } from "./cashflow.js";
import { loadReports } from "./reports.js";
import { loadSettings } from "./settings.js";
import { loadSuppliers } from "./suppliers.js";
import { loadPurchases } from "./purchases.js";
import { loadWorkers } from "./workers.js";

const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
let sidebarCollapsed = false;

export function navigateTo(view) {
  state.currentView = view;
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

async function loadViewData(view) {
  switch (view) {
    case "dashboard":
      await loadDashboard();
      break;
    case "products":
      await loadProducts();
      break;
    case "services":
      await loadServices();
      break;
    case "clients":
      await loadClients();
      break;
    case "projects":
      await loadProjects();
      break;
    case "invoices":
      await loadInvoices();
      break;
    case "payments":
      await loadPayments();
      break;
    case "expenses":
      await loadExpenses();
      break;
    case "suppliers":
      await loadSuppliers();
      break;
    case "purchases":
      await loadPurchases();
      break;
    case "workers":
      await loadWorkers();
      break;
    case "cashflow":
      await loadCashFlow();
      break;
    case "reports":
      await loadReports();
      break;
    case "settings":
      await loadSettings();
      break;
  }
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  sidebar.classList.toggle("collapsed", sidebarCollapsed);
}

sidebarToggle?.addEventListener("click", toggleSidebar);

document.querySelectorAll(".nav-item[data-view]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo(link.dataset.view);
  });
});
