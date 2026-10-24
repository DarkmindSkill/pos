import React, { useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { Ban, Printer, ReceiptText, Search, TrendingUp } from 'lucide-react';
import { clampNum, db, handleFirestoreError } from '../firebase';
import { getTranslation } from '../i18n/translations';
import {
  Language,
  OperationType,
  Product,
  Sale,
  SaleItem,
  StoreConfig,
} from '../types';
import { formatDateTime, formatMoney, toJsDate } from '../utils/soundAndFormat';

interface SalesDashboardViewProps {
  storeId: string;
  store: StoreConfig;
  sales: Sale[];
  products: Product[];
  lang: Language;
  onOpenReceiptPreview: (sale: Sale, items: SaleItem[]) => void;
}

type PeriodFilter = 'today' | '7d' | '30d' | 'all';

export const SalesDashboardView: React.FC<SalesDashboardViewProps> = ({
  storeId,
  store,
  sales,
  products,
  lang,
  onOpenReceiptPreview,
}) => {
  const t = getTranslation(lang);

  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [loadingSaleId, setLoadingSaleId] = useState<string | null>(null);
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const periodSales = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const cutoff =
      period === 'today'
        ? startOfToday
        : period === '7d'
        ? startOfToday - 6 * 86400000
        : period === '30d'
        ? startOfToday - 29 * 86400000
        : 0;

    return sales
      .filter((s) => toJsDate(s.createdAt).getTime() >= cutoff)
      .sort((a, b) => toJsDate(b.createdAt).getTime() - toJsDate(a.createdAt).getTime());
  }, [sales, period]);

  const completedSales = useMemo(
    () => periodSales.filter((s) => s.status === 'completed'),
    [periodSales]
  );

  const kpis = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    const byMethod: Record<string, number> = { cash: 0, card: 0, qr: 0, credit: 0 };

    for (const s of completedSales) {
      revenue += s.totalAmount;
      cost += s.costTotal;
      byMethod[s.paymentMethod] = (byMethod[s.paymentMethod] || 0) + s.totalAmount;
    }

    const profit = Math.max(0, revenue - cost);
    const avg = completedSales.length > 0 ? revenue / completedSales.length : 0;

    return {
      revenue,
      profit,
      count: completedSales.length,
      avg,
      byMethod,
    };
  }, [completedSales]);

  // 7-day daily bar chart buckets
  const chartDays = useMemo(() => {
    const days: { key: string; label: string; total: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const label = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
      days.push({ key, label, total: 0 });
    }
    const map = new Map(days.map((d) => [d.key, d]));
    for (const s of sales) {
      if (s.status !== 'completed') continue;
      const dt = toJsDate(s.createdAt);
      const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
      const bucket = map.get(key);
      if (bucket) {
        bucket.total += s.totalAmount;
      }
    }
    return days;
  }, [sales]);

  const maxChartTotal = useMemo(
    () => Math.max(1, ...chartDays.map((d) => d.total)),
    [chartDays]
  );

  const filteredInvoices = useMemo(() => {
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return periodSales;
    return periodSales.filter(
      (s) =>
        s.invoiceNumber.toLowerCase().includes(q) ||
        s.customerNote.toLowerCase().includes(q) ||
        s.cashierName.toLowerCase().includes(q)
    );
  }, [periodSales, invoiceSearch]);

  const fetchSaleItems = async (saleId: string): Promise<SaleItem[]> => {
    const path = `stores/${storeId}/sales/${saleId}/items`;
    try {
      const q = query(
        collection(db, 'stores', storeId, 'sales', saleId, 'items'),
        where('ownerId', '==', storeId)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SaleItem, 'id'>),
      }));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  };

  const handleReprint = async (sale: Sale) => {
    setLoadingSaleId(sale.id);
    try {
      const items = await fetchSaleItems(sale.id);
      onOpenReceiptPreview(sale, items);
    } finally {
      setLoadingSaleId(null);
    }
  };

  const handleVoidAndRestock = async (sale: Sale) => {
    if (sale.status === 'voided') return;
    setVoidingId(sale.id);
    const salePath = `stores/${storeId}/sales/${sale.id}`;
    try {
      const items = await fetchSaleItems(sale.id);
      const batch = writeBatch(db);

      batch.update(doc(db, 'stores', storeId, 'sales', sale.id), {
        status: 'voided',
        updatedAt: serverTimestamp(),
      });

      for (const item of items) {
        const prod = products.find((p) => p.id === item.productId);
        if (prod) {
          batch.update(doc(db, 'stores', storeId, 'products', prod.id), {
            stockQty: clampNum(prod.stockQty + item.quantity, 0, 1000000),
            updatedAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();
      setConfirmVoidId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, salePath);
    } finally {
      setVoidingId(null);
    }
  };

  return (
    <div className="space-y-6 pb-20 lg:pb-8">
      {/* Header & Timeframe Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            {t.dashboard.title}
          </h1>
          <p className="mt-1 text-sm text-slate-600">{t.dashboard.subtitle}</p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl self-start">
          {(
            [
              { id: 'today', label: t.dashboard.today },
              { id: '7d', label: t.dashboard.days7 },
              { id: '30d', label: t.dashboard.days30 },
              { id: 'all', label: t.dashboard.allTime },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setPeriod(opt.id)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                period === opt.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">{t.dashboard.revenue}</div>
          <div className="mt-1 text-xl sm:text-2xl font-mono font-bold tabular-nums text-slate-900 truncate">
            {formatMoney(kpis.revenue, store.currency)}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">
            {t.dashboard.grossProfit}
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-mono font-bold tabular-nums text-emerald-700 truncate">
            {formatMoney(kpis.profit, store.currency)}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">
            {t.dashboard.completedSales}
          </div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900">
            {kpis.count}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">{t.dashboard.avgTicket}</div>
          <div className="mt-1 text-xl sm:text-2xl font-mono font-bold tabular-nums text-slate-900 truncate">
            {formatMoney(kpis.avg, store.currency)}
          </div>
        </div>
      </div>

      {/* 7-Day Revenue SVG Chart + Payment Method Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-sky-600" />
              <span>{t.dashboard.dailyTrend} (7 Days)</span>
            </h2>
          </div>

          <div className="h-48 flex items-end justify-between gap-2 sm:gap-4 pt-6">
            {chartDays.map((day) => {
              const heightPct = Math.max(4, Math.round((day.total / maxChartTotal) * 100));
              return (
                <div
                  key={day.key}
                  className="flex-1 flex flex-col items-center justify-end h-full group"
                >
                  <div className="text-[10px] font-mono tabular-nums text-slate-500 mb-1 truncate max-w-full">
                    {day.total > 0 ? Math.round(day.total).toLocaleString() : '0'}
                  </div>
                  <div className="w-full max-w-[44px] bg-slate-100 rounded-t-lg h-32 flex items-end overflow-hidden">
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t-lg transition-all ${
                        day.total > 0 ? 'bg-sky-600' : 'bg-slate-200'
                      }`}
                    />
                  </div>
                  <div className="mt-2 text-[11px] font-medium text-slate-600 whitespace-nowrap">
                    {day.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-4 rounded-2xl bg-white border border-slate-200 p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 mb-4">
              {t.dashboard.paymentSplit}
            </h2>
            <div className="space-y-3.5">
              {(
                [
                  { key: 'cash', label: t.pos.cash },
                  { key: 'card', label: t.pos.card },
                  { key: 'qr', label: t.pos.qr },
                  { key: 'credit', label: t.pos.credit },
                ] as const
              ).map(({ key, label }) => {
                const amt = kpis.byMethod[key] || 0;
                const pct = kpis.revenue > 0 ? Math.round((amt / kpis.revenue) * 100) : 0;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700">{label}</span>
                      <span className="font-mono tabular-nums text-slate-900 font-semibold">
                        {formatMoney(amt, store.currency)} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        style={{ width: `${pct}%` }}
                        className="h-full bg-slate-900 rounded-full"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Bills & 58mm Reprint Ledger */}
      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">{t.dashboard.recentBills}</h2>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={invoiceSearch}
              onChange={(e) => setInvoiceSearch(e.target.value)}
              placeholder={t.dashboard.searchInvoice}
              className="w-full min-h-[40px] rounded-xl border border-slate-200 pl-9 pr-3 text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
            />
          </div>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-10 text-center">
            <ReceiptText className="w-9 h-9 text-slate-300 mx-auto" />
            <div className="mt-2 text-sm font-semibold text-slate-800">
              {t.dashboard.noSalesYet}
            </div>
            <p className="mt-1 text-xs text-slate-500">{t.dashboard.noSalesSub}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">{t.receipt.invoice}</th>
                  <th className="py-3 px-4">{t.receipt.date}</th>
                  <th className="py-3 px-4">{t.pos.paymentMethod}</th>
                  <th className="py-3 px-4 text-right">{t.pos.grandTotal}</th>
                  <th className="py-3 px-4 text-right">{t.inventory.colActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredInvoices.map((sale) => {
                  const isVoid = sale.status === 'voided';
                  return (
                    <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-mono font-bold text-xs text-slate-900">
                          {sale.invoiceNumber}
                        </div>
                        <div className="text-xs text-slate-500">
                          {sale.itemCount} {t.pos.itemsCount}
                          {sale.customerNote ? ` · ${sale.customerNote}` : ''}
                          {' · '}
                          <span className={isVoid ? 'text-red-600 font-medium' : 'text-emerald-700'}>
                            {isVoid ? t.dashboard.voidedStatus : t.dashboard.completedStatus}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-600">
                        {formatDateTime(sale.createdAt)}
                      </td>

                      <td className="py-3 px-4 text-xs uppercase font-medium text-slate-700">
                        {sale.paymentMethod}
                      </td>

                      <td
                        className={`py-3 px-4 text-right font-mono font-bold tabular-nums ${
                          isVoid ? 'line-through text-slate-400' : 'text-slate-900'
                        }`}
                      >
                        {formatMoney(sale.totalAmount, store.currency)}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={loadingSaleId === sale.id}
                            onClick={() => handleReprint(sale)}
                            className="min-h-[36px] px-3 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5 text-sky-600" />
                            <span>{t.dashboard.reprintBtn}</span>
                          </button>

                          {!isVoid &&
                            (confirmVoidId === sale.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={voidingId === sale.id}
                                  onClick={() => handleVoidAndRestock(sale)}
                                  className="min-h-[36px] px-2.5 rounded-lg bg-red-600 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap cursor-pointer"
                                >
                                  {t.dashboard.confirmVoid}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmVoidId(null)}
                                  className="min-h-[36px] px-2 rounded-lg text-xs text-slate-500 hover:bg-slate-100 cursor-pointer"
                                >
                                  {t.inventory.cancel}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmVoidId(sale.id)}
                                className="min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                <span>{t.dashboard.voidBtn}</span>
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
