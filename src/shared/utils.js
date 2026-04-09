/**
 * Format currency amount
 * @param {number} amount - The amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

/**
 * Format date to locale string
 * @param {string|Date} date - The date to format
 * @param {string} format - Optional format type
 * @returns {string} Formatted date string
 */
function formatDate(date, format = "short") {
  if (!date) return "";
  const d = new Date(date);
  if (format === "short") {
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  if (format === "long") {
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  return d.toISOString().split("T")[0];
}

/**
 * Calculate invoice totals from line items
 * @param {Array} items - Array of invoice items
 * @param {number} discountPercent - Discount percentage
 * @param {number} taxPercent - Tax percentage
 * @returns {Object} { subtotal, discountAmount, taxAmount, total }
 */
function calculateInvoiceTotals(items, discountPercent = 0, taxPercent = 0) {
  const subtotal = (items || []).reduce(
    (sum, item) => sum + (item.line_total || 0),
    0,
  );
  const discountAmount = subtotal * (discountPercent / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = afterDiscount * (taxPercent / 100);
  const total = afterDiscount + taxAmount;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

/**
 * Generate a unique session token
 * @returns {string} 32-byte hex string
 */
function generateSessionToken() {
  const bytes = new Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Sanitize string for SQL LIKE queries
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeForLike(str) {
  return str.replace(/[%_]/g, "\\$&");
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
function isValidEmail(email) {
  if (!email) return true; // Email is optional
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Pad number with zeros
 * @param {number} num - Number to pad
 * @param {number} size - Target length
 * @returns {string} Padded string
 */
function padNumber(num, size = 4) {
  return String(num).padStart(size, "0");
}

module.exports = {
  formatCurrency,
  formatDate,
  calculateInvoiceTotals,
  generateSessionToken,
  sanitizeForLike,
  isValidEmail,
  padNumber,
};
