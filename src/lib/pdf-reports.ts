import type jsPDF from "jspdf";
import {
  portraitDoc,
  landscapeDoc,
  drawHeader,
  drawFooter,
  table,
  openPdf,
  fmtIDR,
  BRAND,
} from "./pdf";

export interface ReportTrxRow {
  transaction_no: string;
  transaction_type: "buy" | "sell";
  transaction_date: string;
  rate: number;
  foreign_amount: number;
  idr_amount: number;
  payment_method: string;
  status: string;
  is_suspicious: boolean;
  suspicious_reason: string | null;
  ltkm_report_no: string | null;
  currencies?: { code: string } | null;
  customers?: { customer_code: string; full_name: string; id_number: string } | null;
  branches?: { code: string; name: string } | null;
  transaction_items?: Array<{
    foreign_amount: number;
    rate: number;
    idr_amount: number;
    currencies?: { code: string } | null;
  }> | null;
}

export interface ReportMeta {
  title: string;
  variant: "harian" | "bulanan" | "ltkt" | "ltkm";
  branchLabel: string;
  branchAddress?: string;
  dateFrom: string;
  dateTo: string;
  totals: { count: number; buy: number; sell: number; suspicious: number };
}

export interface LkubReportRow {
  currency_code: string;
  opening_foreign: number;
  opening_idr: number;
  buy_foreign: number;
  buy_idr: number;
  sell_foreign: number;
  sell_idr: number;
  mid_rate: number | null;
}

function summaryBox(doc: jsPDF, y: number, meta: ReportMeta) {
  const w = doc.internal.pageSize.getWidth();
  const boxW = (w - 24 - 9) / 4;
  const items: [string, string][] = [
    ["Total Transaksi", String(meta.totals.count)],
    ["Nilai Beli", fmtIDR(meta.totals.buy)],
    ["Nilai Jual", fmtIDR(meta.totals.sell)],
    ["LTKM Ditandai", String(meta.totals.suspicious)],
  ];
  items.forEach(([k, v], i) => {
    const x = 12 + i * (boxW + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...BRAND.line);
    doc.roundedRect(x, y, boxW, 16, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.muted);
    doc.text(k, x + 3, y + 5.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...BRAND.primary);
    doc.text(v, x + 3, y + 12);
  });
  return y + 20;
}

function metaBox(doc: jsPDF, y: number, meta: ReportMeta) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.muted);
  const line = `Periode: ${meta.dateFrom} s/d ${meta.dateTo}   ·   Cabang: ${meta.branchLabel}${meta.branchAddress ? " — " + meta.branchAddress : ""}`;
  doc.text(line, 12, y);
  return y + 4;
}

