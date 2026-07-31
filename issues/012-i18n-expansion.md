# Issue #12 — Multi-Language i18n Expansion (5+ Languages)

**Labels:** `frontend` `feature` `i18n` `localization`

## Summary
Expand the internationalisation (i18n) system to support 5+ languages beyond English, including full RTL support, locale-aware formatting, and a language management UI.

## Background
The frontend already has a basic i18n setup with `react-i18next` in `frontend/lib/i18n.ts`. Currently only English (`frontend/public/locales/en/common.json`) is fully translated. The `LanguageSwitcher` component exists in `frontend/components/LanguageSwitcher.tsx`. RTL support is partially implemented in `frontend/styles/rtl.css`.

## Problem Statement
The app is only usable by English speakers. Expanding to Spanish, French, Japanese, Arabic, and Portuguese would unlock global markets. Arabic requires full RTL support which is partially implemented but has many gaps.

## Objectives
1. Add complete translations for 5+ languages.
2. Fix RTL layout issues across all components.
3. Implement locale-aware number, date, and currency formatting.
4. Add language auto-detection based on browser settings.
5. Add a language preference API endpoint.

## Scope
- **In scope:** translation files, RTL fixes, locale-aware formatting, browser detection.
- **Out of scope:** machine translation, community translation platform.

## Detailed Implementation Requirements

1. **Translation files:** Create complete `common.json` files for `es` (Spanish), `fr` (French), `ja` (Japanese), `ar` (Arabic), `pt` (Portuguese). Translate all existing keys from the English file. Each file should have identical key structure. Minimum 150+ translated keys per language.

2. **RTL audit:** Audit all 30+ components for RTL correctness. Key issues to fix:
   - `TransactionList.tsx`: arrow directions, padding.
   - `MultiSigFlow.tsx`: step indicator direction, text alignment.
   - `TradeForm.tsx`: swap direction icon, slider direction.
   - `Navbar.tsx`: menu alignment, logo position.
   - All `text-left`/`text-right` classes should use RTL-aware variants.
   - Check `frontend/styles/rtl.css` for completeness.

3. **Locale-aware formatting:** Update `frontend/utils/intlFormat.ts` to use `Intl.NumberFormat` and `Intl.DateTimeFormat` with the active locale. Apply to:
   - Amount display (XLM amounts with locale separators).
   - Date formatting (transaction dates).
   - Currency display (USD values).

4. **Auto-detection:** Use `i18next-browser-languagedetector` to detect browser language on first visit. Store preference in localStorage and sync to backend via a `POST /api/settings/language` endpoint.

5. **Language preference API:** Add `GET/PUT /api/users/:publicKey/preferences` to store language preference server-side. Use the existing `usernames` table pattern.

6. **Testing:** Update `frontend/__tests__/rtl.test.tsx` to cover all major components. Add a test that verifies all language files have identical key sets.

## Expected Architecture

```
frontend/
├── public/locales/
│   ├── en/common.json        (existing)
│   ├── es/common.json        (NEW)
│   ├── fr/common.json        (NEW)
│   ├── ja/common.json        (NEW)
│   ├── ar/common.json        (NEW)
│   └── pt/common.json        (NEW)
├── utils/
│   └── intlFormat.ts         (UPDATE)
├── lib/
│   └── i18n.ts              (UPDATE: add detection)
├── styles/
│   └── rtl.css              (UPDATE: fix gaps)
└── __tests__/
    └── rtl.test.tsx          (UPDATE)
    └── i18n.test.ts          (NEW: verify key parity)

backend/
├── src/routes/
│   └── accounts.js           (UPDATE: add preferences endpoint)
└── migrations/
    └── 013_user_preferences.js (NEW)
```

## Acceptance Criteria
- [ ] 5 complete translation files with 150+ keys each.
- [ ] All components render correctly in RTL mode (Arabic).
- [ ] Locale-aware number/date formatting for all languages.
- [ ] Language auto-detection works on first visit.
- [ ] Language preference persists across sessions.
- [ ] All existing tests pass, including RTL tests.
- [ ] LanguageSwitcher shows all 6 languages with native names.
