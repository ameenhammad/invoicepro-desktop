import PDFDocument from "pdfkit";
import log from "electron-log";
import { formatCurrency, formatDate as formatDateShort } from "../shared/utils.js";

export function generateInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    try {
      const fmt = (amount) => formatCurrency(amount, invoice.currencySymbol);
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({ success: true, data: buffer });
      });
      doc.on("error", reject);

      const pageWidth = 595.28;
      const leftMargin = 50;
      const rightMargin = 50;
      const contentWidth = pageWidth - leftMargin - rightMargin;

      // ========== HEADER ==========
      // FIX: Draw company info (left) and invoice details (right) using
      // absolute coordinates so they never interfere with each other.

      // -- Left side: Company info --
      doc
        .fillColor("#1a1a1a")
        .fontSize(16)
        .font("Helvetica-Bold")
        .text(invoice.company_name || "My Company", leftMargin, 50, {
          width: 260,
        });

      doc.fillColor("#555555").fontSize(9).font("Helvetica");
      let companyY = 72;
      if (invoice.company_address) {
        const addr = invoice.company_address.replace(/\n/g, ", ");
        doc.text(addr, leftMargin, companyY, { width: 260 });
        companyY = doc.y;
      }
      if (invoice.company_phone) {
        doc.text(`Phone: ${invoice.company_phone}`, leftMargin, companyY, {
          width: 260,
        });
        companyY = doc.y;
      }
      if (invoice.company_email) {
        doc.text(`Email: ${invoice.company_email}`, leftMargin, companyY, {
          width: 260,
        });
      }

      // -- Right side: Invoice title + details (absolute Y positions) --
      doc
        .fillColor("#1a1a1a")
        .fontSize(26)
        .font("Helvetica-Bold")
        .text("INVOICE", leftMargin, 50, {
          width: contentWidth,
          align: "right",
        });

      // FIX: Each detail line uses an explicit absolute Y so they stack
      // independently of the left-side company block
      const detailX = leftMargin + 260;
      const detailWidth = contentWidth - 260;
      doc.fillColor("#555555").fontSize(10).font("Helvetica");
      doc.text(`Invoice #: ${invoice.invoice_number || "N/A"}`, detailX, 82, {
        width: detailWidth,
        align: "right",
      });
      doc.text(`Issue Date: ${formatDate(invoice.issue_date)}`, detailX, 97, {
        width: detailWidth,
        align: "right",
      });
      doc.text(`Due Date: ${formatDate(invoice.due_date)}`, detailX, 112, {
        width: detailWidth,
        align: "right",
      });
      doc.text(
        `Status: ${(invoice.status || "draft").toUpperCase()}`,
        detailX,
        127,
        { width: detailWidth, align: "right" },
      );

      // ========== DIVIDER ==========
      const headerBottom = Math.max(doc.y, 145);
      doc
        .moveTo(leftMargin, headerBottom + 8)
        .lineTo(pageWidth - rightMargin, headerBottom + 8)
        .strokeColor("#dddddd")
        .stroke();

      // ========== BILL TO ==========
      const billToY = headerBottom + 22;
      doc
        .fillColor("#1a1a1a")
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Bill To:", leftMargin, billToY);
      doc.fillColor("#333333").fontSize(10).font("Helvetica");
      // Walk-in sales point at the shared Walk-in Customer client record but
      // can carry the actual customer's name for this one invoice — show
      // that in preference to the generic client name whenever it's set.
      doc.text(invoice.walkin_customer_name || invoice.client_name || "N/A", leftMargin, doc.y, { width: 260 });
      if (invoice.client_address_line1)
        doc.text(invoice.client_address_line1, leftMargin, doc.y, {
          width: 260,
        });
      if (invoice.client_address_line2)
        doc.text(invoice.client_address_line2, leftMargin, doc.y, {
          width: 260,
        });
      if (
        invoice.client_city ||
        invoice.client_state ||
        invoice.client_postal_code
      ) {
        doc.text(
          `${invoice.client_city || ""} ${invoice.client_state || ""} ${invoice.client_postal_code || ""}`.trim(),
          leftMargin,
          doc.y,
          { width: 260 },
        );
      }
      if (invoice.client_country)
        doc.text(invoice.client_country, leftMargin, doc.y, { width: 260 });
      if (invoice.client_email)
        doc.text(`Email: ${invoice.client_email}`, leftMargin, doc.y, {
          width: 260,
        });
      if (invoice.client_phone)
        doc.text(`Phone: ${invoice.client_phone}`, leftMargin, doc.y, {
          width: 260,
        });

      // ========== LINE ITEMS TABLE ==========
      const drawTableHeader = (y) => {
        doc.rect(leftMargin, y, contentWidth, 22).fill("#2c3e50");
        doc.fill("#ffffff").font("Helvetica-Bold").fontSize(9);
        doc.text("Description", colX[0] + 5, y + 6, {
          width: colWidths[0] - 5,
        });
        doc.text("Variant", colX[1], y + 6, {
          width: colWidths[1],
          align: "center",
        });
        doc.text("Qty", colX[2], y + 6, {
          width: colWidths[2],
          align: "center",
        });
        doc.text("Unit Price", colX[3], y + 6, {
          width: colWidths[3],
          align: "right",
        });
        doc.text("Total", colX[4], y + 6, {
          width: colWidths[4],
          align: "right",
        });
        return y + 22;
      };

      const colWidths = [220, 60, 70, 75, 75];
      const colX = [
        leftMargin,
        leftMargin + 225,
        leftMargin + 285,
        leftMargin + 355,
        leftMargin + 430,
      ];

      let tableY = doc.y + 20;
      tableY = drawTableHeader(tableY);

      doc.font("Helvetica").fontSize(9);

      if (invoice.items && invoice.items.length > 0) {
        for (let i = 0; i < invoice.items.length; i++) {
          const item = invoice.items[i];
          const lineTotal = item.line_total || item.quantity * item.unit_price;
          const isAlternate = i % 2 === 1;

          if (isAlternate) {
            doc.rect(leftMargin, tableY - 2, contentWidth, 18).fill("#f8f9fa");
          }

          doc.fillColor("#333333").font("Helvetica").fontSize(9);
          const descText = item.description || item.product_name || "N/A";
          doc.text(descText, colX[0] + 5, tableY, { width: colWidths[0] - 5 });
          doc.text(item.variant_name || "-", colX[1], tableY, {
            width: colWidths[1],
            align: "center",
          });
          doc.text(String(item.quantity || 1), colX[2], tableY, {
            width: colWidths[2],
            align: "center",
          });
          doc.text(fmt(item.unit_price), colX[3], tableY, {
            width: colWidths[3],
            align: "right",
          });
          doc.text(fmt(lineTotal), colX[4], tableY, {
            width: colWidths[4],
            align: "right",
          });

          tableY += 18;

          // FIX: Page break redraws table headers on new page
          if (tableY > 700) {
            doc.addPage();
            tableY = 70;
            tableY = drawTableHeader(tableY); // FIX: redraw headers after page break
            doc.font("Helvetica").fontSize(9);
          }
        }
      }

      // ========== TOTALS ==========
      tableY += 10;
      doc
        .moveTo(leftMargin + 280, tableY)
        .lineTo(leftMargin + contentWidth, tableY)
        .strokeColor("#cccccc")
        .stroke();

      tableY += 10;
      doc.fillColor("#333333").font("Helvetica").fontSize(10);

      doc.text("Subtotal:", leftMargin + 230, tableY, {
        width: 120,
        align: "right",
      });
      doc.text(fmt(invoice.subtotal), leftMargin + 370, tableY, {
        width: 100,
        align: "right",
      });

      if (invoice.discount_amount > 0) {
        tableY += 16;
        const discountLabel =
          invoice.discount_type === "amount"
            ? "Discount:"
            : `Discount (${invoice.discount_percent || 0}%):`;
        doc.text(
          discountLabel,
          leftMargin + 230,
          tableY,
          { width: 120, align: "right" },
        );
        doc.text(
          `-${fmt(invoice.discount_amount)}`,
          leftMargin + 370,
          tableY,
          { width: 100, align: "right" },
        );
      }

      if (invoice.tax_amount > 0) {
        tableY += 16;
        doc.text(
          `Tax (${invoice.tax_percent || 0}%):`,
          leftMargin + 230,
          tableY,
          { width: 120, align: "right" },
        );
        doc.text(fmt(invoice.tax_amount), leftMargin + 370, tableY, {
          width: 100,
          align: "right",
        });
      }

      tableY += 16;
      doc
        .rect(leftMargin + 280, tableY, contentWidth - 230, 24)
        .fill("#2c3e50");
      doc.fill("#ffffff").font("Helvetica-Bold").fontSize(11);
      doc.text("Grand Total:", leftMargin + 290, tableY + 6, { width: 90 });
      doc.text(fmt(invoice.total), leftMargin + 370, tableY + 6, {
        width: 100,
        align: "right",
      });

      // ========== PAYMENTS RECEIVED ==========
      if (invoice.totalPaid > 0) {
        tableY += 32;
        doc.font("Helvetica").fontSize(9).fillColor("#333333");
        doc.text(
          `Payments Received: ${fmt(invoice.totalPaid)}`,
          leftMargin,
          tableY,
          { width: contentWidth, align: "right" },
        );

        // Most invoices have exactly one payment (paid in full, on the
        // spot); list distinct methods if more than one was used.
        const methods = [
          ...new Set((invoice.payments || []).map((p) => p.method).filter(Boolean)),
        ].map((m) => m.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));
        if (methods.length > 0) {
          tableY += 14;
          doc.text(
            `Payment Method: ${methods.join(", ")}`,
            leftMargin,
            tableY,
            { width: contentWidth, align: "right" },
          );
        }

        const remaining = invoice.total - invoice.totalPaid;
        if (remaining > 0.005) {
          // FIX: use small epsilon to avoid floating point false positives
          tableY += 14;
          doc.text(
            `Balance Due: ${fmt(remaining)}`,
            leftMargin,
            tableY,
            { width: contentWidth, align: "right" },
          );
        }
      }

      // ========== NOTES ==========
      if (invoice.notes) {
        tableY += 40;
        doc
          .fillColor("#1a1a1a")
          .font("Helvetica-Bold")
          .fontSize(10)
          .text("Notes:", leftMargin, tableY);
        doc
          .fillColor("#555555")
          .font("Helvetica")
          .fontSize(9)
          .text(invoice.notes, leftMargin, tableY + 15, {
            width: contentWidth,
          });
        tableY = doc.y;
      }

      // ========== FOOTER ==========
      // FIX: Only draw footer if there's space; otherwise it lands on current page bottom
      const footerY = doc.page.height - 40;
      if (doc.y < footerY - 20) {
        doc
          .fontSize(8)
          .fillColor("#888888")
          .text("Thank you for your business!", leftMargin, footerY, {
            align: "center",
            width: contentWidth,
          });
      }

      doc.end();
    } catch (error) {
      log.error("PDF generation error:", error);
      reject(error);
    }
  });
}

function formatDate(dateStr) {
  return formatDateShort(dateStr) || "N/A";
}
