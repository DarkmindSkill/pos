import {
  LabelFormatConfig,
  PaperWidth,
  Product,
  ReceiptLangMode,
  Sale,
  SaleItem,
  StoreConfig,
  StoreContact,
} from '../types';
import { formatDateTime, formatMoney, generateQrDataUrl } from './soundAndFormat';

function escapeHtml(raw: string): string {
  return (raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function triggerIframePrint(htmlDocument: string) {
  let iframe = document.getElementById('kadepos-print-frame') as HTMLIFrameElement | null;
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'kadepos-print-frame';
    iframe.title = 'KadePOS Print Frame';
    iframe.setAttribute(
      'style',
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
    );
    document.body.appendChild(iframe);
  }

  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) return;

  doc.open();
  doc.write(htmlDocument);
  doc.close();

  const win = iframe.contentWindow;
  const images = Array.from(doc.images);

  const executePrint = () => {
    setTimeout(() => {
      win.focus();
      win.print();
    }, 120);
  };

  if (images.length === 0) {
    executePrint();
    return;
  }

  let loadedCount = 0;
  const checkDone = () => {
    loadedCount += 1;
    if (loadedCount >= images.length) {
      executePrint();
    }
  };

  images.forEach((img) => {
    if (img.complete) {
      checkDone();
    } else {
      img.onload = checkDone;
      img.onerror = checkDone;
    }
  });
}

export interface PrintReceiptOptions {
  sale: Sale;
  items: SaleItem[];
  store: StoreConfig;
  contact: StoreContact | null;
  paperWidth: PaperWidth;
  langMode: ReceiptLangMode;
}

