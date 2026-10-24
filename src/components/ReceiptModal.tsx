import React, { useEffect, useState } from 'react';
import { Printer, RotateCcw, X } from 'lucide-react';
import { getTranslation } from '../i18n/translations';
import {
  Language,
  PaperWidth,
  ReceiptLangMode,
  Sale,
  SaleItem,
  StoreConfig,
  StoreContact,
} from '../types';
import { printThermalReceipt } from '../utils/printEngine';
import { formatDateTime, formatMoney } from '../utils/soundAndFormat';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: Sale | null;
  items: SaleItem[];
  store: StoreConfig;
  contact: StoreContact | null;
  lang: Language;
  isPostCheckout?: boolean;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  sale,
  items,
  store,
  contact,
  lang,
  isPostCheckout = false,
}) => {
  const t = getTranslation(lang);
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(store.paperWidth || '58mm');
  const [langMode, setLangMode] = useState<ReceiptLangMode>('bilingual');

  useEffect(() => {
    setPaperWidth(store.paperWidth || '58mm');
  }, [store.paperWidth, sale?.id]);

  if (!isOpen || !sale) return null;

  const showEn = langMode === 'en' || langMode === 'bilingual';
  const showSi = langMode === 'si' || langMode === 'bilingual';

  const handlePrint = () => {
    printThermalReceipt({
      sale,
      items,
      store,
      contact,
      paperWidth,
      langMode,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden my-auto">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-900">{t.receipt.previewTitle}</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Print Options Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {t.receipt.paperSize}
              </label>
              <select
                value={paperWidth}
                onChange={(e) => setPaperWidth(e.target.value as PaperWidth)}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900"
              >
                <option value="58mm">58mm Thermal Roll</option>
                <option value="80mm">80mm Wide Roll</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {t.receipt.receiptLang}
              </label>
              <select
                value={langMode}
                onChange={(e) => setLangMode(e.target.value as ReceiptLangMode)}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900"
              >
                <option value="bilingual">{t.receipt.langBilingual}</option>
                <option value="en">{t.receipt.langEn}</option>
                <option value="si">{t.receipt.langSi}</option>
              </select>
            </div>
          </div>

          {/* Realistic 58mm Paper Roll Preview (Text-Only Bill — QR is strictly reserved for Product QR) */}
          <div className="bg-slate-100 rounded-xl p-4 flex justify-center">
            <div
              className={`bg-white text-black border border-slate-300 shadow-sm p-4 font-mono text-[11px] leading-snug ${
                paperWidth === '58mm' ? 'w-[248px]' : 'w-[320px]'
              }`}
            >
              <div className="text-center">
                {(showEn || !store.storeNameSi) && (
                  <div className="text-sm font-bold tracking-tight">{store.storeName}</div>
                )}
                {showSi && store.storeNameSi && (
                  <div className="text-xs font-semibold mt-0.5">{store.storeNameSi}</div>
                )}
                {contact?.storeAddress && (
                  <div className="text-[10px] text-slate-700 mt-0.5">{contact.storeAddress}</div>
                )}
                {contact?.storePhone && (
                  <div className="text-[10px] text-slate-700">Tel: {contact.storePhone}</div>
                )}
              </div>

              {sale.status === 'voided' && (
                <div className="my-2 border border-black py-1 text-center font-bold text-xs">
                  {t.receipt.voidBanner}
                </div>
              )}

              <div className="border-t border-dashed border-black my-2" />

              <div className="space-y-0.5 text-[10px]">
                <div className="flex justify-between gap-2">
                  <span>{t.receipt.invoice}:</span>
                  <span className="font-bold">{sale.invoiceNumber}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>{t.receipt.date}:</span>
                  <span>{formatDateTime(sale.createdAt)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>{t.receipt.cashier}:</span>
                  <span>{sale.cashierName}</span>
                </div>
                {sale.customerNote && (
                  <div className="flex justify-between gap-2">
                    <span>{t.receipt.customer}:</span>
                    <span>{sale.customerNote}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-dashed border-black my-2" />

              <div className="space-y-1.5">
                {items.map((item) => (
                  <div key={item.id}>
                    <div className="font-semibold break-words">
                      {langMode === 'si' && item.productNameSi
                        ? item.productNameSi
                        : item.productName}
                    </div>
                    {langMode === 'bilingual' && item.productNameSi && (
                      <div className="text-[10px] text-slate-700">{item.productNameSi}</div>
                    )}
                    <div className="flex justify-between tabular-nums text-[10.5px]">
                      <span>
                        {item.quantity} {item.unit} × {formatMoney(item.unitPrice, store.currency)}
                      </span>
                      <span className="font-bold">
                        {formatMoney(item.lineTotal, store.currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-dashed border-black my-2" />

              <div className="space-y-0.5 tabular-nums">
                <div className="flex justify-between">
                  <span>{t.pos.subtotal}</span>
                  <span>{formatMoney(sale.subtotal, store.currency)}</span>
                </div>
                {sale.discountAmount > 0 && (
                  <div className="flex justify-between">
                    <span>{t.pos.discount}</span>
                    <span>-{formatMoney(sale.discountAmount, store.currency)}</span>
                  </div>
                )}
                {sale.taxAmount > 0 && (
                  <div className="flex justify-between">
                    <span>{t.pos.tax}</span>
                    <span>{formatMoney(sale.taxAmount, store.currency)}</span>
                  </div>
                )}
                <div className="border-t-2 border-black my-1.5" />
                <div className="flex justify-between text-xs font-bold">
                  <span>{t.pos.grandTotal}</span>
                  <span>{formatMoney(sale.totalAmount, store.currency)}</span>
                </div>
                <div className="border-t border-dashed border-black my-1.5" />
                <div className="flex justify-between text-[10px]">
                  <span>
                    {t.receipt.paidVia} ({sale.paymentMethod.toUpperCase()})
                  </span>
                  <span>{formatMoney(sale.amountPaid, store.currency)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>{t.pos.changeDue}</span>
                  <span>{formatMoney(sale.changeDue, store.currency)}</span>
                </div>
              </div>

              <div className="mt-3 text-center text-[10px] space-y-0.5">
                {showEn && store.receiptFooterEn && <div>{store.receiptFooterEn}</div>}
                {showSi && store.receiptFooterSi && <div>{store.receiptFooterSi}</div>}
              </div>
            </div>
          </div>

          {/* Primary Actions */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{t.receipt.printBtn}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              {isPostCheckout && <RotateCcw className="w-4 h-4" />}
              <span>{isPostCheckout ? t.receipt.newSaleBtn : t.receipt.closeBtn}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
