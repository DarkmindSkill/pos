import React, { useEffect, useState } from 'react';
import { User, signOut } from 'firebase/auth';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Check, LogOut, Save } from 'lucide-react';
import {
  auth,
  clampNum,
  clampText,
  db,
  handleFirestoreError,
  validateCurrency,
  validateLanguage,
  validatePaperWidth,
} from '../firebase';
import { getTranslation } from '../i18n/translations';
import {
  CurrencyCode,
  Language,
  OperationType,
  PaperWidth,
  StoreConfig,
  StoreContact,
} from '../types';
import { PWAInstallButton } from './PWAWidgets';

interface StoreSettingsViewProps {
  user: User;
  store: StoreConfig;
  contact: StoreContact | null;
  lang: Language;
  onChangeLang: (lang: Language) => void;
}

export const StoreSettingsView: React.FC<StoreSettingsViewProps> = ({
  user,
  store,
  contact,
  lang,
  onChangeLang,
}) => {
  const t = getTranslation(lang);

  const [storeName, setStoreName] = useState(store.storeName);
  const [storeNameSi, setStoreNameSi] = useState(store.storeNameSi);
  const [currency, setCurrency] = useState<CurrencyCode>(store.currency);
  const [taxRate, setTaxRate] = useState(String(store.taxRate));
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(store.paperWidth);
  const [receiptFooterEn, setReceiptFooterEn] = useState(store.receiptFooterEn);
  const [receiptFooterSi, setReceiptFooterSi] = useState(store.receiptFooterSi);
  const [autoPrint, setAutoPrint] = useState(store.autoPrint);

  const [storePhone, setStorePhone] = useState(contact?.storePhone || '');
  const [storeAddress, setStoreAddress] = useState(contact?.storeAddress || '');

  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  useEffect(() => {
    setStoreName(store.storeName);
    setStoreNameSi(store.storeNameSi);
    setCurrency(store.currency);
    setTaxRate(String(store.taxRate));
    setPaperWidth(store.paperWidth);
    setReceiptFooterEn(store.receiptFooterEn);
    setReceiptFooterSi(store.receiptFooterSi);
    setAutoPrint(store.autoPrint);
  }, [store]);

  useEffect(() => {
    if (contact) {
      setStorePhone(contact.storePhone);
      setStoreAddress(contact.storeAddress);
    }
  }, [contact]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = clampText(storeName, 1, 80, store.storeName);
    setSaving(true);
    setSavedBanner(false);

    const storePath = `stores/${user.uid}`;
    try {
      await updateDoc(doc(db, 'stores', user.uid), {
        storeName: cleanName,
        storeNameSi: clampText(storeNameSi, 0, 80, ''),
        currency: validateCurrency(currency),
        taxRate: clampNum(parseFloat(taxRate) || 0, 0, 100),
        paperWidth: validatePaperWidth(paperWidth),
        language: validateLanguage(lang),
        receiptFooterEn: clampText(receiptFooterEn, 0, 160, ''),
        receiptFooterSi: clampText(receiptFooterSi, 0, 160, ''),
        autoPrint,
        showQrOnReceipt: false,
        updatedAt: serverTimestamp(),
      });

      const contactRef = doc(db, 'stores', user.uid, 'private', 'contact');
      if (contact) {
        await updateDoc(contactRef, {
          storePhone: clampText(storePhone, 0, 32, ''),
          storeAddress: clampText(storeAddress, 0, 160, ''),
          ownerEmail: clampText(user.email || '', 0, 120, ''),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(contactRef, {
          ownerId: user.uid,
          storePhone: clampText(storePhone, 0, 32, ''),
          storeAddress: clampText(storeAddress, 0, 160, ''),
          ownerEmail: clampText(user.email || '', 0, 120, ''),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 3000);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, storePath);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6 pb-20 lg:pb-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          {t.settings.title}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t.settings.subtitle}</p>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 space-y-5"
      >
        {savedBanner && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{t.settings.savedSuccess}</span>
          </div>
        )}

        {/* Language Preference */}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Operating Language / භාෂාව
          </label>
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => onChangeLang('en')}
              className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                lang === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => onChangeLang('si')}
              className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                lang === 'si' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              සිංහල
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {t.setup.storeNameEn} *
            </label>
            <input
              type="text"
              required
              maxLength={80}
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
              className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
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
              className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
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

        <div className="space-y-2.5 pt-2 border-t border-slate-100">
          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => setAutoPrint(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-sky-600"
            />
            <span>
              {lang === 'si'
                ? 'ගනුදෙනුව අවසන් වූ වහාම 58mm බිල්පත ස්වයංක්‍රීයව මුද්‍රණය කරන්න'
                : 'Automatically open 58mm thermal print dialog upon checkout'}
            </span>
          </label>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[46px] px-6 py-2.5 rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60 inline-flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? t.inventory.saving : t.settings.saveSettings}</span>
          </button>
        </div>
      </form>

      {/* PWA Installation & Account Card */}
      <div className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              {t.settings.appInstallSection}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{t.settings.appInstallDesc}</div>
          </div>
          <PWAInstallButton lang={lang} />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500">
              {t.settings.accountSection}
            </div>
            <div className="text-sm font-semibold text-slate-900 mt-0.5">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 self-start cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.settings.signOut}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