export async function printThermalReceipt({
  sale,
  items,
  store,
  contact,
  paperWidth,
  langMode,
}: PrintReceiptOptions): Promise<void> {
  const is58 = paperWidth === '58mm';
  const pageWidthMm = is58 ? '58mm' : '80mm';
  const printableWidthMm = is58 ? '48mm' : '72mm';

  const showEn = langMode === 'en' || langMode === 'bilingual';
  const showSi = langMode === 'si' || langMode === 'bilingual';

  const storeHeaderLines: string[] = [];
  if (showEn && store.storeName) {
    storeHeaderLines.push(`<div class="title">${escapeHtml(store.storeName)}</div>`);
  }
  if (showSi && store.storeNameSi) {
    storeHeaderLines.push(`<div class="subtitle-si">${escapeHtml(store.storeNameSi)}</div>`);
  }
  if (storeHeaderLines.length === 0) {
    storeHeaderLines.push(`<div class="title">${escapeHtml(store.storeName)}</div>`);
  }

  const labelInv = langMode === 'si' ? 'බිල් අංකය' : langMode === 'bilingual' ? 'INV / බිල්' : 'INV';
  const labelDate = langMode === 'si' ? 'දිනය' : 'Date';
  const labelCashier = langMode === 'si' ? 'අයකැමි' : 'Cashier';
  const labelSubtotal = langMode === 'si' ? 'උප එකතුව' : langMode === 'bilingual' ? 'Subtotal / උප එකතුව' : 'Subtotal';
  const labelDiscount = langMode === 'si' ? 'වට්ටම' : langMode === 'bilingual' ? 'Discount / වට්ටම' : 'Discount';
  const labelTax = langMode === 'si' ? 'බදු' : langMode === 'bilingual' ? 'Tax / බදු' : 'Tax';
  const labelTotal = langMode === 'si' ? 'මුළු එකතුව' : langMode === 'bilingual' ? 'TOTAL / මුළු මුදල' : 'TOTAL';
  const labelPaid = langMode === 'si' ? 'ගෙවූ මුදල' : langMode === 'bilingual' ? 'Paid / ගෙවීම' : 'Paid';
  const labelChange = langMode === 'si' ? 'ඉතිරි මුදල' : langMode === 'bilingual' ? 'Change / ඉතිරි' : 'Change';

  const itemRowsHtml = items
    .map((item) => {
      const primaryName =
        langMode === 'si' && item.productNameSi
          ? item.productNameSi
          : item.productName;
      const secondarySi =
        langMode === 'bilingual' && item.productNameSi
          ? `<div class="item-si">${escapeHtml(item.productNameSi)}</div>`
          : '';
      return `
        <div class="item-block">
          <div class="item-name">${escapeHtml(primaryName)}</div>
          ${secondarySi}
          <div class="item-nums">
            <span>${item.quantity} ${escapeHtml(item.unit)} x ${formatMoney(item.unitPrice, store.currency)}</span>
            <span class="bold">${formatMoney(item.lineTotal, store.currency)}</span>
          </div>
        </div>
      `;
    })
    .join('');

  const footerLines: string[] = [];
  if (showEn && store.receiptFooterEn) {
    footerLines.push(`<div>${escapeHtml(store.receiptFooterEn)}</div>`);
  }
  if (showSi && store.receiptFooterSi) {
    footerLines.push(`<div>${escapeHtml(store.receiptFooterSi)}</div>`);
  }

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(sale.invoiceNumber)}</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Noto+Sans+Sinhala:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    @page {
      size: ${pageWidthMm} auto;
      margin: 0mm;
    }
    * {
      box-sizing: border-box;
      color: #000000 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: ${pageWidthMm};
      background: #ffffff;
      font-family: 'JetBrains Mono', 'Noto Sans Sinhala', monospace;
      font-size: ${is58 ? '11px' : '12px'};
      line-height: 1.35;
    }
    .receipt {
      width: ${printableWidthMm};
      margin: 0 auto;
      padding: 2.5mm 1mm 6mm 1mm;
    }
    .center { text-align: center; }
    .title { font-size: ${is58 ? '14px' : '16px'}; font-weight: 700; letter-spacing: -0.02em; }
    .subtitle-si { font-size: ${is58 ? '12px' : '14px'}; font-weight: 600; margin-top: 1px; }
    .contact { font-size: 10px; margin-top: 2px; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    .divider-double { border-top: 2px solid #000; margin: 5px 0; }
    .meta-row { display: flex; justify-content: space-between; font-size: 10px; margin: 1.5px 0; gap: 4px; }
    .item-block { margin: 4px 0; }
    .item-name { font-weight: 600; word-break: break-word; }
    .item-si { font-size: 10px; }
    .item-nums { display: flex; justify-content: space-between; font-size: 10.5px; font-variant-numeric: tabular-nums; }
    .sum-row { display: flex; justify-content: space-between; margin: 2px 0; font-variant-numeric: tabular-nums; }
    .total-row { display: flex; justify-content: space-between; font-size: ${is58 ? '13px' : '15px'}; font-weight: 700; margin: 4px 0; font-variant-numeric: tabular-nums; }
    .bold { font-weight: 700; }
    .void-box { border: 1.5px solid #000; text-align: center; font-weight: 700; padding: 3px; margin: 4px 0; }
    .footer { text-align: center; font-size: 10px; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="center">
      ${storeHeaderLines.join('')}
      ${contact?.storeAddress ? `<div class="contact">${escapeHtml(contact.storeAddress)}</div>` : ''}
      ${contact?.storePhone ? `<div class="contact">Tel: ${escapeHtml(contact.storePhone)}</div>` : ''}
    </div>
    ${sale.status === 'voided' ? '<div class="void-box">VOIDED / අවලංගුයි</div>' : ''}
    <div class="divider"></div>
    <div class="meta-row"><span>${labelInv}:</span><span class="bold">${escapeHtml(sale.invoiceNumber)}</span></div>
    <div class="meta-row"><span>${labelDate}:</span><span>${escapeHtml(formatDateTime(sale.createdAt))}</span></div>
    <div class="meta-row"><span>${labelCashier}:</span><span>${escapeHtml(sale.cashierName)}</span></div>
    ${sale.customerNote ? `<div class="meta-row"><span>Ref:</span><span>${escapeHtml(sale.customerNote)}</span></div>` : ''}
    <div class="divider"></div>
    ${itemRowsHtml}
    <div class="divider"></div>
    <div class="sum-row"><span>${labelSubtotal}</span><span>${formatMoney(sale.subtotal, store.currency)}</span></div>
    ${sale.discountAmount > 0 ? `<div class="sum-row"><span>${labelDiscount}</span><span>-${formatMoney(sale.discountAmount, store.currency)}</span></div>` : ''}
    ${sale.taxAmount > 0 ? `<div class="sum-row"><span>${labelTax}</span><span>${formatMoney(sale.taxAmount, store.currency)}</span></div>` : ''}
    <div class="divider-double"></div>
    <div class="total-row"><span>${labelTotal}</span><span>${formatMoney(sale.totalAmount, store.currency)}</span></div>
    <div class="divider"></div>
    <div class="sum-row"><span>${labelPaid} (${escapeHtml(sale.paymentMethod.toUpperCase())})</span><span>${formatMoney(sale.amountPaid, store.currency)}</span></div>
    <div class="sum-row"><span>${labelChange}</span><span>${formatMoney(sale.changeDue, store.currency)}</span></div>
    ${footerLines.length > 0 ? `<div class="footer">${footerLines.join('')}</div>` : ''}
  </div>
</body>
</html>`;

  triggerIframePrint(html);
}

export interface LabelPrintEntry {
  product: Product;
  copies: number;
}

export async function printProductQrLabels(
  entries: LabelPrintEntry[],
  store: StoreConfig,
  config: LabelFormatConfig
): Promise<void> {
  const expanded: { product: Product; qrImg: string }[] = [];

  for (const entry of entries) {
    if (entry.copies <= 0) continue;
    const qrImg = await generateQrDataUrl(entry.product.qrCode, 240);
    for (let i = 0; i < entry.copies; i++) {
      expanded.push({ product: entry.product, qrImg });
    }
  }

  if (expanded.length === 0) return;

  // Exact A4 Paper Grid Division Mode (210mm × 297mm -> 200mm × 287mm printable area with 5mm margin)
  if (config.layout === 'a4-divided') {
    const cols = Math.min(10, Math.max(2, Math.round(config.a4Cols || 5)));
    const rows = Math.min(16, Math.max(2, Math.round(config.a4Rows || 8)));
    const perPage = cols * rows;

    const cellW = 200 / cols;
    const cellH = 287 / rows;

    const qrSizeMm = config.qrOnly
      ? Math.max(8, Math.floor(Math.min(cellW - 3.4, cellH - 3.4, 46) * 10) / 10)
      : Math.max(8, Math.floor(Math.min(cellW * 0.44, cellH - 4, 22) * 10) / 10);

    const pages: ({ product: Product; qrImg: string } | null)[][] = [];
    for (let i = 0; i < expanded.length; i += perPage) {
      const slice: ({ product: Product; qrImg: string } | null)[] = expanded.slice(i, i + perPage);
      // Pad final page to preserve exact row/column division geometry & scissor cut lines across A4
      while (slice.length < perPage) {
        slice.push(null);
      }
      pages.push(slice);
    }

    const pagesHtml = pages
      .map((pageCells) => {
        const cellsHtml = pageCells
          .map((item) => {
            if (!item) {
              return `<div class="a4-cell a4-cell-empty"></div>`;
            }
            const { product, qrImg } = item;
            if (config.qrOnly) {
              return `
                <div class="a4-cell a4-cell-qronly">
                  <img class="a4-qr" src="${qrImg}" alt="${escapeHtml(product.qrCode)}" />
                </div>
              `;
            }
            return `
              <div class="a4-cell a4-cell-details">
                ${config.showStoreName ? `<div class="st-store">${escapeHtml(store.storeName)}</div>` : ''}
                <div class="st-body">
                  <img class="a4-qr" src="${qrImg}" alt="${escapeHtml(product.qrCode)}" />
                  <div class="st-info">
                    <div class="st-name">${escapeHtml(product.name)}</div>
                    ${config.showSinhalaName && product.nameSi ? `<div class="st-si">${escapeHtml(product.nameSi)}</div>` : ''}
                    <div class="st-code">${escapeHtml(product.qrCode)}</div>
                    ${config.showSku ? `<div class="st-sku">${escapeHtml(product.sku)}</div>` : ''}
                    ${
                      config.showPrice
                        ? `<div class="st-price">${formatMoney(product.sellingPrice, store.currency)}</div>`
                        : ''
                    }
                  </div>
                </div>
              </div>
            `;
          })
          .join('');

        return `<div class="a4-page">${cellsHtml}</div>`;
      })
      .join('');

    const borderCss = config.showCutLines ? '0.6pt dashed #64748b' : 'none';

    const a4Html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>KadePOS A4 Product QR Sheet</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Noto+Sans+Sinhala:wght@500;700&family=Plus+Jakarta+Sans:wght@600;700&display=swap" rel="stylesheet" />
  <style>
    @page {
      size: A4 portrait;
      margin: 5mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      font-family: 'Plus Jakarta Sans', 'Noto Sans Sinhala', sans-serif;
    }
    .a4-page {
      width: 200mm;
      height: 287mm;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(${cols}, minmax(0, 1fr));
      grid-template-rows: repeat(${rows}, minmax(0, 1fr));
      border-top: ${borderCss};
      border-left: ${borderCss};
      page-break-after: always;
      break-after: page;
    }
    .a4-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .a4-cell {
      border-right: ${borderCss};
      border-bottom: ${borderCss};
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .a4-cell-qronly {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.2mm;
    }
    .a4-cell-details {
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 1.5mm;
      color: #000000;
    }
    .a4-qr {
      width: ${qrSizeMm}mm;
      height: ${qrSizeMm}mm;
      display: block;
      flex-shrink: 0;
      image-rendering: pixelated;
    }
    .st-store {
      font-size: 7px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 0.8mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #000000;
    }
    .st-body {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 1.5mm;
      min-width: 0;
    }
    .st-info {
      min-width: 0;
      flex: 1;
      text-align: left;
      color: #000000;
    }
    .st-name {
      font-size: 8px;
      font-weight: 700;
      line-height: 1.15;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .st-si {
      font-size: 7px;
      line-height: 1.15;
      margin-top: 0.4mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .st-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 6.5px;
      font-weight: 700;
      margin-top: 0.5mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .st-sku {
      font-family: 'JetBrains Mono', monospace;
      font-size: 6px;
    }
    .st-price {
      font-family: 'JetBrains Mono', monospace;
      font-size: 8px;
      font-weight: 700;
      margin-top: 0.5mm;
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;

    triggerIframePrint(a4Html);
    return;
  }

  // 58mm Roll Product QR Printing (Twin or Single)
  const isTwin = config.layout === '58mm-twin';
  const stickersHtml = expanded
    .map(({ product, qrImg }) => {
      if (config.qrOnly) {
        return `
          <div class="sticker sticker-qronly">
            <img class="st-qr" src="${qrImg}" alt="${escapeHtml(product.qrCode)}" />
          </div>
        `;
      }

      return `
        <div class="sticker">
          ${config.showStoreName ? `<div class="st-store">${escapeHtml(store.storeName)}</div>` : ''}
          <div class="st-body">
            <img class="st-qr" src="${qrImg}" alt="${escapeHtml(product.qrCode)}" />
            <div class="st-info">
              <div class="st-name">${escapeHtml(product.name)}</div>
              ${config.showSinhalaName && product.nameSi ? `<div class="st-si">${escapeHtml(product.nameSi)}</div>` : ''}
              <div class="st-code">${escapeHtml(product.qrCode)}</div>
              ${config.showSku ? `<div class="st-sku">${escapeHtml(product.sku)}</div>` : ''}
              ${
                config.showPrice
                  ? `<div class="st-price">${formatMoney(product.sellingPrice, store.currency)}</div>`
                  : ''
              }
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>KadePOS Product QR</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Noto+Sans+Sinhala:wght@500;700&family=Plus+Jakarta+Sans:wght@600;700&display=swap" rel="stylesheet" />
  <style>
    @page {
      size: 58mm auto;
      margin: 1mm;
    }
    * {
      box-sizing: border-box;
      color: #000000 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      font-family: 'Plus Jakarta Sans', 'Noto Sans Sinhala', sans-serif;
    }
    .sheet {
      display: grid;
      grid-template-columns: ${isTwin ? 'repeat(2, 1fr)' : '1fr'};
      gap: 1.5mm;
      width: 48mm;
      margin: 0 auto;
    }
    .sticker {
      border: ${config.showCutLines ? '1px dashed #333' : 'none'};
      border-radius: 2px;
      padding: ${isTwin ? '1.5mm' : '2mm'};
      page-break-inside: avoid;
      break-inside: avoid;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .sticker-qronly {
      align-items: center;
      justify-content: center;
      padding: 2mm;
    }
    .st-store {
      font-size: ${isTwin ? '7px' : '8px'};
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 1mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .st-body {
      display: flex;
      flex-direction: ${isTwin ? 'column' : 'row'};
      align-items: center;
      gap: ${isTwin ? '1mm' : '2mm'};
    }
    .st-qr {
      width: ${config.qrOnly ? (isTwin ? '19mm' : '28mm') : isTwin ? '16mm' : '18mm'};
      height: ${config.qrOnly ? (isTwin ? '19mm' : '28mm') : isTwin ? '16mm' : '18mm'};
      flex-shrink: 0;
      image-rendering: pixelated;
    }
    .st-info {
      min-width: 0;
      width: 100%;
      text-align: ${isTwin ? 'center' : 'left'};
    }
    .st-name {
      font-size: ${isTwin ? '7.5px' : '9px'};
      font-weight: 700;
      line-height: 1.15;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .st-si {
      font-size: ${isTwin ? '7px' : '8px'};
      line-height: 1.15;
      margin-top: 0.5mm;
    }
    .st-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: ${isTwin ? '6.5px' : '7.5px'};
      font-weight: 700;
      margin-top: 0.8mm;
    }
    .st-sku {
      font-family: 'JetBrains Mono', monospace;
      font-size: 6.5px;
    }
    .st-price {
      font-family: 'JetBrains Mono', monospace;
      font-size: ${isTwin ? '8px' : '9.5px'};
      font-weight: 700;
      margin-top: 0.8mm;
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${stickersHtml}
  </div>
</body>
</html>`;

  triggerIframePrint(html);
}
