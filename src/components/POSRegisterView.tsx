import React, { useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  Banknote,
  Clock,
  CreditCard,
  Minus,
  PauseCircle,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Search,
  ShoppingBag,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import {
  clampNum,
  clampText,
  db,
  handleFirestoreError,
  validatePaymentMethod,
} from '../firebase';
import { getTranslation } from '../i18n/translations';
import {
  CartItem,
  Language,
  OperationType,
  ParkedCart,
  PaymentMethod,
  Product,
  Sale,
  SaleItem,
  StoreConfig,
  StoreContact,
} from '../types';
import { printThermalReceipt } from '../utils/printEngine';
import { formatMoney, generateInvoiceNumber, playScanBeep } from '../utils/soundAndFormat';

interface POSRegisterViewProps {
  user: User;
  store: StoreConfig;
  contact: StoreContact | null;
  products: Product[];
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  lang: Language;
  onOpenScanner: () => void;
  onSaleCompleted: (sale: Sale, items: SaleItem[]) => void;
  onNavigateInventory: () => void;
}

const PARKED_STORAGE_KEY = 'kadepos_parked_bills_v1';

export const POSRegisterView: React.FC<POSRegisterViewProps> = ({
  user,
  store,
  contact,
  products,
  cart,
  setCart,
  lang,
  onOpenScanner,
  onSaleCompleted,
  onNavigateInventory,
}) => {
  const t = getTranslation(lang);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [discountInput, setDiscountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [tenderedInput, setTenderedInput] = useState<string>('');
  const [customerNote, setCustomerNote] = useState<string>('');
  const [processingCheckout, setProcessingCheckout] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [toastText, setToastText] = useState('');

  // Parked / Held Bills in localStorage
  const [parkedBills, setParkedBills] = useState<ParkedCart[]>(() => {
    try {
      const raw = localStorage.getItem(`${PARKED_STORAGE_KEY}_${user.uid}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [showParkedModal, setShowParkedModal] = useState(false);

  const saveParkedBills = (next: ParkedCart[]) => {
    setParkedBills(next);
    try {
      localStorage.setItem(`${PARKED_STORAGE_KEY}_${user.uid}`, JSON.stringify(next));
    } catch {
      // Ignore storage quota
    }
  };

  const showToast = (msg: string) => {
    setToastText(msg);
    setTimeout(() => {
      setToastText((curr) => (curr === msg ? '' : curr));
    }, 2200);
  };

  const activeProducts = useMemo(() => products.filter((p) => p.isActive), [products]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    activeProducts.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [activeProducts]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeProducts.filter((p) => {
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.nameSi.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.qrCode.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
      );
    });
  }, [activeProducts, selectedCategory, searchQuery]);

  const addProductToCart = (product: Product) => {
    if (product.stockQty <= 0) {
      playScanBeep('error');
      showToast(t.pos.outOfStock);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.stockQty) {
          playScanBeep('error');
          showToast(t.pos.insufficientStock);
          return prev;
        }
        return prev.map((c) =>
          c.product.id === product.id ? { ...c, product, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      const exactMatch = activeProducts.find(
        (p) =>
          p.qrCode.toUpperCase() === q ||
          p.sku.toUpperCase() === q ||
          (p.barcode && p.barcode.trim() === searchQuery.trim())
      );
      if (exactMatch) {
        e.preventDefault();
        addProductToCart(exactMatch);
        playScanBeep('success');
        setSearchQuery('');
      }
    }
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.product.id !== productId) return c;
          const latestProd = products.find((p) => p.id === productId) || c.product;
          const nextQty = Math.round((c.quantity + delta) * 100) / 100;
          if (nextQty <= 0) return null;
          if (nextQty > latestProd.stockQty) {
            showToast(t.pos.insufficientStock);
            return { ...c, product: latestProd, quantity: latestProd.stockQty };
          }
          return { ...c, product: latestProd, quantity: nextQty };
        })
        .filter((x): x is CartItem => x !== null && x.quantity > 0)
    );
  };

  const removeCartItem = (productId: string) => {
    setCart((prev) => prev.filter((c) => c.product.id !== productId));
  };

  // Financial Calculations
  const subtotal = useMemo(
    () =>
      Math.round(
        cart.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0) * 100
      ) / 100,
    [cart]
  );

  const costTotal = useMemo(
    () =>
      Math.round(
        cart.reduce((sum, item) => sum + item.product.costPrice * item.quantity, 0) * 100
      ) / 100,
    [cart]
  );

  const discountAmount = useMemo(() => {
    const raw = parseFloat(discountInput) || 0;
    if (raw <= 0) return 0;
    if (discountMode === 'percent') {
      const pct = Math.min(100, Math.max(0, raw));
      return Math.round(((subtotal * pct) / 100) * 100) / 100;
    }
    return Math.min(subtotal, Math.round(raw * 100) / 100);
  }, [discountInput, discountMode, subtotal]);

  const taxableBase = Math.max(0, subtotal - discountAmount);
  const taxAmount = useMemo(
    () => Math.round(((taxableBase * (store.taxRate || 0)) / 100) * 100) / 100,
    [taxableBase, store.taxRate]
  );

  const grandTotal = useMemo(
    () => Math.round((taxableBase + taxAmount) * 100) / 100,
    [taxableBase, taxAmount]
  );

  const parsedTendered = useMemo(() => {
    if (paymentMethod !== 'cash') return grandTotal;
    if (tenderedInput.trim() === '') return grandTotal;
    return Math.max(0, parseFloat(tenderedInput) || 0);
  }, [paymentMethod, tenderedInput, grandTotal]);

  const changeDue = Math.max(0, Math.round((parsedTendered - grandTotal) * 100) / 100);
  const cashShortfall =
    paymentMethod === 'cash' && tenderedInput.trim() !== '' && parsedTendered < grandTotal
      ? Math.round((grandTotal - parsedTendered) * 100) / 100
      : 0;

  const totalUnitsCount = useMemo(
    () => cart.reduce((acc, item) => acc + item.quantity, 0),
    [cart]
  );

  const handleParkBill = () => {
    if (cart.length === 0) return;
    const parked: ParkedCart = {
      id: `PARK-${Date.now()}`,
      label: customerNote.trim() || `Bill #${parkedBills.length + 1}`,
      parkedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      items: cart,
      discountMode,
      discountValue: parseFloat(discountInput) || 0,
      customerNote,
    };
    saveParkedBills([parked, ...parkedBills].slice(0, 15));
    setCart([]);
    setDiscountInput('');
    setCustomerNote('');
    setTenderedInput('');
  };

  const handleResumeParked = (parked: ParkedCart) => {
    setCart(parked.items);
    setDiscountMode(parked.discountMode);
    setDiscountInput(parked.discountValue > 0 ? String(parked.discountValue) : '');
    setCustomerNote(parked.customerNote);
    saveParkedBills(parkedBills.filter((p) => p.id !== parked.id));
    setShowParkedModal(false);
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0 || cashShortfall > 0 || processingCheckout) return;

    setProcessingCheckout(true);
    const saleCol = collection(db, 'stores', user.uid, 'sales');
    const saleRef = doc(saleCol);
    const invoiceNumber = generateInvoiceNumber();
    const cashierName = clampText(user.displayName || user.email || 'Cashier', 1, 60, 'Cashier');
    const cleanCustomerNote = clampText(customerNote, 0, 60, '');
    const nowDate = new Date();

    const salePayload = {
      ownerId: user.uid,
      storeId: user.uid,
      invoiceNumber,
      subtotal: clampNum(subtotal, 0, 1000000000),
      discountAmount: clampNum(discountAmount, 0, 1000000000),
      taxAmount: clampNum(taxAmount, 0, 1000000000),
      totalAmount: clampNum(grandTotal, 0, 1000000000),
      costTotal: clampNum(costTotal, 0, 1000000000),
      amountPaid: clampNum(parsedTendered, 0, 1000000000),
      changeDue: clampNum(changeDue, 0, 1000000000),
      paymentMethod: validatePaymentMethod(paymentMethod),
      itemCount: Math.min(200, Math.max(1, cart.length)),
      customerNote: cleanCustomerNote,
      cashierName,
      status: 'completed' as const,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const localItems: SaleItem[] = [];
    const path = `stores/${user.uid}/sales/${saleRef.id}`;

    try {
      const batch = writeBatch(db);
      batch.set(saleRef, salePayload);

      for (const c of cart.slice(0, 200)) {
        const latestProd = products.find((p) => p.id === c.product.id) || c.product;
        const itemRef = doc(collection(db, 'stores', user.uid, 'sales', saleRef.id, 'items'));
        const lineTotal = clampNum(latestProd.sellingPrice * c.quantity, 0, 1000000000);

        const itemPayload = {
          ownerId: user.uid,
          storeId: user.uid,
          saleId: saleRef.id,
          productId: latestProd.id,
          productName: clampText(latestProd.name, 1, 100, 'Item'),
          productNameSi: clampText(latestProd.nameSi, 0, 100, ''),
          sku: clampText(latestProd.sku, 1, 40, 'SKU'),
          qrCode: clampText(latestProd.qrCode, 6, 64, 'KPOS-000000'),
          quantity: clampNum(c.quantity, 0.01, 100000),
          unitPrice: clampNum(latestProd.sellingPrice, 0, 100000000),
          costPrice: clampNum(latestProd.costPrice, 0, 100000000),
          lineTotal,
          unit: latestProd.unit,
          createdAt: serverTimestamp(),
        };

        batch.set(itemRef, itemPayload);

        const nextStock = clampNum(Math.max(0, latestProd.stockQty - c.quantity), 0, 1000000);
        const prodRef = doc(db, 'stores', user.uid, 'products', latestProd.id);
        batch.update(prodRef, {
          stockQty: nextStock,
          updatedAt: serverTimestamp(),
        });

        localItems.push({
          id: itemRef.id,
          ...itemPayload,
          createdAt: nowDate,
        });
      }

      await batch.commit();
      playScanBeep('success');

      const completedSale: Sale = {
        id: saleRef.id,
        ...salePayload,
        createdAt: nowDate,
        updatedAt: nowDate,
      };

      // Reset cart & checkout controls
      setCart([]);
      setDiscountInput('');
      setTenderedInput('');
      setCustomerNote('');
      setMobileCartOpen(false);

      if (store.autoPrint) {
        printThermalReceipt({
          sale: completedSale,
          items: localItems,
          store,
          contact,
          paperWidth: store.paperWidth || '58mm',
          langMode: 'bilingual',
        });
      }

      onSaleCompleted(completedSale, localItems);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    } finally {
      setProcessingCheckout(false);
    }
  };

  const renderCartPanelContent = () => (
    <div className="flex flex-col h-full">
      {/* Cart Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-slate-200">
        <div className="flex items-center gap-2 min-w-0">
          <Receipt className="w-4 h-4 text-slate-700 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 truncate">{t.pos.cartTitle}</h2>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            ({totalUnitsCount})
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {parkedBills.length > 0 && (
            <button
              type="button"
              onClick={() => setShowParkedModal(true)}
              className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{parkedBills.length}</span>
            </button>
          )}
          {cart.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleParkBill}
                className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                <span>{t.pos.parkBill}</span>
              </button>
              <button
                type="button"
                onClick={() => setCart([])}
                className="min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 cursor-pointer"
              >
                {t.pos.clearCart}
              </button>
            </>
          )}
          {mobileCartOpen && (
            <button
              type="button"
              onClick={() => setMobileCartOpen(false)}
              className="lg:hidden min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Cart Items List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 px-4">
        {cart.length === 0 ? (
          <div className="py-12 text-center">
            <ShoppingBag className="w-9 h-9 text-slate-300 mx-auto" />
            <div className="mt-3 text-sm font-semibold text-slate-700">{t.pos.emptyCart}</div>
            <p className="mt-1 text-xs text-slate-500 max-w-[240px] mx-auto leading-relaxed">
              {t.pos.emptyCartSub}
            </p>
          </div>
        ) : (
          cart.map((item) => {
            const latest = products.find((p) => p.id === item.product.id) || item.product;
            const displayTitle =
              lang === 'si' && latest.nameSi ? latest.nameSi : latest.name;
            const lineAmt = latest.sellingPrice * item.quantity;

            return (
              <div key={latest.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {displayTitle}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                    {formatMoney(latest.sellingPrice, store.currency)} / {latest.unit}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => updateCartQty(latest.id, -1)}
                    className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 cursor-pointer"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-8 text-center text-xs font-mono font-bold tabular-nums text-slate-900">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateCartQty(latest.id, 1)}
                    className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 cursor-pointer"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="text-right shrink-0 min-w-[74px]">
                  <div className="text-xs font-mono font-bold tabular-nums text-slate-900">
                    {formatMoney(lineAmt, store.currency)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCartItem(latest.id)}
                    className="text-[11px] text-slate-400 hover:text-red-600 inline-flex items-center gap-0.5 mt-0.5 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Checkout Controls Footer */}
      <div className="border-t border-slate-200 bg-slate-50 p-4 space-y-3">
        {/* Discount & Customer Note */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex rounded-lg border border-slate-300 bg-white overflow-hidden">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={t.pos.discount}
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              className="w-full min-h-[38px] px-2.5 text-xs font-mono tabular-nums text-slate-900 focus:outline-none"
            />
            <button
              type="button"
              onClick={() =>
                setDiscountMode((m) => (m === 'amount' ? 'percent' : 'amount'))
              }
              className="px-2.5 bg-slate-100 border-l border-slate-300 text-xs font-mono font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
            >
              {discountMode === 'percent' ? '%' : store.currency}
            </button>
          </div>

          <input
            type="text"
            maxLength={60}
            placeholder={t.pos.customerNotePlaceholder}
            value={customerNote}
            onChange={(e) => setCustomerNote(e.target.value)}
            className="w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
          />
        </div>

        {/* Payment Method Segmented Selector */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-200/70 rounded-xl">
          {(
            [
              { id: 'cash', label: t.pos.cash, Icon: Banknote },
              { id: 'card', label: t.pos.card, Icon: CreditCard },
              { id: 'qr', label: t.pos.qr, Icon: QrCode },
              { id: 'credit', label: t.pos.credit, Icon: Wallet },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPaymentMethod(id)}
              className={`min-h-[38px] rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors whitespace-nowrap px-1.5 cursor-pointer ${
                paymentMethod === id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {/* Cash Tendered & Quick Denominations */}
        {paymentMethod === 'cash' && cart.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                {t.pos.amountTendered}
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={grandTotal.toFixed(2)}
                value={tenderedInput}
                onChange={(e) => setTenderedInput(e.target.value)}
                className="w-36 min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-right text-xs font-mono font-bold tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setTenderedInput(String(grandTotal))}
                className="min-h-[32px] px-2.5 rounded-md border border-slate-300 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap cursor-pointer"
              >
                {t.pos.exactAmount}
              </button>
              {[100, 500, 1000, 5000].map((denom) => (
                <button
                  key={denom}
                  type="button"
                  onClick={() =>
                    setTenderedInput(String((parseFloat(tenderedInput) || 0) + denom))
                  }
                  className="min-h-[32px] px-2.5 rounded-md border border-slate-300 bg-white text-[11px] font-mono font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap cursor-pointer"
                >
                  +{denom}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Totals Summary */}
        <div className="space-y-1 pt-1 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>{t.pos.subtotal}</span>
            <span className="font-mono tabular-nums">{formatMoney(subtotal, store.currency)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>{t.pos.discount}</span>
              <span className="font-mono tabular-nums">
                -{formatMoney(discountAmount, store.currency)}
              </span>
            </div>
          )}
          {taxAmount > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>
                {t.pos.tax} ({store.taxRate}%)
              </span>
              <span className="font-mono tabular-nums">
                {formatMoney(taxAmount, store.currency)}
              </span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-1.5 border-t border-slate-200">
            <span className="text-sm font-bold text-slate-900">{t.pos.grandTotal}</span>
            <span className="text-lg font-mono font-bold tabular-nums text-slate-900">
              {formatMoney(grandTotal, store.currency)}
            </span>
          </div>
          {paymentMethod === 'cash' && cart.length > 0 && (
            <div className="flex justify-between text-xs pt-0.5">
              <span className={cashShortfall > 0 ? 'text-red-600 font-medium' : 'text-slate-600'}>
                {cashShortfall > 0 ? t.pos.balanceShort : t.pos.changeDue}
              </span>
              <span
                className={`font-mono font-bold tabular-nums ${
                  cashShortfall > 0 ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {formatMoney(cashShortfall > 0 ? cashShortfall : changeDue, store.currency)}
              </span>
            </div>
          )}
        </div>

        {/* Complete & Print 58mm Bill Button */}
        <button
          type="button"
          disabled={cart.length === 0 || cashShortfall > 0 || processingCheckout}
          onClick={handleCompleteSale}
          className="w-full min-h-[48px] rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <Printer className="w-4 h-4 shrink-0" />
          <span>
            {processingCheckout ? t.pos.processingSale : t.pos.checkoutAndPrint}
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* Left / Main Product Catalog & Scanner Controls */}
      <div className="flex-1 w-full min-w-0 space-y-4 pb-24 lg:pb-6">
        {/* Search + Camera QR/Barcode Trigger */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t.pos.searchPlaceholder}
              className="w-full min-h-[46px] rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={onOpenScanner}
            className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <QrCode className="w-4 h-4 text-sky-400 shrink-0" />
            <span>{t.pos.scanBtn}</span>
          </button>
        </div>

        {/* Toast Alert */}
        {toastText && (
          <div className="rounded-xl bg-slate-900 text-white px-4 py-2.5 text-xs font-medium">
            {toastText}
          </div>
        )}

        {/* Category Filter Tabs */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.pos.allCategories}
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Product Grid */}
        {filteredProducts.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
            <p className="text-sm font-semibold text-slate-800">
              {t.inventory.emptyInventory}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t.inventory.emptyInventorySub}</p>
            <button
              type="button"
              onClick={onNavigateInventory}
              className="mt-4 min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              {t.inventory.addProduct}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredProducts.map((product) => {
              const inCart = cart.find((c) => c.product.id === product.id);
              const isOut = product.stockQty <= 0;
              const isLow = !isOut && product.stockQty <= product.minStockLevel;

              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={isOut}
                  onClick={() => addProductToCart(product)}
                  className={`group relative min-h-[122px] rounded-xl border p-3.5 text-left flex flex-col justify-between transition-colors ${
                    isOut
                      ? 'border-slate-200 bg-slate-100/70 opacity-60 cursor-not-allowed'
                      : inCart
                      ? 'border-sky-600 bg-white cursor-pointer'
                      : 'border-slate-200 bg-white hover:border-slate-400 cursor-pointer'
                  }`}
                >
                  <div>
                    {/* Quiet unboxed metadata line */}
                    <div className="flex items-center justify-between gap-1 text-[11px] text-slate-500 font-mono">
                      <span className="truncate">{product.sku}</span>
                      {inCart && (
                        <span className="font-bold text-sky-700 tabular-nums">
                          ×{inCart.quantity}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">
                      {lang === 'si' && product.nameSi ? product.nameSi : product.name}
                    </div>
                    {lang === 'en' && product.nameSi && (
                      <div className="text-xs text-slate-500 truncate mt-0.5">
                        {product.nameSi}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-mono font-bold tabular-nums text-slate-900">
                      {formatMoney(product.sellingPrice, store.currency)}
                    </span>
                    <span
                      className={`text-[11px] font-medium tabular-nums ${
                        isOut
                          ? 'text-red-600'
                          : isLow
                          ? 'text-amber-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {isOut
                        ? t.pos.outOfStock
                        : `${product.stockQty} ${product.unit}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop Sticky Cart Panel */}
      <aside className="hidden lg:block w-[390px] xl:w-[420px] shrink-0 sticky top-6 rounded-2xl bg-white border border-slate-200 overflow-hidden h-[calc(100vh-7rem)]">
        {renderCartPanelContent()}
      </aside>

      {/* Mobile Floating Bill Summary Bar (above bottom nav) */}
      {cart.length > 0 && !mobileCartOpen && (
        <div className="lg:hidden fixed bottom-16 left-0 right-0 z-30 px-3 pb-2 pointer-events-none">
          <button
            type="button"
            onClick={() => setMobileCartOpen(true)}
            className="pointer-events-auto w-full min-h-[52px] rounded-2xl bg-slate-900 text-white px-4 py-3 shadow-lg flex items-center justify-between gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <ShoppingBag className="w-5 h-5 text-sky-400 shrink-0" />
              <span className="text-sm font-semibold">
                {totalUnitsCount} {t.pos.itemsCount} · {t.pos.viewCart}
              </span>
            </div>
            <span className="text-base font-mono font-bold tabular-nums">
              {formatMoney(grandTotal, store.currency)}
            </span>
          </button>
        </div>
      )}

      {/* Mobile Slide-Up Bottom Sheet Cart */}
      {mobileCartOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex flex-col justify-end">
          <div className="bg-white rounded-t-3xl h-[86vh] flex flex-col overflow-hidden">
            <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-2.5 mb-1 shrink-0" />
            <div className="flex-1 overflow-hidden">{renderCartPanelContent()}</div>
          </div>
        </div>
      )}

      {/* Held / Parked Bills Modal */}
      {showParkedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{t.pos.parkedBills}</h3>
              <button
                type="button"
                onClick={() => setShowParkedModal(false)}
                className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {parkedBills.map((pb) => (
                <div
                  key={pb.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{pb.label}</div>
                    <div className="text-xs text-slate-500">
                      {pb.parkedAt} · {pb.items.length} {t.pos.itemsCount}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleResumeParked(pb)}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                    >
                      {t.pos.resumeBill}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        saveParkedBills(parkedBills.filter((x) => x.id !== pb.id))
                      }
                      className="min-h-[38px] px-2 text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
