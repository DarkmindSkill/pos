import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Camera,
  Edit3,
  PackagePlus,
  Plus,
  Printer,
  QrCode,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  clampNum,
  clampText,
  db,
  handleFirestoreError,
  sanitizeIdToken,
  validateUnit,
} from '../firebase';
import { getTranslation } from '../i18n/translations';
import {
  Language,
  OperationType,
  Product,
  ProductUnit,
  StoreConfig,
} from '../types';
import { printProductQrLabels } from '../utils/printEngine';
import {
  formatMoney,
  generateQrDataUrl,
  generateSku,
  generateUniqueQrCode,
} from '../utils/soundAndFormat';

interface InventoryViewProps {
  storeId: string;
  store: StoreConfig;
  products: Product[];
  lang: Language;
  onOpenRepriceScanner: () => void;
  onOpenBarcodeCapture: (callback: (code: string) => void) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  storeId,
  store,
  products,
  lang,
  onOpenRepriceScanner,
  onOpenBarcodeCapture,
}) => {
  const t = getTranslation(lang);

  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add / Edit Product Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [nameEn, setNameEn] = useState('');
  const [nameSi, setNameSi] = useState('');
  const [category, setCategory] = useState('General');
  const [unit, setUnit] = useState<ProductUnit>('pcs');
  const [sku, setSku] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [costPrice, setCostPrice] = useState('0');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [stockQty, setStockQty] = useState('20');
  const [minStockLevel, setMinStockLevel] = useState('5');
  const [modalQrImg, setModalQrImg] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);

  useEffect(() => {
    if (!modalOpen || !qrCode) {
      setModalQrImg('');
      return;
    }
    generateQrDataUrl(qrCode, 128).then(setModalQrImg);
  }, [modalOpen, qrCode]);

  const openAddModal = () => {
    setEditingProduct(null);
    setNameEn('');
    setNameSi('');
    setCategory('Groceries');
    setUnit('pcs');
    setSku(generateSku());
    setQrCode(generateUniqueQrCode());
    setBarcode('');
    setCostPrice('');
    setSellingPrice('');
    setStockQty('25');
    setMinStockLevel('5');
    setModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setNameEn(p.name);
    setNameSi(p.nameSi);
    setCategory(p.category);
    setUnit(p.unit);
    setSku(p.sku);
    setQrCode(p.qrCode);
    setBarcode(p.barcode);
    setCostPrice(String(p.costPrice));
    setSellingPrice(String(p.sellingPrice));
    setStockQty(String(p.stockQty));
    setMinStockLevel(String(p.minStockLevel));
    setModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = clampText(nameEn, 1, 100, '');
    if (!cleanName) return;

    setSavingProduct(true);
    const cleanSku = sanitizeIdToken(sku || generateSku(), 'SKU', 40);
    const cleanCategory = clampText(category, 1, 50, 'General');
    const cleanCost = clampNum(parseFloat(costPrice) || 0, 0, 100000000);
    const cleanSell = clampNum(parseFloat(sellingPrice) || 0, 0, 100000000);
    const cleanStock = clampNum(parseFloat(stockQty) || 0, 0, 1000000);
    const cleanMin = clampNum(parseFloat(minStockLevel) || 0, 0, 1000000);

    try {
      if (editingProduct) {
        const path = `stores/${storeId}/products/${editingProduct.id}`;
        try {
          await updateDoc(doc(db, 'stores', storeId, 'products', editingProduct.id), {
            name: cleanName,
            nameSi: clampText(nameSi, 0, 100, ''),
            sku: cleanSku,
            barcode: clampText(barcode, 0, 64, ''),
            category: cleanCategory,
            costPrice: cleanCost,
            sellingPrice: cleanSell,
            stockQty: cleanStock,
            minStockLevel: cleanMin,
            unit: validateUnit(unit),
            isActive: true,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        const colRef = collection(db, 'stores', storeId, 'products');
        const newRef = doc(colRef);
        const path = `stores/${storeId}/products/${newRef.id}`;
        const immutableQr = sanitizeIdToken(qrCode || generateUniqueQrCode(), 'KPOS', 64);
        try {
          await setDoc(newRef, {
            ownerId: storeId,
            storeId,
            name: cleanName,
            nameSi: clampText(nameSi, 0, 100, ''),
            sku: cleanSku,
            qrCode: immutableQr.length >= 6 ? immutableQr : generateUniqueQrCode(),
            barcode: clampText(barcode, 0, 64, ''),
            category: cleanCategory,
            costPrice: cleanCost,
            sellingPrice: cleanSell,
            stockQty: cleanStock,
            minStockLevel: cleanMin,
            unit: validateUnit(unit),
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }
      setModalOpen(false);
    } finally {
      setSavingProduct(false);
    }
  };

  const handleQuickRestock = async (p: Product, delta = 10) => {
    const path = `stores/${storeId}/products/${p.id}`;
    try {
      await updateDoc(doc(db, 'stores', storeId, 'products', p.id), {
        stockQty: clampNum(p.stockQty + delta, 0, 1000000),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    const path = `stores/${storeId}/products/${productId}`;
    try {
      await deleteDoc(doc(db, 'stores', storeId, 'products', productId));
      setConfirmDeleteId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const handlePrintSingleQr = (p: Product) => {
    printProductQrLabels([{ product: p, copies: 40 }], store, {
      layout: 'a4-divided',
      a4Cols: 5,
      a4Rows: 8,
      qrOnly: true,
      showCutLines: true,
      showStoreName: false,
      showSinhalaName: false,
      showPrice: false,
      showSku: false,
    });
  };

  // Metrics
  const stats = useMemo(() => {
    let retailVal = 0;
    let costVal = 0;
    let alertsCount = 0;
    for (const p of products) {
      retailVal += p.sellingPrice * p.stockQty;
      costVal += p.costPrice * p.stockQty;
      if (p.stockQty <= p.minStockLevel) alertsCount += 1;
    }
    return { retailVal, costVal, alertsCount };
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (stockFilter === 'out' && p.stockQty > 0) return false;
      if (stockFilter === 'low' && (p.stockQty <= 0 || p.stockQty > p.minStockLevel)) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.nameSi.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.qrCode.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, search, stockFilter]);

  return (
    <div className="space-y-6 pb-20 lg:pb-8">
      {/* Header + Primary Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            {t.inventory.title}
          </h1>
          <p className="mt-1 text-sm text-slate-600">{t.inventory.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenRepriceScanner}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 hover:bg-slate-50 inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Tag className="w-4 h-4 text-sky-600 shrink-0" />
            <span>{t.inventory.scanToReprice}</span>
          </button>

          <button
            type="button"
            onClick={openAddModal}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>{t.inventory.addProduct}</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">{t.inventory.totalSkus}</div>
          <div className="mt-1 text-2xl font-mono font-bold tabular-nums text-slate-900">
            {products.length}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">
            {t.inventory.retailValuation}
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-mono font-bold tabular-nums text-slate-900 truncate">
            {formatMoney(stats.retailVal, store.currency)}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">
            {t.inventory.costValuation}
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-mono font-bold tabular-nums text-slate-900 truncate">
            {formatMoney(stats.costVal, store.currency)}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500">
            {t.inventory.lowStockAlerts}
          </div>
          <div
            className={`mt-1 text-2xl font-mono font-bold tabular-nums flex items-center gap-2 ${
              stats.alertsCount > 0 ? 'text-amber-700' : 'text-slate-900'
            }`}
          >
            <span>{stats.alertsCount}</span>
            {stats.alertsCount > 0 && <AlertTriangle className="w-5 h-5 text-amber-600" />}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.pos.searchPlaceholder}
            className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl shrink-0">
          {(
            [
              { id: 'all', label: t.inventory.filterAll },
              { id: 'low', label: t.inventory.filterLow },
              { id: 'out', label: t.inventory.filterOut },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStockFilter(f.id)}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                stockFilter === f.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Table (Desktop) & Cards (Mobile) */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
          <PackagePlus className="w-10 h-10 text-slate-300 mx-auto" />
          <div className="mt-3 text-sm font-semibold text-slate-900">
            {t.inventory.emptyInventory}
          </div>
          <p className="mt-1 text-xs text-slate-500">{t.inventory.emptyInventorySub}</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">{t.inventory.colProduct}</th>
                  <th className="py-3 px-4">{t.inventory.colCodes}</th>
                  <th className="py-3 px-4 text-right">{t.inventory.colStock}</th>
                  <th className="py-3 px-4 text-right">{t.inventory.colCost}</th>
                  <th className="py-3 px-4 text-right">{t.inventory.colPrice}</th>
                  <th className="py-3 px-4 text-right">{t.inventory.colMargin}</th>
                  <th className="py-3 px-4 text-right">{t.inventory.colActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((p) => {
                  const isOut = p.stockQty <= 0;
                  const isLow = !isOut && p.stockQty <= p.minStockLevel;
                  const marginPct =
                    p.sellingPrice > 0
                      ? Math.round(((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100)
                      : 0;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{p.name}</div>
                        <div className="text-xs text-slate-500">
                          {p.nameSi ? `${p.nameSi} · ` : ''}
                          {p.category} · {p.sku}
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono text-xs">
                        <div className="font-semibold text-slate-800">{p.qrCode}</div>
                        {p.barcode && (
                          <div className="text-[11px] text-slate-500">EAN: {p.barcode}</div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        <div
                          className={`font-bold ${
                            isOut
                              ? 'text-red-600'
                              : isLow
                              ? 'text-amber-700'
                              : 'text-slate-900'
                          }`}
                        >
                          {p.stockQty} {p.unit}
                        </div>
                        <div className="text-[11px] font-sans text-slate-500">
                          {isOut
                            ? t.pos.outOfStock
                            : isLow
                            ? t.pos.lowStock
                            : t.pos.inStock}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                        {formatMoney(p.costPrice, store.currency)}
                      </td>

                      <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-slate-900">
                        {formatMoney(p.sellingPrice, store.currency)}
                      </td>

                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-emerald-700">
                        {marginPct}%
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleQuickRestock(p, 10)}
                            className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap cursor-pointer"
                          >
                            {t.inventory.restock}
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePrintSingleQr(p)}
                            title={t.inventory.printQr}
                            className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span className="hidden xl:inline">{t.inventory.printQr}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                            aria-label={t.inventory.edit}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {confirmDeleteId === p.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(p.id)}
                                className="min-h-[36px] px-2.5 rounded-lg bg-red-600 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer"
                              >
                                {t.inventory.confirmDelete}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="min-h-[36px] px-2 rounded-lg text-xs text-slate-500 hover:bg-slate-100 cursor-pointer"
                              >
                                {t.inventory.cancel}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(p.id)}
                              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                              aria-label={t.inventory.delete}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                {editingProduct ? t.inventory.modalEditTitle : t.inventory.modalAddTitle}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSaveProduct}
              className="p-5 space-y-4 max-h-[82vh] overflow-y-auto"
            >
              {/* Auto-generated Immutable QR Code Preview */}
              <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                {modalQrImg ? (
                  <img
                    src={modalQrImg}
                    alt={qrCode}
                    referrerPolicy="no-referrer"
                    className="w-16 h-16 rounded-lg border border-slate-200 bg-white p-1 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <QrCode className="w-7 h-7 text-slate-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-500">
                    {t.inventory.fieldQr}
                  </div>
                  <div className="text-sm font-mono font-bold text-slate-900 mt-0.5">
                    {qrCode}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.inventory.fieldNameEn} *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.inventory.fieldNameSi}
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={nameSi}
                    onChange={(e) => setNameSi(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.inventory.fieldCategory}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={50}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.inventory.fieldUnit}
                  </label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as ProductUnit)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="pcs">pcs</option>
                    <option value="pack">pack</option>
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                    <option value="box">box</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.inventory.fieldSku}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t.inventory.fieldBarcode}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={64}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="4792010001015"
                    className="flex-1 min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onOpenBarcodeCapture((captured) => setBarcode(captured))}
                    className="min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>{t.inventory.scanBarcodeBtn}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.inventory.fieldCost}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.inventory.fieldSelling} *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono font-bold tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.inventory.fieldStock}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={stockQty}
                    onChange={(e) => setStockQty(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.inventory.fieldMinStock}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={minStockLevel}
                    onChange={(e) => setMinStockLevel(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {t.inventory.cancel}
                </button>
                <button
                  type="submit"
                  disabled={savingProduct}
                  className="min-h-[44px] px-6 py-2 rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60 cursor-pointer"
                >
                  {savingProduct ? t.inventory.saving : t.inventory.saveProduct}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
