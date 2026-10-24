/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  BarChart3,
  Boxes,
  Globe,
  QrCode,
  ScanLine,
  Settings,
  ShoppingCart,
} from 'lucide-react';
import { CameraScannerModal } from './components/CameraScannerModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InventoryView } from './components/InventoryView';
import { POSRegisterView } from './components/POSRegisterView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAWidgets';
import { QRLabelsView } from './components/QRLabelsView';
import { ReceiptModal } from './components/ReceiptModal';
import { SalesDashboardView } from './components/SalesDashboardView';
import { SetupWizard } from './components/SetupWizard';
import { StoreSettingsView } from './components/StoreSettingsView';
import { auth, db, handleFirestoreError, validateLanguage } from './firebase';
import { getTranslation } from './i18n/translations';
import {
  AppTab,
  CartItem,
  Language,
  OperationType,
  Product,
  Sale,
  SaleItem,
  ScannerMode,
  StoreConfig,
  StoreContact,
} from './types';
import { playScanBeep, useHardwareScanner } from './utils/soundAndFormat';

const LANG_STORAGE_KEY = 'kadepos_lang_pref';
const INITIAL_BOOT_LANG_CONFIRMED_KEY = 'kadepos_boot_lang_confirmed';

function KadePOSWorkspace() {
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return saved === 'si' ? 'si' : 'en';
  });

  const [hasChosenInitialLang, setHasChosenInitialLang] = useState<boolean>(() => {
    return localStorage.getItem(INITIAL_BOOT_LANG_CONFIRMED_KEY) === 'true';
  });

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [storeLoading, setStoreLoading] = useState(true);
  const [isProvisioningStore, setIsProvisioningStore] = useState(false);
  const [storeConfig, setStoreConfig] = useState<StoreConfig | null>(null);
  const [storeContact, setStoreContact] = useState<StoreContact | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);

  const [activeTab, setActiveTab] = useState<AppTab>('pos');
  const [cart, setCart] = useState<CartItem[]>([]);

  // Scanner modal state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<ScannerMode>('checkout');
  const [scannerAllowSwitch, setScannerAllowSwitch] = useState(true);
  const [barcodeCaptureCb, setBarcodeCaptureCb] = useState<((code: string) => void) | undefined>(
    undefined
  );

  // 58mm Receipt modal state
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [activeReceiptSale, setActiveReceiptSale] = useState<Sale | null>(null);
  const [activeReceiptItems, setActiveReceiptItems] = useState<SaleItem[]>([]);
  const [isPostCheckoutReceipt, setIsPostCheckoutReceipt] = useState(false);

  const t = getTranslation(lang);

  const handleChangeLang = useCallback(
    async (nextLang: Language) => {
      setLang(nextLang);
      localStorage.setItem(LANG_STORAGE_KEY, nextLang);
      if (user && storeConfig) {
        const path = `stores/${user.uid}`;
        try {
          await updateDoc(doc(db, 'stores', user.uid), {
            language: validateLanguage(nextLang),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      }
    },
    [user, storeConfig]
  );

  const handleConfirmInitialLang = () => {
    localStorage.setItem(INITIAL_BOOT_LANG_CONFIRMED_KEY, 'true');
    setHasChosenInitialLang(true);
  };

  // Track Firebase Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (!currentUser) {
        setStoreConfig(null);
        setStoreContact(null);
        setProducts([]);
        setSales([]);
        setStoreLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // Real-time Firestore Cloud Sync (only when Auth is ready & user signed in)
  useEffect(() => {
    if (!authReady || !user) return;

    setStoreLoading(true);
    const storePath = `stores/${user.uid}`;
    const unsubStore = onSnapshot(
      doc(db, 'stores', user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as StoreConfig;
          setStoreConfig(data);
          if (data.language && (data.language === 'en' || data.language === 'si')) {
            setLang(data.language);
            localStorage.setItem(LANG_STORAGE_KEY, data.language);
          }
          localStorage.setItem(INITIAL_BOOT_LANG_CONFIRMED_KEY, 'true');
          setHasChosenInitialLang(true);
        } else {
          setStoreConfig(null);
        }
        setStoreLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, storePath);
      }
    );

    return () => unsubStore();
  }, [authReady, user]);

  // Attach subcollection listeners once StoreConfig exists and initial provisioning has finished
  useEffect(() => {
    if (!authReady || !user || !storeConfig || isProvisioningStore) return;

    const contactPath = `stores/${user.uid}/private/contact`;
    const unsubContact = onSnapshot(
      doc(db, 'stores', user.uid, 'private', 'contact'),
      (snap) => {
        setStoreContact(snap.exists() ? (snap.data() as StoreContact) : null);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, contactPath);
      }
    );

    const productsPath = `stores/${user.uid}/products`;
    const productsQuery = query(
      collection(db, 'stores', user.uid, 'products'),
      where('ownerId', '==', user.uid)
    );
    const unsubProducts = onSnapshot(
      productsQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Product, 'id'>),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setProducts(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, productsPath);
      }
    );

    const salesPath = `stores/${user.uid}/sales`;
    const salesQuery = query(
      collection(db, 'stores', user.uid, 'sales'),
      where('ownerId', '==', user.uid)
    );
    const unsubSales = onSnapshot(
      salesQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Sale, 'id'>),
        }));
        setSales(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, salesPath);
      }
    );

    return () => {
      unsubContact();
      unsubProducts();
      unsubSales();
    };
  }, [authReady, user, storeConfig?.ownerId, isProvisioningStore]);

  const handleAutoAddFromScan = useCallback(
    (product: Product): { added: boolean; message: string } => {
      if (product.stockQty <= 0) {
        return { added: false, message: t.pos.outOfStock };
      }
      let exceeded = false;
      setCart((prev) => {
        const existing = prev.find((c) => c.product.id === product.id);
        if (existing) {
          if (existing.quantity + 1 > product.stockQty) {
            exceeded = true;
            return prev;
          }
          return prev.map((c) =>
            c.product.id === product.id ? { ...c, product, quantity: c.quantity + 1 } : c
          );
        }
        return [...prev, { product, quantity: 1 }];
      });
      if (exceeded) {
        return { added: false, message: t.pos.insufficientStock };
      }
      return { added: true, message: t.pos.addedToast };
    },
    [t.pos.addedToast, t.pos.insufficientStock, t.pos.outOfStock]
  );

  // Global USB / Bluetooth Hardware Scanner Listener
  useHardwareScanner(
    (scannedCode) => {
      if (!storeConfig || scannerOpen) return;
      const upper = scannedCode.trim().toUpperCase();
      const matched = products.find(
        (p) =>
          p.qrCode.toUpperCase() === upper ||
          p.sku.toUpperCase() === upper ||
          (p.barcode && p.barcode.trim() === scannedCode.trim())
      );

      if (!matched) {
        playScanBeep('error');
        return;
      }

      if (activeTab === 'pos') {
        const res = handleAutoAddFromScan(matched);
        playScanBeep(res.added ? 'success' : 'error');
      } else {
        setScannerMode('reprice');
        setScannerAllowSwitch(true);
        setScannerOpen(true);
      }
    },
    Boolean(user && storeConfig && !scannerOpen)
  );

  const openScannerInMode = (mode: ScannerMode, allowSwitch = true) => {
    setBarcodeCaptureCb(undefined);
    setScannerMode(mode);
    setScannerAllowSwitch(allowSwitch);
    setScannerOpen(true);
  };

  const openBarcodeCapture = (cb: (code: string) => void) => {
    setBarcodeCaptureCb(() => cb);
    setScannerMode('capture');
    setScannerAllowSwitch(false);
    setScannerOpen(true);
  };

  // Boot Loading Skeleton
  if (!authReady || (user && storeLoading)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3 text-center">
          <div className="text-lg font-bold tracking-tight text-slate-900">KadePOS</div>
          <div className="h-2 w-40 mx-auto rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full w-1/2 bg-sky-600 rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // Initial Boot Sequence / Account Creation / Store Setup
  if (!hasChosenInitialLang || !user || !storeConfig || isProvisioningStore) {
    return (
      <>
        <OfflineIndicator lang={lang} />
        <SetupWizard
          user={user}
          lang={lang}
          onChangeLang={handleChangeLang}
          hasChosenInitialLang={hasChosenInitialLang}
          onConfirmInitialLang={handleConfirmInitialLang}
          onProvisioningChange={setIsProvisioningStore}
        />
      </>
    );
  }

  const navItems: { id: AppTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'pos', label: t.nav.pos, Icon: ShoppingCart },
    { id: 'inventory', label: t.nav.inventory, Icon: Boxes },
    { id: 'labels', label: t.nav.labels, Icon: QrCode },
    { id: 'dashboard', label: t.nav.dashboard, Icon: BarChart3 },
    { id: 'settings', label: t.nav.settings, Icon: Settings },
  ];

  const displayStoreName =
    lang === 'si' && storeConfig.storeNameSi
      ? storeConfig.storeNameSi
      : storeConfig.storeName;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <OfflineIndicator lang={lang} />

      {/* Desktop Left Sidebar Navigation (248px) */}
      <aside className="hidden lg:flex lg:flex-col w-[248px] shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen">
        <div className="px-6 py-5 border-b border-slate-200">
          <div className="text-lg font-bold tracking-tight text-slate-900">KadePOS</div>
          <div className="text-xs text-slate-500 truncate mt-0.5">{displayStoreName}</div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-2.5">
          <button
            type="button"
            onClick={() => openScannerInMode('reprice', true)}
            className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 flex items-center justify-center gap-2 cursor-pointer"
          >
            <ScanLine className="w-4 h-4 text-sky-600 shrink-0" />
            <span className="truncate">{t.scanner.modeReprice}</span>
          </button>

          <PWAInstallButton lang={lang} compact />
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Compact Top Workspace Header */}
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lg:hidden text-base font-bold tracking-tight text-slate-900 shrink-0">
              KadePOS
            </span>
            <span className="lg:hidden text-slate-300" aria-hidden="true">
              /
            </span>
            <span className="text-sm font-semibold text-slate-700 truncate">
              {displayStoreName}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleChangeLang(lang === 'en' ? 'si' : 'en')}
              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>{lang === 'en' ? 'සිංහල' : 'EN'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                openScannerInMode(activeTab === 'pos' ? 'checkout' : 'reprice', true)
              }
              className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <ScanLine className="w-3.5 h-3.5 text-sky-400" />
              <span>{t.nav.scan}</span>
            </button>
          </div>
        </header>

        {/* Active Viewport */}
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5">
          {activeTab === 'pos' && (
            <POSRegisterView
              user={user}
              store={storeConfig}
              contact={storeContact}
              products={products}
              cart={cart}
              setCart={setCart}
              lang={lang}
              onOpenScanner={() => openScannerInMode('checkout', true)}
              onSaleCompleted={(sale, items) => {
                setActiveReceiptSale(sale);
                setActiveReceiptItems(items);
                setIsPostCheckoutReceipt(true);
                setReceiptModalOpen(true);
              }}
              onNavigateInventory={() => setActiveTab('inventory')}
            />
          )}

          {activeTab === 'inventory' && (
            <InventoryView
              storeId={user.uid}
              store={storeConfig}
              products={products}
              lang={lang}
              onOpenRepriceScanner={() => openScannerInMode('reprice', true)}
              onOpenBarcodeCapture={openBarcodeCapture}
            />
          )}

          {activeTab === 'labels' && (
            <QRLabelsView
              store={storeConfig}
              products={products}
              lang={lang}
              onOpenRepriceScanner={() => openScannerInMode('reprice', true)}
            />
          )}

          {activeTab === 'dashboard' && (
            <SalesDashboardView
              storeId={user.uid}
              store={storeConfig}
              sales={sales}
              products={products}
              lang={lang}
              onOpenReceiptPreview={(sale, items) => {
                setActiveReceiptSale(sale);
                setActiveReceiptItems(items);
                setIsPostCheckoutReceipt(false);
                setReceiptModalOpen(true);
              }}
            />
          )}

          {activeTab === 'settings' && (
            <StoreSettingsView
              user={user}
              store={storeConfig}
              contact={storeContact}
              lang={lang}
              onChangeLang={handleChangeLang}
            />
          )}
        </main>
      </div>

      {/* Mobile Ergonomic Bottom Tab Bar (Thumb Zone) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5 items-center h-16 pb-safe">
        {navItems.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`min-h-[48px] flex flex-col items-center justify-center px-1 cursor-pointer ${
                active ? 'text-sky-600' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold tracking-tight mt-0.5 truncate max-w-full">
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Camera QR & Barcode Scanner Modal (POS Auto-Cart + Instant Scan-to-Reprice + Barcode Capture) */}
      <CameraScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        initialMode={scannerMode}
        allowModeSwitch={scannerAllowSwitch}
        products={products}
        storeId={user.uid}
        currency={storeConfig.currency}
        lang={lang}
        onAutoAddProduct={handleAutoAddFromScan}
        onCaptureCode={barcodeCaptureCb}
      />

      {/* 58mm / 80mm Thermal Receipt Preview & Print Modal */}
      <ReceiptModal
        isOpen={receiptModalOpen}
        onClose={() => setReceiptModalOpen(false)}
        sale={activeReceiptSale}
        items={activeReceiptItems}
        store={storeConfig}
        contact={storeContact}
        lang={lang}
        isPostCheckout={isPostCheckoutReceipt}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <KadePOSWorkspace />
    </ErrorBoundary>
  );
}
