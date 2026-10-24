# Security Specification — KadePOS Firestore Architecture

## 1. Data Invariants & Master Source of Truth

1. **Master Store Ownership (`Store` at `/stores/{storeId}`)**:
   - A store document ID `storeId` MUST strictly equal `request.auth.uid` and match `isValidId(storeId)`.
   - All writes and reads require `request.auth != null` and `request.auth.token.email_verified == true`.
   - `ownerId` MUST equal `request.auth.uid` and is immutable after creation (`incoming().ownerId == existing().ownerId`).
   - `createdAt` MUST equal `request.time` on creation and is immutable on update; `updatedAt` MUST equal `request.time` on creation and update.

2. **PII Isolation (`StoreContact` at `/stores/{storeId}/private/{docId}`)**:
   - Store contact PII (`storePhone`, `storeAddress`, `ownerEmail`) is strictly isolated in `/stores/{storeId}/private/contact`.
   - Only `docId == 'contact'` is permitted.
   - Relational Master Gate: Requires parent `/stores/{storeId}` to exist (or `existsAfter` in atomic setup batch) with `ownerId == request.auth.uid`.
   - Read and write access is strictly restricted to the verified owner (`request.auth.uid == storeId`).

3. **Inventory Integrity & Immutable QR Labels (`Product` at `/stores/{storeId}/products/{productId}`)**:
   - Every product belongs to `/stores/{storeId}` verified via Master Gate (`get(/databases/$(database)/documents/stores/$(storeId)).data.ownerId == request.auth.uid`).
   - `qrCode` (`^[a-zA-Z0-9_\-]+$`, length 6..64) is **immutable** once created (`incoming().qrCode == existing().qrCode`) so printed QR labels permanently resolve to the right product while `sellingPrice` updates dynamically via the `ScanRepriceAction`.
   - `list` queries never call `get()`/`exists()`; they strictly enforce `storeId == request.auth.uid && resource.data.ownerId == request.auth.uid`.

4. **Sales & Terminal State Locking (`Sale` at `/stores/{storeId}/sales/{saleId}`)**:
   - Sales are created in `status == 'completed'` only.
   - Terminal State Gate: Once `status == 'voided'`, all subsequent updates are permanently denied. From `'completed'`, the only valid update action transitions `status` to `'voided'` with `updatedAt == request.time`.
   - Sales can never be deleted (`allow delete: if false`).

5. **Atomic Line Items (`SaleItem` at `/stores/{storeId}/sales/{saleId}/items/{itemId}`)**:
   - Line items are stored in a dedicated subcollection (no unbounded arrays).
   - Atomicity Guarantee: Creating a `SaleItem` requires `existsAfter(/databases/$(database)/documents/stores/$(storeId)/sales/$(saleId))` and `getAfter(...).data.ownerId == request.auth.uid`.
   - Line items are strictly immutable (`allow update, delete: if false`).

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Unverified Email Spoofing (`Store` Create)**:
   ```json
   {
     "auth": { "uid": "user_alpha", "email": "owner@shop.lk", "email_verified": false },
     "path": "/stores/user_alpha",
     "op": "create",
     "data": { "ownerId": "user_alpha", "storeName": "Spoof Shop" }
   }
   ```
2. **Payload 2 — Cross-Tenant Identity Spoofing (`Store` Create)**:
   ```json
   {
     "auth": { "uid": "attacker_01", "email_verified": true },
     "path": "/stores/victim_01",
     "op": "create",
     "data": { "ownerId": "victim_01", "storeName": "Hijacked Store" }
   }
   ```
3. **Payload 3 — Shadow Ghost Field Injection (`Product` Create)**:
   ```json
   {
     "auth": { "uid": "owner_1", "email_verified": true },
     "path": "/stores/owner_1/products/prod_1",
     "op": "create",
     "data": { "ownerId": "owner_1", "storeId": "owner_1", "name": "Tea", "isAdminOverride": true }
   }
   ```
4. **Payload 4 — QR Code Mutation Attack (`Product` Update)**:
   ```json
   {
     "auth": { "uid": "owner_1", "email_verified": true },
     "path": "/stores/owner_1/products/prod_1",
     "op": "update",
     "data": { "qrCode": "KPOS-HIJACK99", "sellingPrice": 500 }
   }
   ```
5. **Payload 5 — Value Poisoning on Whitelisted Price Field (`Product` Update)**:
   ```json
   {
     "auth": { "uid": "owner_1", "email_verified": true },
     "path": "/stores/owner_1/products/prod_1",
     "op": "update",
     "data": { "sellingPrice": -9999 }
   }
   ```
6. **Payload 6 — ID Poisoning / Resource Exhaustion (`Product` Create with Invalid Path ID)**:
   ```json
   {
     "auth": { "uid": "owner_1", "email_verified": true },
     "path": "/stores/owner_1/products/bad$id!@#with spaces",
     "op": "create",
     "data": { "ownerId": "owner_1", "storeId": "owner_1", "name": "Valid Name" }
   }
   ```
7. **Payload 7 — PII Cross-User Read Leak (`StoreContact` Get)**:
   ```json
   {
     "auth": { "uid": "attacker_02", "email_verified": true },
     "path": "/stores/owner_1/private/contact",
     "op": "get"
   }
   ```
8. **Payload 8 — Unauthorized List Scraping (`Product` List without Owner Filter)**:
   ```json
   {
     "auth": { "uid": "attacker_02", "email_verified": true },
     "path": "/stores/owner_1/products",
     "op": "list"
   }
   ```
9. **Payload 9 — Terminal State Re-Activation (`Sale` Update after `'voided'`)**:
   ```json
   {
     "auth": { "uid": "owner_1", "email_verified": true },
     "path": "/stores/owner_1/sales/sale_voided_1",
     "op": "update",
     "data": { "status": "completed" }
   }
   ```
10. **Payload 10 — Client Timestamp Forgery (`Sale` Create with Past Timestamp)**:
    ```json
    {
      "auth": { "uid": "owner_1", "email_verified": true },
      "path": "/stores/owner_1/sales/sale_backdated",
      "op": "create",
      "data": { "createdAt": "2020-01-01T00:00:00Z", "status": "completed" }
    }
    ```
11. **Payload 11 — Orphaned Line Item Write (`SaleItem` Create without Parent `Sale`)**:
    ```json
    {
      "auth": { "uid": "owner_1", "email_verified": true },
      "path": "/stores/owner_1/sales/nonexistent_sale/items/item_1",
      "op": "create",
      "data": { "ownerId": "owner_1", "storeId": "owner_1", "saleId": "nonexistent_sale" }
    }
    ```
12. **Payload 12 — Ledger Tampering (`SaleItem` Update or `Sale` Delete)**:
    ```json
    {
      "auth": { "uid": "owner_1", "email_verified": true },
      "path": "/stores/owner_1/sales/sale_1/items/item_1",
      "op": "update",
      "data": { "unitPrice": 1, "lineTotal": 1 }
    }
    ```
