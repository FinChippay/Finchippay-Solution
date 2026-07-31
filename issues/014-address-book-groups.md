# Issue #14 — Address Book with Group Management & Federation

**Labels:** `frontend` `feature` `contacts` `federation`

## Summary
Enhance the address book with group management, federation resolution, bulk operations, contact import/export, and sync with the backend API.

## Background
The frontend has `frontend/components/ContactPicker.tsx`, `frontend/lib/contactsDB.ts`, `frontend/lib/contactImportExport.ts`, and a `frontend/pages/contacts.tsx` page. The backend has SEP-0002 federation support (`federationController.js`). However, contacts are stored only locally in the browser (IndexedDB), have no group/category support, and federation resolution is ad-hoc.

## Problem Statement
Users cannot organise contacts into groups, sync contacts across devices, resolve Stellar addresses through federation, or perform bulk operations like batch payments from a group.

## Objectives
1. Add group/category management to contacts.
2. Implement federation resolution (SEP-0002) for username→address lookup.
3. Add backend contact sync API.
4. Build group-based batch payment flow.
5. Add tests and Storybook stories.

## Scope
- **In scope:** contact groups, federation, backend sync, group batch payments.
- **Out of scope:** social graph import, contact sharing between users.

## Detailed Implementation Requirements

1. **Contact groups:** Update `frontend/lib/contactsDB.ts` to support groups:
   - Each contact can belong to one or more groups (array of group IDs).
   - Group: `{ id, name, color, icon, createdAt }`.
   - Methods: `createGroup`, `deleteGroup`, `addToGroup`, `removeFromGroup`, `getContactsByGroup`.
   - Default groups: "Favorites", "Frequent", "All".

2. **Federation resolution:** Update `frontend/lib/addressBook.ts`:
   - When user types a Stellar address, attempt federation resolution via `/api/federation?q=username*domain.com`.
   - Cache resolved addresses with 24h TTL.
   - Show resolved address in `ContactPicker` with a federation badge.

3. **Backend sync API:** Add backend endpoints:
   - `GET /api/contacts/:publicKey` — fetch contacts.
   - `POST /api/contacts/:publicKey/sync` — bulk upsert contacts and groups.
   - Use the existing database pattern from `contactsDB.ts` but with PostgreSQL storage.
   - Create migration `014_contacts.js`.

4. **Group-based batch payment:** Extend `BatchPaymentForm.tsx`:
   - Add a "Select Group" dropdown that pre-fills recipients from a contact group.
   - Show group member count and total estimated amount.
   - Allow amount-per-recipient or total distribution.

5. **Contact import/export:** Update `ContactImportModal.tsx` and `ContactExportModal.tsx`:
   - Import from CSV/JSON with group mapping.
   - Export with group information.
   - Validate imported addresses and show errors for invalid ones.

6. **UI updates:**
   - Update `frontend/pages/contacts.tsx` with group sidebar.
   - Add drag-and-drop contacts into groups.
   - Search across contacts and groups.
   - Show federated addresses with domain badge.

7. **Tests:** Update contact tests, add federation resolution tests, add group management tests.

## Expected Architecture

```
frontend/
├── lib/
│   ├── contactsDB.ts          (UPDATE: groups, federation)
│   └── addressBook.ts         (UPDATE: federation)
├── components/
│   ├── ContactPicker.tsx      (UPDATE: groups filter)
│   ├── ContactImportModal.tsx (UPDATE: group mapping)
│   └── ContactExportModal.tsx (UPDATE: group export)
├── pages/
│   └── contacts.tsx           (UPDATE: groups sidebar)
└── __tests__/
    └── contacts.test.ts       (UPDATE)

backend/
├── migrations/
│   └── 014_contacts.js        (NEW)
├── src/routes/
│   └── contacts.js            (NEW)
└── src/controllers/
    └── contactController.js   (NEW)
```

## Acceptance Criteria
- [ ] Contacts can be organised into groups with colour coding.
- [ ] Federation resolution works for username*domain.com addresses.
- [ ] Resolved addresses are cached and show federation badge.
- [ ] Batch payment form supports "Select Group" to pre-fill recipients.
- [ ] Contacts sync across devices via backend API.
- [ ] CSV/JSON import/export preserves group information.
- [ ] All existing tests pass.
