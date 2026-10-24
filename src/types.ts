import { Timestamp } from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export type Language = 'en' | 'si';
export type CurrencyCode = 'LKR' | 'USD' | 'EUR' | 'GBP' | 'INR';
export type PaperWidth = '58mm' | '80mm';
export type PaymentMethod = 'cash' | 'card' | 'qr' | 'credit';
export type ProductUnit = 'pcs' | 'kg' | 'g' | 'L' | 'ml' | 'pack' | 'box';
export type SaleStatus = 'completed' | 'voided';
export type ReceiptLangMode = 'bilingual' | 'en' | 'si';

export type AppTab = 'pos' | 'inventory' | 'labels' | 'dashboard' | 'settings';

export type ScannerMode = 'checkout' | 'reprice' | 'capture';

export interface StoreConfig {
  ownerId: string;
  storeName: string;
  storeNameSi: string;
  currency: CurrencyCode;
  taxRate: number;
  paperWidth: PaperWidth;
  language: Language;
  receiptFooterEn: string;
  receiptFooterSi: string;
  autoPrint: boolean;
  showQrOnReceipt: boolean;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

export interface StoreContact {
  ownerId: string;
  storePhone: string;
  storeAddress: string;
  ownerEmail: string;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

export interface Product {
  id: string;
  ownerId: string;
  storeId: string;
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
  isActive: boolean;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface ParkedCart {
  id: string;
  label: string;
  parkedAt: string;
  items: CartItem[];
  discountMode: 'amount' | 'percent';
  discountValue: number;
  customerNote: string;
}

export interface Sale {
  id: string;
  ownerId: string;
  storeId: string;
  invoiceNumber: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  costTotal: number;
  amountPaid: number;
  changeDue: number;
  paymentMethod: PaymentMethod;
  itemCount: number;
  customerNote: string;
  cashierName: string;
  status: SaleStatus;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

export interface SaleItem {
  id: string;
  ownerId: string;
  storeId: string;
  saleId: string;
  productId: string;
  productName: string;
  productNameSi: string;
  sku: string;
  qrCode: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  lineTotal: number;
  unit: ProductUnit;
  createdAt?: Timestamp | Date;
}

export interface LabelFormatConfig {
  layout: 'a4-divided' | '58mm-twin' | '58mm-single';
  a4Cols: number;
  a4Rows: number;
  qrOnly: boolean;
  showCutLines: boolean;
  showStoreName: boolean;
  showSinhalaName: boolean;
  showPrice: boolean;
  showSku: boolean;
}
