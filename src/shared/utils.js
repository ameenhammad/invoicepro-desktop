import { CURRENCY_SYMBOL } from "./constants.js";

/**
 * Format a currency amount.
 * @param {number} amount - The amount to format
 * @param {string} [symbol] - Currency symbol override (defaults to the app's configured symbol)
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount, symbol = CURRENCY_SYMBOL) {
  const num = amount || 0;
  return `${symbol}${num.toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a date as "D Mon YYYY". Parses YYYY-MM-DD strings as local dates
 * (rather than via `new Date(str)`, which treats them as UTC midnight and
 * can shift the displayed day in negative-UTC-offset timezones).
 * @param {string|Date} date - The date to format
 * @returns {string} Formatted date string, or "" if empty
 */
export function formatDate(date) {
  if (!date) return "";
  const parts = date.toString().split("T")[0].split("-");
  if (parts.length === 3) {
    const [year, month, day] = parts.map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return date;
}

/**
 * Escape HTML special characters for safe insertion into innerHTML.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}
