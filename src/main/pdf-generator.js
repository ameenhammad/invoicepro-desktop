const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const log = require("electron-log");

function generateInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({ success: true, data: buffer });
      });
      doc.on("error", reject);

      // Header
      doc
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("INVOICE", 50, 50, { align: "right" });
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`Invoice #: ${invoice.invoice_number}`, 50, 80, {
          align: "right",
        });
      doc.text(`Issue Date: ${formatDate(invoice.issue_date)}`, {
        align: "right",
      });
      doc.text(`Due Date: ${formatDate(invoice.due_date)}`, { align: "right" });
      doc.text(`Status: ${invoice.status.toUpperCase()}`, { align: "right" });

      // Company info
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(invoice.company_name || "My Business", 50, 50);
      doc.fontSize(9).font("Helvetica");
      if (invoice.company_address) doc.text(invoice.company_address);
      if (invoice.company_phone) doc.text(`Phone: ${invoice.company_phone}`);
      if (invoice.company_email) doc.text(`Email: ${invoice.company_email}`);

      // Bill To
      const billToY = Math.max(doc.y, 150);
      doc.fontSize(10).font("Helvetica-Bold").text("Bill To:", 50, billToY);
      doc.font("Helvetica").fontSize(10);
      doc.text(invoice.client_name);
      if (invoice.client_address_line1) doc.text(invoice.client_address_line1);
      if (invoice.client_address_line2) doc.text(invoice.client_address_line2);
      if (
        invoice.client_city ||
        invoice.client_state ||
        invoice.client_postal_code
      ) {
        doc.text(
          `${invoice.client_city || ""} ${invoice.client_state || ""} ${invoice.client_postal_code || ""}`.trim(),
        );
      }
      if (invoice.client_country) doc.text(invoice.client_country);
      if (invoice.client_email) doc.text(`Email: ${invoice.client_email}`);
      if (invoice.client_phone) doc.text(`Phone: ${invoice.client_phone}`);

      // Line items table
      let tableY = doc.y + 20;
      const colWidths = [280, 60, 80, 70];
      const colX = [50, 330, 390, 460];

      // Table header
      doc.rect(50, tableY, 500, 20).fill("#f0f0f0");
      doc.fill("#000000");
      doc.font("Helvetica-Bold").fontSize(9);
      doc.text("Description", colX[0] + 5, tableY + 5);
      doc.text("Qty", colX[1], tableY + 5, {
        width: colWidths[1],
        align: "center",
      });
      doc.text("Unit Price", colX[2], tableY + 5, {
        width: colWidths[2],
        align: "right",
      });
      doc.text("Total", colX[3], tableY + 5, {
        width: colWidths[3],
        align: "right",
      });

      tableY += 20;
      doc.font("Helvetica").fontSize(9);

      if (invoice.items && invoice.items.length > 0) {
        for (const item of invoice.items) {
          const lineTotal = item.line_total || item.quantity * item.unit_price;
          doc.text(
            item.description || item.description_text || "",
            colX[0] + 5,
            tableY,
            { width: colWidths[0] - 5 },
          );
          doc.text(String(item.quantity || 1), colX[1], tableY, {
            width: colWidths[1],
            align: "center",
          });
          doc.text(formatCurrency(item.unit_price), colX[2], tableY, {
            width: colWidths[2],
            align: "right",
          });
          doc.text(formatCurrency(lineTotal), colX[3], tableY, {
            width: colWidths[3],
            align: "right",
          });

          tableY += 18;

          // Page break if needed
          if (tableY > 700) {
            doc.addPage();
            tableY = 50;
          }
        }
      }

      // Totals
      tableY += 10;
      doc.moveTo(350, tableY).lineTo(550, tableY).stroke();

      tableY += 10;
      doc.text("Subtotal:", 330, tableY, { width: 120, align: "right" });
      doc.text(formatCurrency(invoice.subtotal), 450, tableY, {
        width: 100,
        align: "right",
      });

      if (invoice.discount_amount > 0) {
        tableY += 15;
        doc.text(`Discount (${invoice.discount_percent || 0}%):`, 330, tableY, {
          width: 120,
          align: "right",
        });
        doc.text(`-${formatCurrency(invoice.discount_amount)}`, 450, tableY, {
          width: 100,
          align: "right",
        });
      }

      if (invoice.tax_amount > 0) {
        tableY += 15;
        doc.text(`Tax (${invoice.tax_percent || 0}%):`, 330, tableY, {
          width: 120,
          align: "right",
        });
        doc.text(formatCurrency(invoice.tax_amount), 450, tableY, {
          width: 100,
          align: "right",
        });
      }

      tableY += 15;
      doc.rect(340, tableY, 210, 18).fill("#e0e0e0");
      doc.fill("#000000");
      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Grand Total:", 350, tableY + 4, { width: 90 });
      doc.text(formatCurrency(invoice.total), 450, tableY + 4, {
        width: 100,
        align: "right",
      });

      // Payments received
      if (invoice.totalPaid > 0) {
        doc.font("Helvetica").fontSize(9);
        tableY += 25;
        doc.text(`Payments Received: ${formatCurrency(invoice.totalPaid)}`, {
          align: "right",
        });
        const remaining = invoice.total - invoice.totalPaid;
        if (remaining > 0) {
          doc.text(`Balance Due: ${formatCurrency(remaining)}`, {
            align: "right",
          });
        }
      }

      // Notes
      if (invoice.notes) {
        tableY += 40;
        doc.font("Helvetica-Bold").fontSize(10).text("Notes:", 50, tableY);
        doc
          .font("Helvetica")
          .fontSize(9)
          .text(invoice.notes, 50, tableY + 15, { width: 500 });
      }

      // Footer
      const footerY = 780;
      doc.fontSize(8).fill("#888888");
      doc.text("Thank you for your business!", 50, footerY, {
        align: "center",
        width: 500,
      });

      doc.end();
    } catch (error) {
      log.error("PDF generation error:", error);
      reject(error);
    }
  });
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

module.exports = { generateInvoicePdf };
