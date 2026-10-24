import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Minus,
  Plus,
  Printer,
  QrCode,
  Scissors,
  Search,
  Tag,
} from 'lucide-react';
import { getTranslation } from '../i18n/translations';
import { LabelFormatConfig, Language, Product, StoreConfig } from '../types';
import { printProductQrLabels } from '../utils/printEngine';
import { formatMoney, generateQrDataUrl } from '../utils/soundAndFormat';

interface QRLabelsViewProps {
  store: StoreConfig;
  products: Product[];
  lang: Language;
  onOpenRepriceScanner: () => void;
}

const A4_DIVISION_PRESETS: { cols: number; rows: number; tag: string }[] = [
  { cols: 3, rows: 5, tag: '3×5 · 15' },
  { cols: 4, rows: 6, tag: '4×6 · 24' },
  { cols: 5, rows: 8, tag: '5×8 · 40' },
  { cols: 6, rows: 10, tag: '6×10 · 60' },
  { cols: 5, rows: 13, tag: '5×13 · 65' },
  { cols: 8, rows: 12, tag: '8×12 · 96' },
];

export const QRLabelsView: React.FC<QRLabelsViewProps> = ({
  store,
  products,
  lang,
  onOpenRepriceScanner,
}) => {
  const t = getTranslation(lang);

  const [search, setSearch] = useState('');
  const [copiesMap, setCopiesMap] = useState<Record<string, number>>({});
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [previewPageIndex, setPreviewPageIndex] = useState(0);

  const [config, setConfig] = useState<LabelFormatConfig>({
    layout: 'a4-divided',
    a4Cols: 5,
    a4Rows: 8,
    qrOnly: true,
    showCutLines: true,
    showStoreName: false,
    showSinhalaName: true,
    showPrice: false,
    showSku: false,
  });

  // Pre-fill initial copies across sample products so the A4 divided sheet preview is populated immediately
  useEffect(() => {
    if (products.length > 0 && Object.keys(copiesMap).length === 0) {
      const initial: Record<string, number> = {};
      const sampleSlice = products.slice(0, Math.min(8, products.length));
      const eachCopies = Math.max(2, Math.floor(40 / Math.max(1, sampleSlice.length)));
      sampleSlice.forEach((p) => {
        initial[p.id] = eachCopies;
      });
      setCopiesMap(initial);
    }
  }, [products]);

  // Generate crisp QR data URLs for all catalog products
  useEffect(() => {
    let active = true;
    (async () => {
      const next: Record<string, string> = {};
      for (const p of products) {
        next[p.id] = await generateQrDataUrl(p.qrCode, 180);
      }
      if (active) setQrMap(next);
    })();
    return () => {
      active = false;
    };
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.nameSi.toLowerCase().includes(q) ||
        p.qrCode.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
    );
  }, [products, search]);

  const perSheet = config.a4Cols * config.a4Rows;
  const cellWidthMm = (200 / config.a4Cols).toFixed(1);
  const cellHeightMm = (287 / config.a4Rows).toFixed(1);

  const expandedPreviewCells = useMemo(() => {
    const list: Product[] = [];
    for (const p of products) {
      const count = Math.max(0, copiesMap[p.id] || 0);
      for (let i = 0; i < count; i++) {
        list.push(p);
      }
    }
    return list;
  }, [products, copiesMap]);

  const totalStickers = expandedPreviewCells.length;
  const totalA4Pages =
    totalStickers === 0 ? 0 : Math.max(1, Math.ceil(totalStickers / perSheet));

  useEffect(() => {
    if (previewPageIndex >= totalA4Pages) {
      setPreviewPageIndex(Math.max(0, totalA4Pages - 1));
    }
  }, [previewPageIndex, totalA4Pages]);

  const currentSheetCells = useMemo(() => {
    const start = previewPageIndex * perSheet;
    const slice: (Product | null)[] = expandedPreviewCells.slice(start, start + perSheet);
    while (slice.length < perSheet) {
      slice.push(null);
    }
    return slice;
  }, [expandedPreviewCells, previewPageIndex, perSheet]);

  const setCopies = (id: string, val: number) => {
    setCopiesMap((prev) => ({
      ...prev,
      [id]: Math.min(1000, Math.max(0, Math.round(val))),
    }));
  };

  const setCols = (val: number) => {
    const clamped = Math.min(10, Math.max(2, Math.round(val)));
    setConfig((prev) => ({ ...prev, a4Cols: clamped }));
  };

  const setRows = (val: number) => {
    const clamped = Math.min(16, Math.max(2, Math.round(val)));
    setConfig((prev) => ({ ...prev, a4Rows: clamped }));
  };

  const handleSelectAll = () => {
    const next: Record<string, number> = {};
    const defaultPerItem =
      config.layout === 'a4-divided'
        ? Math.max(1, Math.floor(perSheet / Math.max(1, filtered.length)))
        : 2;
    filtered.forEach((p) => {
      next[p.id] = Math.max(defaultPerItem, copiesMap[p.id] || 0);
    });
    setCopiesMap((prev) => ({ ...prev, ...next }));
  };

  const handleClearAll = () => {
    setCopiesMap({});
  };

  const handleBatchPrint = () => {
    const entries = products
      .map((product) => ({
        product,
        copies: copiesMap[product.id] || 0,
      }))
      .filter((e) => e.copies > 0);

    printProductQrLabels(entries, store, config);
  };

  const handlePrintFullA4ForProduct = (product: Product) => {
    const fullCount = config.layout === 'a4-divided' ? perSheet : 2;
    printProductQrLabels([{ product, copies: fullCount }], store, config);
  };

  const handleSinglePrint = (product: Product) => {
    const count = Math.max(
      1,
      copiesMap[product.id] || (config.layout === 'a4-divided' ? config.a4Cols : 2)
    );
    printProductQrLabels([{ product, copies: count }], store, config);
  };

  return (
    <div className="space-y-6 pb-20 lg:pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 [text-wrap:balance]">
            {t.labels.title}
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">{t.labels.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenRepriceScanner}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 hover:bg-slate-50 inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Tag className="w-4 h-4 text-sky-600 shrink-0" />
            <span>{t.labels.testRepriceBtn}</span>
          </button>

          <button
            type="button"
            disabled={totalStickers === 0}
            onClick={handleBatchPrint}
            className="min-h-[44px] px-5 py-2 rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span className="tabular-nums">
              {t.labels.printLabelsBtn} ({totalStickers}
              {config.layout === 'a4-divided' && totalA4Pages > 0
                ? ` · ${totalA4Pages} A4`
                : ''}
              )
            </span>
          </button>
        </div>
      </div>

      {/* Main A4 Paper Division Configurator + Live Proportional A4 Sheet Preview */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Paper Format, A4 Grid Division & Content Mode Controls */}
        <div className="xl:col-span-8 rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Paper / Roll Format */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                {t.labels.layoutLabel}
              </label>
              <select
                value={config.layout}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    layout: e.target.value as LabelFormatConfig['layout'],
                  }))
                }
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-900 focus:border-sky-600 focus:outline-none"
              >
                <option value="a4-divided">{t.labels.layoutA4Divided}</option>
                <option value="58mm-twin">{t.labels.layout58Twin}</option>
                <option value="58mm-single">{t.labels.layout58Single}</option>
              </select>
            </div>

            {/* Printed Sticker Content Mode (Default: Product QR Only) */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                {t.labels.contentModeLabel}
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, qrOnly: true }))}
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    config.qrOnly
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.labels.modeQrOnly}
                </button>
                <button
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, qrOnly: false }))}
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    !config.qrOnly
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.labels.modeQrDetails}
                </button>
              </div>
            </div>
          </div>

          {/* A4 Paper Grid Division Controls (Columns × Rows) */}
          {config.layout === 'a4-divided' && (
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Grid3X3 className="w-4 h-4 text-sky-600 shrink-0" />
                  <span>{t.labels.a4DivideTitle}</span>
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-600">
                  {t.labels.perSheetLabel}:{' '}
                  <strong className="text-slate-900">{perSheet}</strong> ·{' '}
                  {t.labels.cellSizeLabel}:{' '}
                  <strong className="text-slate-900">
                    {cellWidthMm}×{cellHeightMm}mm
                  </strong>
                </div>
              </div>

              {/* Quick A4 Division Presets */}
              <div>
                <div className="text-xs font-medium text-slate-500 mb-2">
                  {t.labels.a4PresetsLabel}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {A4_DIVISION_PRESETS.map((preset) => {
                    const isSelected =
                      config.a4Cols === preset.cols && config.a4Rows === preset.rows;
                    return (
                      <button
                        key={preset.tag}
                        type="button"
                        onClick={() =>
                          setConfig((prev) => ({
                            ...prev,
                            a4Cols: preset.cols,
                            a4Rows: preset.rows,
                          }))
                        }
                        className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-mono font-semibold tabular-nums transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isSelected
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {preset.tag} / A4
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Columns & Rows Steppers + Scissor Cut Lines */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {t.labels.colsLabel} (2–10)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCols(config.a4Cols - 1)}
                      className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 cursor-pointer"
                      aria-label="Decrease columns"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="2"
                      max="10"
                      value={config.a4Cols}
                      onChange={(e) => setCols(parseInt(e.target.value, 10) || 5)}
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 text-center text-sm font-mono font-bold tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setCols(config.a4Cols + 1)}
                      className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 cursor-pointer"
                      aria-label="Increase columns"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {t.labels.rowsLabel} (2–16)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRows(config.a4Rows - 1)}
                      className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 cursor-pointer"
                      aria-label="Decrease rows"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="2"
                      max="16"
                      value={config.a4Rows}
                      onChange={(e) => setRows(parseInt(e.target.value, 10) || 8)}
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 text-center text-sm font-mono font-bold tabular-nums text-slate-900 focus:border-sky-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setRows(config.a4Rows + 1)}
                      className="min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 cursor-pointer"
                      aria-label="Increase rows"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <label className="min-h-[40px] flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={config.showCutLines}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, showCutLines: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-sky-600"
                  />
                  <Scissors className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{t.labels.showCutLines}</span>
                </label>
              </div>
            </div>
          )}

          {/* Optional Extra Fields (Only shown when user switches out of Product QR Only mode) */}
          {!config.qrOnly && (
            <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.showStoreName}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, showStoreName: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-sky-600"
                />
                <span>{t.labels.includeStore}</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.showSinhalaName}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, showSinhalaName: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-sky-600"
                />
                <span>{t.labels.includeSinhala}</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.showSku}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, showSku: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-sky-600"
                />
                <span>{t.labels.includeSku}</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.showPrice}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, showPrice: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-sky-600"
                />
                <span>{t.labels.includePrice}</span>
              </label>
            </div>
          )}

          <div className="text-xs text-slate-500 pt-3 border-t border-slate-100">
            {config.qrOnly ? t.labels.qrOnlyHint : t.labels.priceOmitHint}
          </div>
        </div>

        {/* Right: Live Proportional A4 Paper Division Preview */}
        {config.layout === 'a4-divided' && (
          <div className="xl:col-span-4 rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t.labels.previewSheetTitle}
                </h2>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                  210×297mm · {config.a4Cols}×{config.a4Rows} ({perSheet} QR)
                </div>
              </div>

              {totalA4Pages > 1 && (
                <div className="inline-flex items-center gap-1 font-mono text-xs tabular-nums">
                  <button
                    type="button"
                    disabled={previewPageIndex === 0}
                    onClick={() => setPreviewPageIndex((p) => Math.max(0, p - 1))}
                    className="min-h-[32px] min-w-[32px] rounded-lg border border-slate-200 inline-flex items-center justify-center text-slate-700 disabled:opacity-40 cursor-pointer"
                    aria-label="Previous A4 sheet"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="px-1.5 text-slate-700">
                    {previewPageIndex + 1}/{totalA4Pages}
                  </span>
                  <button
                    type="button"
                    disabled={previewPageIndex >= totalA4Pages - 1}
                    onClick={() =>
                      setPreviewPageIndex((p) => Math.min(totalA4Pages - 1, p + 1))
                    }
                    className="min-h-[32px] min-w-[32px] rounded-lg border border-slate-200 inline-flex items-center justify-center text-slate-700 disabled:opacity-40 cursor-pointer"
                    aria-label="Next A4 sheet"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Proportional 210:297 A4 Sheet Canvas */}
            <div className="bg-slate-100 rounded-xl p-3 flex justify-center">
              <div className="w-full max-w-[230px] aspect-[210/297] bg-white border border-slate-300 p-1.5">
                <div
                  className={`w-full h-full grid ${
                    config.showCutLines ? 'border-t border-l border-dashed border-slate-300' : ''
                  }`}
                  style={{
                    gridTemplateColumns: `repeat(${config.a4Cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${config.a4Rows}, minmax(0, 1fr))`,
                  }}
                >
                  {currentSheetCells.map((cellProd, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-center overflow-hidden p-[2px] ${
                        config.showCutLines
                          ? 'border-r border-b border-dashed border-slate-300'
                          : ''
                      }`}
                    >
                      {cellProd && qrMap[cellProd.id] ? (
                        <img
                          src={qrMap[cellProd.id]}
                          alt={cellProd.qrCode}
                          referrerPolicy="no-referrer"
                          className="w-full h-full max-w-[82%] max-h-[82%] object-contain"
                        />
                      ) : cellProd ? (
                        <QrCode className="w-3 h-3 text-slate-700" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-600 font-mono tabular-nums pt-1">
              <span>
                {t.labels.totalStickers}: <strong className="text-slate-900">{totalStickers}</strong>
              </span>
              <span>
                {t.labels.a4PagesLabel}: <strong className="text-slate-900">{totalA4Pages}</strong>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Search & Bulk Selection Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.pos.searchPlaceholder}
            className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSelectAll}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t.labels.selectAll}
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t.labels.clearSelection}
          </button>
        </div>
      </div>

      {/* Product-by-Product QR Selection Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((product) => {
          const copies = copiesMap[product.id] || 0;
          const qrSrc = qrMap[product.id];

          return (
            <div
              key={product.id}
              className={`rounded-2xl bg-white border p-4 flex flex-col justify-between transition-colors ${
                copies > 0 ? 'border-sky-600' : 'border-slate-200'
              }`}
            >
              <div>
                {/* Catalog Identification Header (Not printed when Product QR Only is active) */}
                <div className="flex items-baseline justify-between gap-2 mb-2.5">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {lang === 'si' && product.nameSi ? product.nameSi : product.name}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                    {formatMoney(product.sellingPrice, store.currency)}
                  </div>
                </div>

                {/* Simulated Divided Sticker Cell Preview */}
                {config.qrOnly ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 flex flex-col items-center justify-center">
                    {qrSrc ? (
                      <img
                        src={qrSrc}
                        alt={product.qrCode}
                        referrerPolicy="no-referrer"
                        className="w-24 h-24 bg-white p-1.5 rounded border border-slate-200"
                      />
                    ) : (
                      <div className="w-24 h-24 bg-white rounded border border-slate-200 flex items-center justify-center">
                        <QrCode className="w-8 h-8 text-slate-400" />
                      </div>
                    )}
                    <div className="mt-2 text-[11px] font-mono text-slate-500 truncate max-w-full">
                      {product.qrCode}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
                    {config.showStoreName && (
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 truncate mb-1.5">
                        {store.storeName}
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      {qrSrc ? (
                        <img
                          src={qrSrc}
                          alt={product.qrCode}
                          referrerPolicy="no-referrer"
                          className="w-16 h-16 bg-white p-1 rounded border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 bg-white rounded border border-slate-200 flex items-center justify-center shrink-0">
                          <QrCode className="w-6 h-6 text-slate-400" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-slate-900 line-clamp-2 leading-tight">
                          {product.name}
                        </div>
                        {config.showSinhalaName && product.nameSi && (
                          <div className="text-[11px] text-slate-600 truncate mt-0.5">
                            {product.nameSi}
                          </div>
                        )}
                        <div className="text-[11px] font-mono font-bold text-slate-800 mt-1 truncate">
                          {product.qrCode}
                        </div>
                        {config.showSku && (
                          <div className="text-[10px] font-mono text-slate-500">{product.sku}</div>
                        )}
                        {config.showPrice && (
                          <div className="text-xs font-mono font-bold tabular-nums text-slate-900 mt-0.5">
                            {formatMoney(product.sellingPrice, store.currency)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Copy Controls + Fill A4 + Print Actions */}
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCopies(product.id, copies - 1)}
                      className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 cursor-pointer"
                      aria-label="Fewer copies"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      value={copies}
                      onChange={(e) => setCopies(product.id, parseInt(e.target.value, 10) || 0)}
                      className="w-14 min-h-[38px] rounded-lg border border-slate-200 text-center text-xs font-mono font-bold tabular-nums text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setCopies(product.id, copies + 1)}
                      className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 cursor-pointer"
                      aria-label="More copies"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {config.layout === 'a4-divided' && (
                    <button
                      type="button"
                      onClick={() => setCopies(product.id, perSheet)}
                      className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-mono font-semibold tabular-nums text-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
                      title={t.labels.fillOneA4}
                    >
                      {perSheet} (1 A4)
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSinglePrint(product)}
                    className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5 shrink-0" />
                    <span>{t.labels.printSingleBtn}</span>
                  </button>

                  {config.layout === 'a4-divided' && (
                    <button
                      type="button"
                      onClick={() => handlePrintFullA4ForProduct(product)}
                      className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Grid3X3 className="w-3.5 h-3.5 shrink-0" />
                      <span>{t.labels.printOneA4}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
