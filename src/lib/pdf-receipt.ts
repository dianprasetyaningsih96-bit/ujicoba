import {
  receiptDoc,
  BRAND,
  fmtNum,
  printPdf,
} from "./pdf";

export interface ReceiptItem {
  currency: string;
  foreign_amount: number;
  rate: number;
  idr_amount: number;
}

export interface ReceiptData {
  transaction_no: string;
  transaction_date: string;
  transaction_type: "buy" | "sell";
  branch?: { code: string; name: string } | null;
  customer?: {
    customer_code: string;
    full_name: string;
    nationality?: string | null;
    occupation?: string | null;
    date_of_birth?: string | null;
    place_of_birth?: string | null;
  } | null;
  items?: ReceiptItem[];
  currency?: string;
  foreign_amount?: number;
  rate?: number;
  idr_amount: number;
  payment_method?: string;
  teller_name?: string;
  company_name?: string;
  company_address?: string;
  company_phone?: string;
  license_pva?: string;
  npwp_number?: string;
}

function receiptDate(value: string) {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatBirthDate(dob?: string | null): string {
  if (!dob) return "-";
  try {
    const match = dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
    const d = new Date(dob);
    if (isNaN(d.getTime())) return dob;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  } catch {
    return dob;
  }
}

/**
 * Builds pure, high-contrast HTML string optimized for thermal POS printers (58mm / 76mm / 80mm).
 * Renders native vector text without PDF rasterization or dithering blur on Google Chrome & Firefox.
 */
export function buildReceiptHtml(r: ReceiptData): string {
  const companyName = (r.company_name || BRAND.name).toUpperCase();
  const dateStr = receiptDate(r.transaction_date);
  const customerName = (r.customer?.full_name || "WALK-IN CUSTOMER").toUpperCase();
  const customerCode = r.customer?.customer_code || "-";
  const custNationality = (r.customer?.nationality || "-").toUpperCase();
  const custOccupation = (r.customer?.occupation || "-").toUpperCase();
  const custDateBirth = formatBirthDate(r.customer?.date_of_birth);
  const custPlaceBirth = (r.customer?.place_of_birth || "-").toUpperCase();
  const items: ReceiptItem[] =
    r.items && r.items.length > 0
      ? r.items
      : r.currency
        ? [
            {
              currency: r.currency,
              foreign_amount: r.foreign_amount ?? 0,
              rate: r.rate ?? 0,
              idr_amount: r.idr_amount,
            },
          ]
        : [];
  const idrStr = new Intl.NumberFormat("id-ID").format(Math.round(r.idr_amount));
  const outlet = (r.branch?.name || r.branch?.code || "-").toUpperCase();
  const payType = (r.payment_method || "Cash").toUpperCase();
  const operator = (r.teller_name || "CUSTOMER").toUpperCase();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Struk ${r.transaction_no}</title>
  <style>
    @page {
      size: 76mm auto;
      margin: 0;
    }
    @media print {
      html, body {
        width: 76mm !important;
        margin: 0 auto !important;
        padding: 0 !important;
        background: #ffffff !important;
        color: #000000 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .receipt-wrapper {
        width: 58mm !important;
        max-width: 58mm !important;
        margin: 0 auto !important;
        padding: 2mm 0 6mm 0 !important;
      }
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Courier New', Courier, Consolas, Monaco, monospace;
      font-size: 9.5px;
      line-height: 1.32;
      color: #000000;
      background: #ffffff;
      /* Enable standard font smoothing for crisp text in Chrome */
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
    .receipt-wrapper {
      width: 58mm;
      max-width: 58mm;
      margin: 0 auto;
      padding: 3mm 0 6mm 0;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .bold { font-weight: bold; }
    .company-title {
      font-size: 11px;
      font-weight: bold;
      margin-bottom: 1px;
    }
    .sub-header {
      font-size: 9px;
      line-height: 1.2;
    }
    .divider {
      border-top: 1px dashed #000000;
      margin: 3px 0;
      width: 100%;
    }
    .flex-between {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      width: 100%;
    }
    .detail-row {
      display: flex;
      font-size: 9.5px;
      margin-bottom: 1px;
    }
    .detail-label {
      width: 66px;
      flex-shrink: 0;
    }
    .detail-sep {
      width: 8px;
      flex-shrink: 0;
      text-align: center;
    }
    .detail-val {
      flex: 1;
      word-break: break-word;
    }
    .table-hdr {
      display: flex;
      justify-content: space-between;
      font-weight: bold;
      font-size: 9px;
      padding: 1px 0;
    }
    .rate-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 9.5px;
      margin: 2px 0;
    }
    .total-box {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      font-weight: bold;
      font-size: 9.5px;
      margin-top: 2px;
    }
    .grand-total {
      display: flex;
      justify-content: space-between;
      font-weight: bold;
      font-size: 10.5px;
      margin-top: 2px;
    }
    .signatures {
      margin-top: 14px;
      display: flex;
      justify-content: space-between;
      padding: 0 4px;
      text-align: center;
      font-size: 9px;
    }
    .attention {
      margin-top: 10px;
      text-align: center;
      font-size: 8.5px;
      line-height: 1.25;
    }
  </style>
</head>
<body>
  <div class="receipt-wrapper">
    <div class="text-center">
      <div class="company-title">${companyName}</div>
      <div class="sub-header bold">AUTHORIZED MONEY CHANGER</div>
      ${r.company_address ? `<div class="sub-header">${r.company_address.toUpperCase()}</div>` : ""}
      ${r.company_phone ? `<div class="sub-header">TELP/WA ${r.company_phone}</div>` : ""}
      ${r.license_pva ? `<div class="sub-header">IZIN PVA ${r.license_pva}</div>` : ""}
      ${r.npwp_number ? `<div class="sub-header">NPWP:${r.npwp_number}</div>` : ""}
    </div>

    <div class="flex-between bold" style="margin-top: 4px; font-size: 9.5px;">
      <span>${r.transaction_type === "buy" ? "BUYING (BN)" : "SELLING (JN)"}</span>
      <span>NO:${r.transaction_no}</span>
    </div>
    <div class="divider"></div>

    <div class="detail-row"><span class="detail-label">Date</span><span class="detail-sep">:</span><span class="detail-val">${dateStr}</span></div>
    <div class="detail-row"><span class="detail-label">Name</span><span class="detail-sep">:</span><span class="detail-val">${customerName}</span></div>
    <div class="detail-row"><span class="detail-label">ID/KTP</span><span class="detail-sep">:</span><span class="detail-val">${customerCode}</span></div>
    <div class="detail-row"><span class="detail-label">Nationality</span><span class="detail-sep">:</span><span class="detail-val">${custNationality}</span></div>
    <div class="detail-row"><span class="detail-label">Occupation</span><span class="detail-sep">:</span><span class="detail-val">${custOccupation}</span></div>
    <div class="detail-row"><span class="detail-label">DateBirth</span><span class="detail-sep">:</span><span class="detail-val">${custDateBirth}</span></div>
    <div class="detail-row"><span class="detail-label">PlaceBirth</span><span class="detail-sep">:</span><span class="detail-val">${custPlaceBirth}</span></div>
    <div class="detail-row"><span class="detail-label">Pay type</span><span class="detail-sep">:</span><span class="detail-val">${payType}</span></div>
    <div class="detail-row"><span class="detail-label">Outlet/DC</span><span class="detail-sep">:</span><span class="detail-val">${outlet}</span></div>
    <div class="detail-row"><span class="detail-label">Objective</span><span class="detail-sep">:</span><span class="detail-val">CURRENCY EXCHANGE</span></div>
    <div class="divider"></div>

    <div class="table-hdr">
      <span>CURRENCY / AMOUNT</span>
      <span>RATE</span>
      <span>TOTAL RP</span>
    </div>
    <div class="divider"></div>

    ${items
      .map((it) => {
        const itCurr = (it.currency || "").toUpperCase();
        const itFAmount = fmtNum(it.foreign_amount, 2);
        const itRate = fmtNum(it.rate, 2);
        const itIdr = new Intl.NumberFormat("id-ID").format(Math.round(it.idr_amount));
        return `<div class="rate-row">
      <span>${itCurr} ${itFAmount}</span>
      <span>x ${itRate} =</span>
      <span>${itIdr}</span>
    </div>`;
      })
      .join("\n    ")}
    <div class="divider"></div>

    <div class="total-box">
      <span>TOTAL RP =</span>
      <span>${idrStr}</span>
    </div>
    <div class="grand-total">
      <span>(RP)</span>
      <span>${idrStr}</span>
    </div>
    <div class="divider"></div>

    ${r.teller_name ? `<div class="detail-row"><span class="detail-label">Operator</span><span class="detail-sep">:</span><span class="detail-val">${r.teller_name.toUpperCase()}</span></div>` : ""}

    <div class="signatures">
      <span>( ${operator} )</span>
      <span>( CASHIER )</span>
    </div>

    <div class="attention">
      <div class="bold">ATTENTION #</div>
      <div>Claim for shortage of cash after leaving</div>
      <div>our premises cannot be considered</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Direct Thermal Print using native browser HTML/CSS print pipeline.
 * This bypasses Chrome's PDFium rasterizer dithering, producing crisp 100% sharp dot-matrix text across all browsers.
 */
export function printReceiptDirect(r: ReceiptData) {
  try {
    const html = buildReceiptHtml(r);
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.visibility = "hidden";
    document.body.appendChild(frame);

    const doc = frame.contentWindow?.document;
    if (!doc) {
      generateReceiptPdf(r);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Trigger print once iframe DOM and styles are fully ready
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch (e) {
        console.error("Direct HTML print failed, falling back to PDF:", e);
        generateReceiptPdf(r);
      }
      setTimeout(() => {
        frame.remove();
      }, 60_000);
    }, 150);
  } catch (err) {
    console.error("Direct print exception, using PDF fallback:", err);
    generateReceiptPdf(r);
  }
}

/** 76 × 297mm dot-matrix receipt with a printer-safe monospaced layout (PDF Format). */
export function generateReceiptPdf(r: ReceiptData) {
  const doc = receiptDoc();
  const width = 76;
  const left = 7;
  const right = width - 7;
  let y = 8;

  const text = (value: string, x: number, size = 7.5, align: "left" | "center" | "right" = "left", bold = false) => {
    doc.setFont("courier", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
    doc.text(value, x, y, { align, renderingMode: "fill" });
  };
  const centered = (value: string, size = 7.5, bold = false) => {
    text(value, width / 2, size, "center", bold);
    y += 4.0;
  };
  const divider = () => {
    doc.setFont("courier", "normal");
    text("----------------------------------------", width / 2, 7, "center");
    y += 4.0;
  };
  const detail = (label: string, value: string) => {
    text(label, left, 7.5);
    text(":", left + 19, 7.5);
    text(value, left + 21, 7.5);
    y += 3.8;
  };

  centered((r.company_name || BRAND.name).toUpperCase(), 8.5, true);
  centered("AUTHORIZED MONEY CHANGER", 7.5);
  if (r.company_address) {
    for (const line of doc.splitTextToSize(r.company_address.toUpperCase(), width - 14) as string[]) {
      centered(line, 7.5);
    }
  }
  if (r.company_phone) centered(`TELP/WA ${r.company_phone}`, 7.5);
  if (r.license_pva) centered(`IZIN PVA ${r.license_pva}`, 7.5);
  if (r.npwp_number) centered(`NPWP:${r.npwp_number}`, 7.5);
  y += 1.5;

  text(r.transaction_type === "buy" ? "BUYING (BN)" : "SELLING (JN)", left, 7.5, "left", true);
  text(`NO:${r.transaction_no}`, right, 7.5, "right");
  y += 4.5;
  divider();

  detail("Date", receiptDate(r.transaction_date));
  detail("Name", (r.customer?.full_name || "WALK-IN CUSTOMER").toUpperCase());
  detail("ID/KTP", r.customer?.customer_code || "-");
  detail("Nationality", (r.customer?.nationality || "-").toUpperCase());
  detail("Occupation", (r.customer?.occupation || "-").toUpperCase());
  detail("DateBirth", formatBirthDate(r.customer?.date_of_birth));
  detail("PlaceBirth", (r.customer?.place_of_birth || "-").toUpperCase());
  detail("Pay type", (r.payment_method || "Cash").toUpperCase());
  detail("Outlet/DC", (r.branch?.name || r.branch?.code || "-").toUpperCase());
  detail("Objective", "CURRENCY EXCHANGE");
  y += 1;
  divider();

  text("CURRENCY / AMOUNT    RATE       TOTAL RP", width / 2, 6.8, "center", true);
  y += 4.0;
  divider();

  const items: ReceiptItem[] =
    r.items && r.items.length > 0
      ? r.items
      : r.currency
        ? [
            {
              currency: r.currency,
              foreign_amount: r.foreign_amount ?? 0,
              rate: r.rate ?? 0,
              idr_amount: r.idr_amount,
            },
          ]
        : [];
  const idrStr = new Intl.NumberFormat("id-ID").format(Math.round(r.idr_amount));

  for (const it of items) {
    const currStr = (it.currency || "").toUpperCase();
    const fAmountStr = fmtNum(it.foreign_amount, 2);
    const rateStr = `x ${fmtNum(it.rate, 2)} =`;
    const itIdrStr = new Intl.NumberFormat("id-ID").format(Math.round(it.idr_amount));

    const leftSide = `${currStr} ${fAmountStr}`;
    const rightSide = itIdrStr;
    const remaining = 40 - leftSide.length - rateStr.length - rightSide.length;
    const leftPad = Math.max(1, Math.floor(remaining / 2));
    const rightPad = Math.max(1, remaining - leftPad);
    const rowText = leftSide + " ".repeat(leftPad) + rateStr + " ".repeat(rightPad) + rightSide;

    text(rowText, width / 2, 6.8, "center", false);
    y += 4.0;
  }
  divider();

  text("TOTAL RP =", right - doc.getTextWidth(idrStr) - 3, 7, "right", true);
  text(idrStr, right, 7, "right", true);
  y += 5.0;
  text("(RP)", left, 8, "left", true);
  text(idrStr, right, 8, "right", true);
  y += 5.0;
  divider();

  if (r.teller_name) detail("Operator", r.teller_name.toUpperCase());
  y += 8;
  centered(`( ${r.teller_name?.toUpperCase() || "CUSTOMER"} )   ( CASHIER )`, 7.5);
  y += 6;
  centered("ATTENTION #", 7.5, true);
  centered("Claim for shortage of cash after leaving", 7.5);
  centered("out premises can not be considered", 7.5);

  printPdf(doc, `struk-${r.transaction_no}.pdf`);
}
