import React, { useState } from 'react';
import { Download, WifiOff } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { Language } from '../types';
import { getTranslation } from '../i18n/translations';

interface PWAInstallButtonProps {
  lang: Language;
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ lang, compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const t = getTranslation(lang);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'min-h-[38px] px-3 py-1.5 text-xs' : 'min-h-[44px] px-4 py-2 text-sm'
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>{t.pwa.installApp}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            compact ? 'min-h-[38px] px-3 py-1.5 text-xs' : 'min-h-[44px] px-4 py-2 text-sm'
          }`}
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>{t.pwa.installIOS}</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 border border-slate-200 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-900">{t.pwa.iosGuideTitle}</h3>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>{t.pwa.iosStep1}</p>
                <p>{t.pwa.iosStep2}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {t.pwa.close}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC<{ lang: Language }> = ({ lang }) => {
  const isOnline = useOnlineStatus();
  const t = getTranslation(lang);

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed top-3 right-3 z-50 flex items-center gap-2 rounded-lg bg-amber-700 px-3.5 py-2 text-xs font-medium text-white shadow-md"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>{t.pwa.offlineBanner}</span>
    </div>
  );
};
