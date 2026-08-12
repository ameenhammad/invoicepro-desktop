import { state } from "./state.js";
import { navigateTo } from "./navigation.js";

const loginView = document.getElementById("login-view");
const mainView = document.getElementById("main-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");

export async function init() {
  if (state.sessionToken) {
    const result = await window.api.auth.check(state.sessionToken);
    if (result.valid) {
      showMainView();
      return;
    }
  }
  showLoginView();
}

export function showLoginView() {
  loginView.classList.remove("hidden");
  mainView.classList.add("hidden");
}

export function showMainView() {
  loginView.classList.add("hidden");
  mainView.classList.remove("hidden");
  navigateTo("dashboard");
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  loginError.textContent = "";

  try {
    const result = await window.api.auth.login(username, password);

    if (result.success) {
      state.sessionToken = result.data.token;
      sessionStorage.setItem("sessionToken", state.sessionToken);
      showMainView();
    } else {
      loginError.textContent = result.error?.message || "Invalid credentials";
    }
  } catch (err) {
    console.error("Login error:", err);
    loginError.textContent = "Server error. Please try again.";
  }
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await window.api.auth.logout(state.sessionToken);
  } catch (e) {}

  state.sessionToken = null;
  sessionStorage.removeItem("sessionToken");
  showLoginView();
});
