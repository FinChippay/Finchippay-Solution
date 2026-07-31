# Issue #20 — Accessibility Audit and WCAG 2.1 AA Compliance

**Labels:** `frontend` `accessibility` `audit` `wcag`

## Summary
Conduct a comprehensive WCAG 2.1 AA accessibility audit across all pages and components, fix identified issues, add automated accessibility testing to CI, and create an accessibility statement.

## Background
The project has partial accessibility: some ARIA labels exist, keyboard navigation works in some components, and `high-contrast.css` provides contrast support. However, there's no systematic accessibility testing, no axe-core integration, and many components lack proper focus management, screen reader announcements, and keyboard support.

## Problem Statement
Without accessibility compliance, the app excludes users with disabilities and may face legal/compliance issues for government or enterprise adoption.

## Objectives
1. Run axe-core audit on all pages and identify violations.
2. Fix all critical and serious WCAG 2.1 AA violations.
3. Add automated accessibility testing to CI.
4. Add skip navigation, focus management, and screen reader announcements.
5. Create an accessibility statement page.

## Scope
- **In scope:** WCAG 2.1 AA audit, automated testing, keyboard navigation, screen reader support.
- **Out of scope:** WCAG AAA compliance, assistive technology user testing.

## Detailed Implementation Requirements

1. **Accessibility audit:**
   - Install `@axe-core/react` and run audit on every page.
   - Categorise issues: Critical, Serious, Moderate, Minor.
   - Document each issue with component, WCAG criterion, and suggested fix.
   - Expected minimum: 50+ issues identified across 20+ components.

2. **Fix Critical/Serious issues:**
   - **Focus management:** Ensure logical tab order. Add `tabIndex` management for modals, dropdowns, and dynamic content. Implement focus trapping in modals.
   - **ARIA labels:** Add `aria-label` or `aria-labelledby` to all interactive elements (buttons, inputs, navigation items).
   - **Colour contrast:** Audit all text/background combinations. Ensure ≥4.5:1 for normal text, ≥3:1 for large text.
   - **Form labels:** Ensure all form inputs have associated `<label>` elements.
   - **Error announcements:** Use `aria-live="polite"` or `aria-live="assertive"` for form errors and toast notifications.
   - **Image alt text:** Ensure all `<img>` and icon SVGs have appropriate alt text or `aria-hidden="true"`.

3. **Keyboard navigation:**
   - All interactive elements must be keyboard accessible.
   - Add visible focus indicators (not just browser defaults).
   - Implement arrow key navigation for lists, dropdowns, and tables.
   - Add skip-to-content link at the top of every page.

4. **Screen reader announcements:**
   - Create a `frontend/components/ScreenReaderAnnouncements.tsx` component that uses `aria-live="polite"` region for dynamic updates.
   - Announce: transaction confirmations, balance changes, errors, navigation changes.

5. **Automated accessibility testing:**
   - Add `jest-axe` to `frontend/jest.config.ts`.
   - Create `frontend/__tests__/accessibility.test.tsx` that runs axe-core on all components.
   - Add Playwright accessibility checks to e2e tests: `await expect(page).toHaveNoViolations()`.
   - Add CI step in `.github/workflows/ci.yml` to run accessibility checks.

6. **Accessibility statement:** Create `frontend/pages/accessibility.tsx`:
   - WCAG 2.1 AA conformance claim.
   - Known limitations and workarounds.
   - Contact information for accessibility issues.
   - Date of last audit.

7. **Component-specific fixes (minimum):**
   - `Navbar.tsx`: mobile menu keyboard navigation, aria-current for active link.
   - `TransactionList.tsx`: tabIndex for rows, keyboard activation.
   - `MultiSigFlow.tsx`: step indicator aria attributes.
   - `TradeForm.tsx`: token selector keyboard support.
   - All modals: focus trap, escape to close, aria-modal.

## Expected Architecture

```
frontend/
├── components/
│   └── ScreenReaderAnnouncements.tsx (NEW)
├── pages/
│   └── accessibility.tsx              (NEW)
├── __tests__/
│   └── accessibility.test.tsx        (NEW)
└── e2e/
    └── accessibility.spec.ts         (NEW)

.github/workflows/
└── ci.yml                            (UPDATE: add axe check)
```

## Acceptance Criteria
- [ ] axe-core audit shows 0 Critical and 0 Serious violations across all pages.
- [ ] All interactive elements are keyboard accessible with visible focus indicators.
- [ ] Skip-to-content link present on every page.
- [ ] All form inputs have associated label elements.
- [ ] All images and icons have appropriate alt text or aria-hidden.
- [ ] Automated accessibility tests run in CI.
- [ ] All existing tests pass.
- [ ] Accessibility statement page is published.
