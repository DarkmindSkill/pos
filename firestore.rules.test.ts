import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';

/**
 * Hardened Red-Team Test Suite for KadePOS Firestore Security Rules.
 * Verifies all "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */
export async function runDirtyDozenSecuritySuite() {
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'kadepos-security-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    const ownerId = 'owner_1';
    const attackerId = 'attacker_01';

    const unverifiedCtx = testEnv.authenticatedContext(ownerId, { email: 'owner@shop.lk', email_verified: false });
    const ownerCtx = testEnv.authenticatedContext(ownerId, { email: 'owner@shop.lk', email_verified: true });
    const attackerCtx = testEnv.authenticatedContext(attackerId, { email: 'attacker@evil.com', email_verified: true });

    const validStore = {
      ownerId,
      storeName: 'Lanka Mart',
      storeNameSi: 'ලංකා මාර්ට්',
      currency: 'LKR',
      taxRate: 0,
      paperWidth: '58mm',
      language: 'en',
      receiptFooterEn: 'Thank you! Come again.',
      receiptFooterSi: 'ස්තූතියි! නැවත පැමිණෙන්න.',
      autoPrint: false,
      showQrOnReceipt: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Seed legitimate owner store first
    await assertSucceeds(setDoc(doc(ownerCtx.firestore(), 'stores', ownerId), validStore));

    // Seed legitimate owner contact PII
    await assertSucceeds(
      setDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'private', 'contact'), {
        ownerId,
        storePhone: '+94771234567',
        storeAddress: 'Colombo 03',
        ownerEmail: 'owner@shop.lk',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const baseProduct = {
      ownerId,
      storeId: ownerId,
      name: 'Ceylon Tea 400g',
      nameSi: 'ලංකා තේ 400g',
      sku: 'TEA-400',
      qrCode: 'KPOS-TEA400X1',
      barcode: '4791000001',
      category: 'Beverages',
      costPrice: 820,
      sellingPrice: 1050,
      stockQty: 40,
      minStockLevel: 5,
      unit: 'pack',
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await assertSucceeds(setDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'products', 'prod_1'), baseProduct));

    // 1. Unverified Email Spoofing
    await assertFails(
      setDoc(doc(unverifiedCtx.firestore(), 'stores', ownerId), validStore)
    );

    // 2. Cross-Tenant Identity Spoofing
    await assertFails(
      setDoc(doc(attackerCtx.firestore(), 'stores', ownerId), { ...validStore, ownerId })
    );

    // 3. Shadow Ghost Field Injection
    await assertFails(
      setDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'products', 'prod_ghost'), {
        ...baseProduct,
        isAdminOverride: true,
      })
    );

    // 4. QR Code Mutation Attack (qrCode must remain immutable)
    await assertFails(
      updateDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'products', 'prod_1'), {
        qrCode: 'KPOS-HIJACK99',
        sellingPrice: 1100,
        updatedAt: serverTimestamp(),
      })
    );

    // 5. Value Poisoning on Whitelisted Price Field (negative price)
    await assertFails(
      updateDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'products', 'prod_1'), {
        sellingPrice: -9999,
        costPrice: 820,
        updatedAt: serverTimestamp(),
      })
    );

    // 6. ID Poisoning / Resource Exhaustion
    await assertFails(
      setDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'products', 'bad$id!@#spaces'), baseProduct)
    );

    // 7. PII Cross-User Read Leak
    await assertFails(
      getDoc(doc(attackerCtx.firestore(), 'stores', ownerId, 'private', 'contact'))
    );

    // 8. Unauthorized List Scraping
    await assertFails(
      getDocs(query(collection(attackerCtx.firestore(), 'stores', ownerId, 'products'), where('ownerId', '==', ownerId)))
    );

    // Seed a completed sale and transition to terminal 'voided'
    const baseSale = {
      ownerId,
      storeId: ownerId,
      invoiceNumber: 'INV-20261024-0001',
      subtotal: 1050,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 1050,
      costTotal: 820,
      amountPaid: 1100,
      changeDue: 50,
      paymentMethod: 'cash',
      itemCount: 1,
      customerNote: '',
      cashierName: 'Cashier',
      status: 'completed',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'sales', 'sale_1'), baseSale));
    await assertSucceeds(
      setDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'sales', 'sale_1', 'items', 'item_1'), {
        ownerId,
        storeId: ownerId,
        saleId: 'sale_1',
        productId: 'prod_1',
        productName: 'Ceylon Tea 400g',
        productNameSi: 'ලංකා තේ 400g',
        sku: 'TEA-400',
        qrCode: 'KPOS-TEA400X1',
        quantity: 1,
        unitPrice: 1050,
        costPrice: 820,
        lineTotal: 1050,
        unit: 'pack',
        createdAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'sales', 'sale_1'), {
        status: 'voided',
        updatedAt: serverTimestamp(),
      })
    );

    // 9. Terminal State Re-Activation (cannot un-void a voided sale)
    await assertFails(
      updateDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'sales', 'sale_1'), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      })
    );

    // 10. Client Timestamp Forgery (backdated string/Date instead of request.time)
    await assertFails(
      setDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'sales', 'sale_forged'), {
        ...baseSale,
        createdAt: new Date('2020-01-01T00:00:00Z'),
      })
    );

    // 11. Orphaned Line Item Write (parent sale does not exist)
    await assertFails(
      setDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'sales', 'missing_sale', 'items', 'item_orphan'), {
        ownerId,
        storeId: ownerId,
        saleId: 'missing_sale',
        productId: 'prod_1',
        productName: 'Ceylon Tea 400g',
        productNameSi: '',
        sku: 'TEA-400',
        qrCode: 'KPOS-TEA400X1',
        quantity: 1,
        unitPrice: 1050,
        costPrice: 820,
        lineTotal: 1050,
        unit: 'pack',
        createdAt: serverTimestamp(),
      })
    );

    // 12. Ledger Tampering (SaleItem update or Sale delete)
    await assertFails(
      updateDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'sales', 'sale_1', 'items', 'item_1'), {
        unitPrice: 1,
        lineTotal: 1,
      })
    );
    await assertFails(deleteDoc(doc(ownerCtx.firestore(), 'stores', ownerId, 'sales', 'sale_1')));
  } finally {
    await testEnv.cleanup();
  }
}
