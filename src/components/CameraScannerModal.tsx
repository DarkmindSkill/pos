import React, { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Camera, CameraOff, CheckCircle2, QrCode, RefreshCw, Tag, X } from 'lucide-react';
import { clampNum, db, handleFirestoreError } from '../firebase';
import { getTranslation } from '../i18n/translations';
import { CurrencyCode, Language, OperationType, Product, ScannerMode } from '../types';
import { formatMoney, playScanBeep } from '../utils/soundAndFormat';

interface CameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode: ScannerMode;
  allowModeSwitch?: boolean;
  products: Product[];
  storeId: string;
  currency: CurrencyCode;
  lang: Language;
  onAutoAddProduct: (product: Product) => { added: boolean; message: string };
  onCaptureCode?: (code: string) => void;
}

export const CameraScannerModal: React.FC<CameraScannerModalProps> = ({
  isOpen,
  onClose,
  initialMode,
  allowModeSwitch = true,
  products,
  storeId,
  currency,
  lang,
  onAutoAddProduct,
  onCaptureCode,
}) => {
  const t = getTranslation(lang);
  const readerId = `qr-reader-${useId().replace(/:/g, '')}`;

  const [mode, setMode] = useState<ScannerMode>(initialMode);
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Instant Scan-to-Reprice state
  const [repriceTarget, setRepriceTarget] = useState<Product | null>(null);
  const [newSellingPrice, setNewSellingPrice] = useState('');
  const [newCostPrice, setNewCostPrice] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceSavedBanner, setPriceSavedBanner] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ code: string; ts: number }>({ code: '', ts: 0 });
  const handlerRef = useRef<(rawCode: string) => void>(() => {});

  useEffect(() => {
    setMode(initialMode);
    setRepriceTarget(null);
    setFeedbackMsg(null);
    setPriceSavedBanner(false);
  }, [initialMode, isOpen]);

  const resolveProduct = (raw: string): Product | undefined => {
    const clean = raw.trim();
    if (!clean) return undefined;
    const upper = clean.toUpperCase();
    return products.find(
      (p) =>
        p.qrCode.toUpperCase() === upper ||
        (p.barcode && p.barcode.trim() === clean) ||
        p.sku.toUpperCase() === upper
    );
  };

  const processScannedCode = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    if (mode === 'capture' && onCaptureCode) {
      playScanBeep('success');
      onCaptureCode(code);
      onClose();
      return;
    }

    const matched = resolveProduct(code);
    if (!matched) {
      playScanBeep('error');
      setFeedbackMsg({
        type: 'err',
        text: `${t.scanner.notFound} ${code}`,
      });
      return;
    }

    if (mode === 'checkout') {
      const result = onAutoAddProduct(matched);
      if (result.added) {
        playScanBeep('success');
        const label = lang === 'si' && matched.nameSi ? matched.nameSi : matched.name;
        setFeedbackMsg({
          type: 'ok',
          text: `+1 ${label} (${formatMoney(matched.sellingPrice, currency)}) — ${t.pos.addedToast}`,
        });
      } else {
        playScanBeep('error');
        setFeedbackMsg({
          type: 'err',
          text: result.message,
        });
      }
      return;
    }

    if (mode === 'reprice') {
      playScanBeep('reprice');
      setRepriceTarget(matched);
      setNewSellingPrice(String(matched.sellingPrice));
      setNewCostPrice(String(matched.costPrice));
      setPriceSavedBanner(false);
      setFeedbackMsg(null);
    }
  };

  handlerRef.current = processScannedCode;

  const stopScannerSafe = async () => {
    const instance = scannerRef.current;
    scannerRef.current = null;
    if (instance) {
      try {
        if (instance.isScanning) {
          await instance.stop();
        }
        instance.clear();
      } catch {
        // Ignore cleanup race
      }
    }
    setCameraActive(false);
  };

  const startScanner = async (desiredFacing: 'environment' | 'user') => {
    setCameraError('');
    await stopScannerSafe();

    const el = document.getElementById(readerId);
    if (!el) return;

    try {
      const html5Qr = new Html5Qrcode(readerId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
        ],
        verbose: false,
      });
      scannerRef.current = html5Qr;

      await html5Qr.start(
        { facingMode: desiredFacing },
        {
          fps: 12,
          qrbox: { width: 220, height: 180 },
        },
        (decodedText) => {
          const now = Date.now();
          if (
            decodedText === lastScanRef.current.code &&
            now - lastScanRef.current.ts < 1500
          ) {
            return;
          }
          lastScanRef.current = { code: decodedText, ts: now };
          handlerRef.current(decodedText);
        },
        () => {
          // Frame without barcode — ignore
        }
      );
      setCameraActive(true);
    } catch {
      setCameraError(t.scanner.cameraPermissionErr);
      setCameraActive(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopScannerSafe();
      return;
    }
    const timer = setTimeout(() => {
      startScanner(facingMode);
    }, 140);
    return () => {
      clearTimeout(timer);
      stopScannerSafe();
    };
  }, [isOpen, facingMode]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    processScannedCode(manualCode);
    setManualCode('');
  };

  const handleSaveInstantPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repriceTarget) return;
    const parsedSelling = clampNum(parseFloat(newSellingPrice), 0, 100000000);
    const parsedCost = clampNum(parseFloat(newCostPrice), 0, 100000000);

    setSavingPrice(true);
    const path = `stores/${storeId}/products/${repriceTarget.id}`;
    try {
      await updateDoc(doc(db, 'stores', storeId, 'products', repriceTarget.id), {
        sellingPrice: parsedSelling,
        costPrice: parsedCost,
        updatedAt: serverTimestamp(),
      });
      playScanBeep('success');
      setPriceSavedBanner(true);
      setRepriceTarget({
        ...repriceTarget,
        sellingPrice: parsedSelling,
        costPrice: parsedCost,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setSavingPrice(false);
    }
  };

  if (!isOpen) return null;

  const modalTitle =
    mode === 'checkout'
      ? t.scanner.titleCheckout
      : mode === 'reprice'
      ? t.scanner.titleReprice
      : t.scanner.titleCapture;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <QrCode className="w-5 h-5 text-sky-600 shrink-0" />
            <h3 className="text-base font-semibold text-slate-900 truncate">{modalTitle}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Mode Switcher (POS Auto-Cart vs Scan & Reprice) */}
          {allowModeSwitch && mode !== 'capture' && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setMode('checkout');
                  setRepriceTarget(null);
                  setFeedbackMsg(null);
                }}
                className={`flex-1 min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'checkout'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.scanner.modeCheckout}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('reprice');
                  setFeedbackMsg(null);
                }}
                className={`flex-1 min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'reprice'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.scanner.modeReprice}
              </button>
            </div>
          )}

          {/* Camera Viewport */}
          <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-800 relative">
            <div id={readerId} className="w-full min-h-[230px]" />

            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-900 border-t border-slate-800">
              {cameraActive ? (
                <button
                  type="button"
                  onClick={stopScannerSafe}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <CameraOff className="w-3.5 h-3.5" />
                  <span>{t.scanner.stopCamera}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startScanner(facingMode)}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-sky-600 text-xs font-medium text-white hover:bg-sky-700 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{t.scanner.startCamera}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                }
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t.scanner.switchCamera}</span>
              </button>
            </div>
          </div>

          {cameraError && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              {cameraError}
            </div>
          )}

          {/* Live Scan Feedback */}
          {feedbackMsg && (
            <div
              className={`rounded-xl p-3.5 text-xs font-medium flex items-center gap-2 border ${
                feedbackMsg.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{feedbackMsg.text}</span>
            </div>
          )}

          {/* Instant Scan-to-Reprice Card */}
          {mode === 'reprice' && repriceTarget && (
            <form
              onSubmit={handleSaveInstantPrice}
              className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-sky-800 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" />
                    <span>{t.scanner.repriceCardTitle}</span>
                  </div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {repriceTarget.name}
                    {repriceTarget.nameSi ? ` · ${repriceTarget.nameSi}` : ''}
                  </div>
                  <div className="text-xs font-mono text-slate-600 mt-0.5">
                    {repriceTarget.qrCode} · {t.scanner.currentPrice}:{' '}
                    {formatMoney(repriceTarget.sellingPrice, currency)}
                  </div>
                </div>
              </div>

              {priceSavedBanner && (
                <div className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs font-medium">
                  {t.scanner.priceUpdatedSuccess}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.scanner.newSellingPrice} ({currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    autoFocus
                    value={newSellingPrice}
                    onChange={(e) => setNewSellingPrice(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-mono font-bold tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {t.scanner.newCostPrice} ({currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={newCostPrice}
                    onChange={(e) => setNewCostPrice(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={savingPrice}
                  className="flex-1 min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {savingPrice ? t.inventory.saving : t.scanner.updatePriceBtn}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRepriceTarget(null);
                    setPriceSavedBanner(false);
                  }}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {t.scanner.scanAnother}
                </button>
              </div>
            </form>
          )}

          {/* Manual / USB Scanner Input */}
          <form onSubmit={handleManualSubmit} className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-600">
              {t.scanner.manualInputLabel}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder={t.scanner.manualPlaceholder}
                className="flex-1 min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono text-slate-900 focus:border-sky-600 focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-[44px] px-4 py-2 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t.scanner.lookupBtn}
              </button>
            </div>
          </form>

          {/* Quick Simulate Labels for Testing without Camera */}
          {mode !== 'capture' && products.length > 0 && (
            <div className="pt-2 border-t border-slate-200">
              <div className="text-xs font-medium text-slate-500 mb-2">
                {t.scanner.simulateTitle}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                {products.slice(0, 8).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => processScannedCode(p.qrCode)}
                    className="min-h-[44px] flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">{p.name}</div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">{p.qrCode}</div>
                    </div>
                    <span className="text-xs font-mono font-semibold tabular-nums text-slate-800 shrink-0">
                      {formatMoney(p.sellingPrice, currency)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