export function generateReportPdf(meta: ReportMeta, rows: ReportTrxRow[]) {
  const doc = landscapeDoc();
  let y = drawHeader(doc, meta.title, "Laporan KUPVA BB");
  y = metaBox(doc, y + 2, meta);
  y = summaryBox(doc, y + 2, meta);

  const includeLtkm = meta.variant === "ltkm";

  const body = rows.map((r) => {
    const isMulti = r.transaction_items && r.transaction_items.length > 1;
    const valasCode = isMulti
      ? r.transaction_items!.map((it) => it.currencies?.code ?? "-").join("\n")
      : r.currencies?.code ?? "-";
    const valasNominal = isMulti
      ? r.transaction_items!
          .map((it) => new Intl.NumberFormat("id-ID").format(Number(it.foreign_amount)))
          .join("\n")
      : new Intl.NumberFormat("id-ID").format(Number(r.foreign_amount));
    const valasKurs = isMulti
      ? r.transaction_items!
          .map((it) =>
            new Intl.NumberFormat("id-ID", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(Number(it.rate)),
          )
          .join("\n")
      : new Intl.NumberFormat("id-ID", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(Number(r.rate));

    const base = [
      r.transaction_no,
      new Date(r.transaction_date).toLocaleString("id-ID"),
      r.transaction_type === "buy" ? "Beli" : "Jual",
      r.branches?.code ?? "-",
      r.customers?.full_name ?? "Walk-in",
      r.customers?.id_number ?? "-",
      valasCode,
      valasNominal,
      valasKurs,
      fmtIDR(Number(r.idr_amount)),
      r.payment_method,
      r.status + (r.is_suspicious ? " · LTKM" : ""),
    ];
    if (includeLtkm) {
      base.push(r.ltkm_report_no ?? "-");
      base.push(r.suspicious_reason ?? "-");
    }
    return base;
  });

  const head = [
    [
      "No. Trx",
      "Tanggal",
      "Jenis",
      "Cabang",
      "Nasabah",
      "No. Identitas",
      "Valas",
      "Nominal",
      "Kurs",
      "IDR",
      "Metode",
      "Status",
      ...(includeLtkm ? ["No. LTKM", "Alasan"] : []),
    ],
  ];

  table(doc, {
    startY: y + 2,
    head,
    body,
    styles: { fontSize: 7.5, cellPadding: 1.4 },
    columnStyles: {
      0: { fontStyle: "bold" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right", fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.section === "body") {
        const raw = rows[data.row.index];
        if (raw?.is_suspicious) {
          data.cell.styles.fillColor = [254, 249, 195];
        }
        if (raw?.status === "voided") {
          data.cell.styles.textColor = [180, 83, 9];
        }
      }
    },
  });

  drawFooter(
    doc,
    "Laporan bersifat rahasia — untuk keperluan internal & pelaporan PPATK",
  );

  const fname = `laporan-${meta.variant}-${meta.dateFrom}-sd-${meta.dateTo}.pdf`;
  openPdf(doc, fname);
}

export function generateLtkmReportPdf(meta: ReportMeta, rows: ReportTrxRow[]) {
  const suspicious = rows.filter((r) => r.is_suspicious);
  const doc = portraitDoc();
  let y = drawHeader(doc, "LAPORAN LTKM", "PPATK — Transaksi Keuangan Mencurigakan");
  y = metaBox(doc, y + 2, { ...meta, title: "LTKM" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Jumlah transaksi ditandai: ${suspicious.length}`,
    12,
    y + 4,
  );

  const body = suspicious.map((r) => [
    r.transaction_no,
    new Date(r.transaction_date).toLocaleString("id-ID"),
    r.transaction_type === "buy" ? "Beli" : "Jual",
    r.customers?.full_name ?? "Walk-in",
    r.customers?.id_number ?? "-",
    (r.currencies?.code ?? "-") +
      " " +
      new Intl.NumberFormat("id-ID").format(Number(r.foreign_amount)),
    fmtIDR(Number(r.idr_amount)),
    r.ltkm_report_no ?? "-",
    r.suspicious_reason ?? "-",
  ]);

  table(doc, {
    startY: y + 8,
    head: [
      [
        "No. Trx",
        "Tanggal",
        "Jenis",
        "Nasabah",
        "No. Identitas",
        "Valas",
        "IDR",
        "No. LTKM",
        "Alasan",
      ],
    ],
    body,
    styles: { fontSize: 7.5, cellPadding: 1.4 },
    columnStyles: {
      6: { halign: "right", fontStyle: "bold" },
      8: { cellWidth: 45 },
    },
  });

  drawFooter(doc, "Dokumen rahasia — hanya untuk PPATK & auditor");
  openPdf(doc, `LTKM-${meta.dateFrom}-sd-${meta.dateTo}.pdf`);
}

export function generateLkubReportPdf(meta: ReportMeta, rows: LkubReportRow[]) {
  const doc = landscapeDoc();
  let y = drawHeader(
    doc,
    "LAPORAN KEGIATAN USAHA BULANAN",
    "LKUB — KUPVA BB",
  );
  y = metaBox(doc, y + 2, meta);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    "Jenis Produk: 1 - UKA · Saldo awal dan saldo akhir mengikuti ketentuan laporan",
    12,
    y + 4,
  );

  const body = rows.map((r) => {
    const saldoAkhirValas = r.opening_foreign + r.buy_foreign - r.sell_foreign;
    const saldoAkhirIdr = r.mid_rate !== null ? saldoAkhirValas * r.mid_rate : 0;
    
    return [
      r.currency_code,
      "1 - UKA",
      new Intl.NumberFormat("id-ID", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(r.opening_foreign)),
      fmtIDR(Number(r.opening_idr)),
      new Intl.NumberFormat("id-ID", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(r.buy_foreign)),
      fmtIDR(Number(r.buy_idr)),
      new Intl.NumberFormat("id-ID", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(r.sell_foreign)),
      fmtIDR(Number(r.sell_idr)),
      new Intl.NumberFormat("id-ID", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(saldoAkhirValas),
      r.mid_rate === null
        ? "-"
        : "Rp " + new Intl.NumberFormat("id-ID", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(Number(r.mid_rate)),
      fmtIDR(saldoAkhirIdr),
    ];
  });

  table(doc, {
    startY: y + 8,
    head: [
      [
        "Jenis Valuta",
        "Jenis Produk",
        "Saldo Awal Dalam Valas",
        "Saldo Awal Dalam Rupiah",
        "Volume Pembelian Dalam Valas",
        "Volume Pembelian Dalam Rupiah",
        "Volume Penjualan Dalam Valas",
        "Volume Penjualan Dalam Rupiah",
        "Saldo Akhir Dalam Valas",
        "Kurs Tengah",
        "Saldo Akhir Dalam Rupiah",
      ],
    ],
    body,
    styles: { fontSize: 6.4, cellPadding: 1.1, overflow: "linebreak" },
    headStyles: { fontSize: 6.2, cellPadding: 1.1 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 18 },
      1: { cellWidth: 18 },
      2: { halign: "right", cellWidth: 24 },
      3: { halign: "right", cellWidth: 25 },
      4: { halign: "right", cellWidth: 29 },
      5: { halign: "right", cellWidth: 30 },
      6: { halign: "right", cellWidth: 29 },
      7: { halign: "right", cellWidth: 30 },
      8: { halign: "right", cellWidth: 25 },
      9: { halign: "right", cellWidth: 22 },
      10: { halign: "right", cellWidth: 26 },
    },
  });

  drawFooter(doc, "LKUB — dokumen internal dan pelaporan regulator");
  openPdf(doc, `LKUB-${meta.dateFrom}-sd-${meta.dateTo}.pdf`);
}
