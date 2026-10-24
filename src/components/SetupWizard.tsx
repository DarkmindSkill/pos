import React, { useState } from 'react';
import { User, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Check, Globe, LogOut, Printer, QrCode, ShieldCheck, Store } from 'lucide-react';
import {
  SEED_PRODUCTS,
  auth,
  clampNum,
  clampText,
  db,
  googleProvider,
  handleFirestoreError,
  validateCurrency,
  validateLanguage,
  validatePaperWidth,
} from '../firebase';
import { getTranslation } from '../i18n/translations';
import { CurrencyCode, Language, OperationType, PaperWidth } from '../types';
import { PWAInstallButton } from './PWAWidgets';
import posCounterImg from '../assets/images/pos_retail_counter_1792832088099.jpg';

interface SetupWizardProps {
  user: User | null;
  lang: Language;
  onChangeLang: (lang: Language) => void;
  hasChosenInitialLang: boolean;
  onConfirmInitialLang: () => void;
  onProvisioningChange: (active: boolean) => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  user,
  lang,
  onChangeLang,
  hasChosenInitialLang,
  onConfirmInitialLang,
  onProvisioningChange,
}) => {
  const t = getTranslation(lang);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  // Store configuration form state
  const [storeName, setStoreName] = useState('');
  const [storeNameSi, setStoreNameSi] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('LKR');
  const [taxRate, setTaxRate] = useState('0');
  const [paperWidth, setPaperWidth] = useState<PaperWidth>('58mm');
  const [receiptFooterEn, setReceiptFooterEn] = useState('Thank you! Come again.');
  const [receiptFooterSi, setReceiptFooterSi] = useState('ස්තූතියි! නැවත පැමිණෙන්න.');
  const [seedCatalog, setSeedCatalog] = useState(true);
  const [savingStore, setSavingStore] = useState(false);
  const [formError, setFormError] = useState('');

  // Determine current boot sequence step
  const currentStep: 1 | 2 | 3 = !hasChosenInitialLang ? 1 : !user ? 2 : 3;

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in cancelled or failed.';
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSaveInitialStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const cleanName = clampText(storeName, 1, 80, '');
    if (!cleanName) {
      setFormError(
        lang === 'si'
          ? 'කරුණාකර වෙළඳසැලේ නම ඇතුළත් කරන්න.'
          : 'Please enter your store name in English.'
      );
      return;
    }

    setFormError('');
    setSavingStore(true);
    onProvisioningChange(true);

    const storePath = `stores/${user.uid}`;
    try {
      const storeRef = doc(db, 'stores', user.uid);
      const contactRef = doc(db, 'stores', user.uid, 'private', 'contact');

      // 1. Commit parent Store document first so Master Gate exists on server
      await setDoc(storeRef, {
        ownerId: user.uid,
        storeName: cleanName,
        storeNameSi: clampText(storeNameSi, 0, 80, ''),
        currency: validateCurrency(currency),
        taxRate: clampNum(parseFloat(taxRate) || 0, 0, 100),
        paperWidth: validatePaperWidth(paperWidth),
        language: validateLanguage(lang),
        receiptFooterEn: clampText(receiptFooterEn, 0, 160, ''),
        receiptFooterSi: clampText(receiptFooterSi, 0, 160, ''),
        autoPrint: false,
        showQrOnReceipt: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2. Commit isolated PII contact document
      await setDoc(contactRef, {
        ownerId: user.uid,
        storePhone: clampText(storePhone, 0, 32, ''),
        storeAddress: clampText(storeAddress, 0, 160, ''),
        ownerEmail: clampText(user.email || '', 0, 120, ''),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 3. Seed sample bilingual products in parallel individual writes
      if (seedCatalog) {
        await Promise.all(
          SEED_PRODUCTS.map((seed) => {
            const prodRef = doc(collection(db, 'stores', user.uid, 'products'));
            return setDoc(prodRef, {
              ownerId: user.uid,
              storeId: user.uid,
              name: clampText(seed.name, 1, 100, 'Product'),
              nameSi: clampText(seed.nameSi, 0, 100, ''),
              sku: seed.sku,
              qrCode: seed.qrCode,
              barcode: seed.barcode,
              category: seed.category,
              costPrice: seed.costPrice,
              sellingPrice: seed.sellingPrice,
              stockQty: seed.stockQty,
              minStockLevel: seed.minStockLevel,
              unit: seed.unit,
              isActive: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          })
        );
      }

      onProvisioningChange(false);
    } catch (error) {
      setSavingStore(false);
      onProvisioningChange(false);
      handleFirestoreError(error, OperationType.WRITE, storePath);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Bar Contract: 3 clean zones */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200">
        <div className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          KadePOS
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-500">
          <span className={currentStep === 1 ? 'text-slate-900 font-semibold whitespace-nowrap shrink-0' : 'whitespace-nowrap shrink-0'}>
            01. Language
          </span>
          <span className={currentStep === 2 ? 'text-slate-900 font-semibold whitespace-nowrap shrink-0' : 'whitespace-nowrap shrink-0'}>
            02. Cloud Account
          </span>
          <span className={currentStep === 3 ? 'text-slate-900 font-semibold whitespace-nowrap shrink-0' : 'whitespace-nowrap shrink-0'}>
            03. Store Setup
          </span>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton lang={lang} compact />
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 flex items-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch w-full">
          {/* Left Showcase Column */}
          <div className="lg:col-span-5 rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 text-white flex flex-col justify-between relative min-h-[280px]">
            {!imgFailed ? (
              <img
                src={posCounterImg}
                alt="Modern retail checkout counter with 58mm thermal receipt printer and tablet POS"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-sky-950 flex items-center justify-center">
                <Store className="w-20 h-20 text-sky-400/40" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/55 to-slate-950/20" />

            <div className="relative z-10 p-6 sm:p-8 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-200">
                58mm Thermal · QR Label Sync · Bilingual
              </span>
            </div>

            <div className="relative z-10 p-6 sm:p-8 mt-auto">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-white [text-wrap:balance]">
                {t.tagline}
              </h1>
              <div className="mt-4 pt-4 border-t border-white/15 grid grid-cols-3 gap-3 text-xs text-slate-200">
                <div className="flex items-center gap-1.5">
                  <Printer className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>58mm Print</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <QrCode className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>QR Reprice</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Cloud Sync</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Interactive Boot Sequence Card */}
          <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 flex flex-col justify-center">
            {/* Step 1: Select Language */}
            {currentStep === 1 && (
              <div>
                <div className="text-xs font-medium text-slate-500">
                  Step 01 · Initial Boot Sequence
                </div>
                <h2 className="mt-1 text-2xl font-bold text-slate-900 [text-wrap:balance]">
                  {t.setup.step1Title}
                </h2>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  {t.setup.step1Sub}
                </p>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => onChangeLang('en')}
                    className={`min-h-[84px] p-5 rounded-xl border text-left transition-colors cursor-pointer flex items-center justify-between ${
                      lang === 'en'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="text-base font-semibold">English</div>
                      <div className={`text-xs mt-1 ${lang === 'en' ? 'text-slate-300' : 'text-slate-500'}`}>
                        POS Register, Inventory &amp; Reports
                      </div>
                    </div>
                    {lang === 'en' && <Check className="w-5 h-5 shrink-0" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => onChangeLang('si')}
                    className={`min-h-[84px] p-5 rounded-xl border text-left transition-colors cursor-pointer flex items-center justify-between ${
                      lang === 'si'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="text-base font-semibold">සිංහල</div>
                      <div className={`text-xs mt-1 ${lang === 'si' ? 'text-slate-300' : 'text-slate-500'}`}>
                        බිල්පත්, තොග සහ QR ලේබල් පද්ධතිය
                      </div>
                    </div>
                    {lang === 'si' && <Check className="w-5 h-5 shrink-0" />}
                  </button>
                </div>

                <div className="mt-8 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={onConfirmInitialLang}
                    className="w-full sm:w-auto min-h-[48px] px-6 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors cursor-pointer"
                  >
                    {t.setup.continueBtn}
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Account Creation / Cloud Sign-In */}
            {currentStep === 2 && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    Step 02 · Cloud Account
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeLang(lang === 'en' ? 'si' : 'en')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 min-h-[36px] px-2 cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>{lang === 'en' ? 'සිංහල' : 'English'}</span>
                  </button>
                </div>

                <h2 className="mt-1 text-2xl font-bold text-slate-900 [text-wrap:balance]">
                  {t.setup.step2Title}
                </h2>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  {t.setup.step2Sub}
                </p>

                {authError && (
                  <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-700">
                    {authError}
                  </div>
                )}

                <div className="mt-7 space-y-3">
                  <button
                    type="button"
                    disabled={authLoading}
                    onClick={handleGoogleSignIn}
                    className="w-full min-h-[50px] px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors flex items-center justify-center gap-3 cursor-pointer"
                  >
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#EA4335"
                        d="M12 5c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.09 14.97 0 12 0 7.31 0 3.25 2.69 1.28 6.61l3.67 2.84C5.82 6.86 8.66 5 12 5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.76 2.91c2.2-2.03 3.66-5.02 3.66-8.73z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M4.95 14.45A7.02 7.02 0 014.58 12c0-.85.15-1.68.37-2.45L1.28 6.61A11.96 11.96 0 000 12c0 1.93.46 3.77 1.28 5.39l3.67-2.94z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.76-2.91c-1.08.72-2.45 1.16-4.17 1.16-3.34 0-6.18-1.86-7.05-4.45l-3.67 2.94C3.25 21.31 7.31 24 12 24z"
                      />
                    </svg>
                    <span>{authLoading ? t.setup.signingIn : t.setup.signInGoogle}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Store Configuration */}
            {currentStep === 3 && user && (
              <form onSubmit={handleSaveInitialStore} className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">
                    Step 03 · {user.email}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onChangeLang(lang === 'en' ? 'si' : 'en')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 min-h-[36px] cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>{lang === 'en' ? 'සිංහල' : 'English'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => signOut(auth)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 min-h-[36px] cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{t.settings.signOut}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                    {t.setup.step3Title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">{t.setup.step3Sub}</p>
                </div>

                {formError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t.setup.storeNameEn} *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      placeholder="e.g. Wijaya Super Mart"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t.setup.storeNameSi}
                    </label>
                    <input
                      type="text"
                      maxLength={80}
                      placeholder="උදා: විජය සුපර් මාර්ට්"
                      value={storeNameSi}
                      onChange={(e) => setStoreNameSi(e.target.value)}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t.setup.storePhone}
                    </label>
                    <input
                      type="tel"
                      maxLength={32}
                      placeholder="+94 77 123 4567"
                      value={storePhone}
                      onChange={(e) => setStorePhone(e.target.value)}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t.setup.storeAddress}
                    </label>
                    <input
                      type="text"
                      maxLength={160}
                      placeholder="No. 42, Galle Road, Colombo"
                      value={storeAddress}
                      onChange={(e) => setStoreAddress(e.target.value)}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t.setup.currency}
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                    >
                      <option value="LKR">LKR (Rs.)</option>
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="INR">INR (₹)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t.setup.taxRate}
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t.setup.paperWidth}
                    </label>
                    <select
                      value={paperWidth}
                      onChange={(e) => setPaperWidth(e.target.value as PaperWidth)}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                    >
                      <option value="58mm">{t.setup.paper58}</option>
                      <option value="80mm">{t.setup.paper80}</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t.setup.footerEn}
                    </label>
                    <input
                      type="text"
                      maxLength={160}
                      value={receiptFooterEn}
                      onChange={(e) => setReceiptFooterEn(e.target.value)}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {t.setup.footerSi}
                    </label>
                    <input
                      type="text"
                      maxLength={160}
                      value={receiptFooterSi}
                      onChange={(e) => setReceiptFooterSi(e.target.value)}
                      className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={seedCatalog}
                    onChange={(e) => setSeedCatalog(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900">{t.setup.seedCatalog}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{t.setup.seedCatalogDesc}</div>
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={savingStore}
                  className="w-full min-h-[48px] rounded-xl bg-sky-600 px-6 py-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {savingStore ? t.setup.savingSetup : t.setup.launchPos}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
