import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  CurrencyCode,
  Language,
  OperationType,
  PaperWidth,
  PaymentMethod,
  ProductUnit,
  SaleStatus,
} from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Validate connection to Firestore on boot per Firebase Integration Skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Blueprint-Synchronized Defensive Validation & Sanitization ---
export const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeIdToken(raw: string, fallbackPrefix = 'ID', maxLen = 64): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, maxLen);
  if (cleaned.length >= 1 && ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return `${fallbackPrefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
}

export function clampText(val: string, minLen: number, maxLen: number, fallback = ''): string {
  const trimmed = (val ?? '').trim().slice(0, maxLen);
  if (trimmed.length < minLen) {
    return fallback.slice(0, maxLen);
  }
  return trimmed;
}

export function clampNum(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  const rounded = Math.round(val * 100) / 100;
  return Math.min(max, Math.max(min, rounded));
}

export function validateCurrency(val: string): CurrencyCode {
  const allowed: CurrencyCode[] = ['LKR', 'USD', 'EUR', 'GBP', 'INR'];
  return allowed.includes(val as CurrencyCode) ? (val as CurrencyCode) : 'LKR';
}

export function validatePaperWidth(val: string): PaperWidth {
  return val === '80mm' ? '80mm' : '58mm';
}

export function validateLanguage(val: string): Language {
  return val === 'si' ? 'si' : 'en';
}

export function validateUnit(val: string): ProductUnit {
  const allowed: ProductUnit[] = ['pcs', 'kg', 'g', 'L', 'ml', 'pack', 'box'];
  return allowed.includes(val as ProductUnit) ? (val as ProductUnit) : 'pcs';
}

export function validatePaymentMethod(val: string): PaymentMethod {
  const allowed: PaymentMethod[] = ['cash', 'card', 'qr', 'credit'];
  return allowed.includes(val as PaymentMethod) ? (val as PaymentMethod) : 'cash';
}

export function validateSaleStatus(val: string): SaleStatus {
  return val === 'voided' ? 'voided' : 'completed';
}

export interface SeedProductTemplate {
  name: string;
  nameSi: string;
  sku: string;
  qrCode: string;
  barcode: string;
  category: string;
  costPrice: number;
  sellingPrice: number;
  stockQty: number;
  minStockLevel: number;
  unit: ProductUnit;
}

export const SEED_PRODUCTS: SeedProductTemplate[] = [
  {
    name: 'Samba Rice 5kg',
    nameSi: 'සම්බා සහල් 5kg',
    sku: 'RICE-5KG',
    qrCode: 'KPOS-RICE5K01',
    barcode: '4792010001015',
    category: 'Grains & Staples',
    costPrice: 1050,
    sellingPrice: 1250,
    stockQty: 45,
    minStockLevel: 10,
    unit: 'pack',
  },
  {
    name: 'Ceylon BOPF Tea 400g',
    nameSi: 'ලංකා තේ කොළ 400g',
    sku: 'TEA-400G',
    qrCode: 'KPOS-CEYTEA02',
    barcode: '4792010001022',
    category: 'Beverages',
    costPrice: 780,
    sellingPrice: 980,
    stockQty: 32,
    minStockLevel: 8,
    unit: 'pack',
  },
  {
    name: 'Full Cream Milk Powder 400g',
    nameSi: 'සම්පූර්ණ යොදය කිරිපිටි 400g',
    sku: 'MILK-400G',
    qrCode: 'KPOS-MILKPW03',
    barcode: '4792010001039',
    category: 'Dairy',
    costPrice: 920,
    sellingPrice: 1080,
    stockQty: 28,
    minStockLevel: 8,
    unit: 'box',
  },
  {
    name: 'Pure Coconut Oil 1L',
    nameSi: 'පිරිසිදු පොල් තෙල් 1L',
    sku: 'OIL-1L',
    qrCode: 'KPOS-COCOIL04',
    barcode: '4792010001046',
    category: 'Cooking Essentials',
    costPrice: 690,
    sellingPrice: 860,
    stockQty: 18,
    minStockLevel: 6,
    unit: 'L',
  },
  {
    name: 'Red Lentils (Dhal) 1kg',
    nameSi: 'මයිසූර් පරිප්පු 1kg',
    sku: 'DHAL-1KG',
    qrCode: 'KPOS-REDDHL05',
    barcode: '4792010001053',
    category: 'Grains & Staples',
    costPrice: 280,
    sellingPrice: 360,
    stockQty: 60,
    minStockLevel: 12,
    unit: 'kg',
  },
  {
    name: 'Cream Cracker Biscuits 190g',
    nameSi: 'ක්‍රීම් ක්‍රැකර් බිස්කට් 190g',
    sku: 'BISC-190',
    qrCode: 'KPOS-CRMCKR06',
    barcode: '4792010001060',
    category: 'Snacks & Bakery',
    costPrice: 145,
    sellingPrice: 190,
    stockQty: 5,
    minStockLevel: 10,
    unit: 'pack',
  },
  {
    name: 'White Cane Sugar 1kg',
    nameSi: 'සුදු සීනි 1kg',
    sku: 'SUGR-1KG',
    qrCode: 'KPOS-WSUGAR07',
    barcode: '4792010001077',
    category: 'Grains & Staples',
    costPrice: 230,
    sellingPrice: 290,
    stockQty: 50,
    minStockLevel: 10,
    unit: 'kg',
  },
  {
    name: 'Ceylon Cinnamon Quills 100g',
    nameSi: 'ලංකා කුරුඳු 100g',
    sku: 'SPIC-CIN1',
    qrCode: 'KPOS-CINNAM08',
    barcode: '4792010001084',
    category: 'Spices',
    costPrice: 410,
    sellingPrice: 560,
    stockQty: 4,
    minStockLevel: 6,
    unit: 'pack',
  },
];
