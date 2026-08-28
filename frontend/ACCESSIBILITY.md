# Accessibility (a11y) Features

Finchippay-Solution is committed to WCAG 2.1 AA compliance. This document outlines the accessibility features implemented across the application.

## Skip-to-Content Navigation

A **Skip to content** link is the first focusable element on every page, allowing keyboard and screen reader users to bypass the navigation bar and jump directly to the main content area.

## Keyboard Navigation

- All interactive elements (buttons, links, form controls) are keyboard accessible via `Tab`, `Enter`, `Space`, and `Escape` keys.
- Modals trap focus while open and close on `Escape` key press.
- Multi-step flows (e.g., MultiSigFlow) follow a logical tab order.
- Focus indicators are visible on all interactive elements using `focus-visible:ring-2` Tailwind utility classes.

## ARIA Attributes

- **roles**: `dialog`, `alert`, `progressbar`, `img`, `status` are used where appropriate.
- **aria-modal**: Applied to modal dialogs to indicate focus should remain within the modal.
- **aria-labelledby / aria-label**: All interactive elements have accessible names.
- **aria-live="polite"**: Dynamic content changes (status messages, errors, success notifications) are announced by screen readers.
- **aria-valuenow / aria-valuemin / aria-valuemax**: Progress bars and sliders have appropriate value attributes.

## Form Inputs

- All form inputs have associated `<label>` elements.
- Validation errors are programmatically associated with inputs.
- Required fields are clearly indicated.

## Color & Contrast

- Color is never the only means of conveying information (e.g., status badges use icons alongside color).
- Text and background colors meet WCAG AA contrast ratio requirements.
- The application supports both light and dark themes.

## Focus Management

- Focused elements have visible 2px rings using `focus-visible:ring-2` classes.
- Modal focus is trapped to prevent focus from escaping the modal.
- Error states receive focus for screen reader announcement.

## Screen Reader Announcements

- `aria-live="polite"` regions announce status changes (payment status, batch progress, errors).
- `aria-live="assertive"` used for critical alerts.
- Dynamic content updates are announced without disrupting the user's current task.

## Automated Testing

All pages and major components are tested with `jest-axe` to ensure no accessibility violations are introduced. Run the tests with:

```bash
cd frontend && npm test -- --testPathPattern=a11y
```

## Visual Regression Testing

Automated screenshot comparison tests catch CSS regressions (layout shifts, broken responsive design, z-index issues) before they reach users. Tests run at both desktop (1280×720) and mobile (iPhone 14) viewports.

### Running Visual Tests

```bash
# Run visual regression tests (compares against baselines)
cd frontend && npm run test:visual

# Update baselines after an intentional layout change
cd frontend && npx playwright test e2e/visual-regression.spec.ts --update-snapshots
```

### Pages Covered

| Page | Route | Auth Required |
|------|-------|---------------|
| Landing | `/` | No |
| Dashboard (logged out) | `/dashboard` | No |
| Dashboard (logged in) | `/dashboard` | Yes |
| Send Payment | `/pay` | Yes |
| Escrow | `/escrow` | Yes |
| Transaction List | `/transactions` | Yes |
| Portfolio | `/portfolio` | Yes |

### Updating Baselines

When an intentional UI change is made:

1. Run `npx playwright test e2e/visual-regression.spec.ts --update-snapshots` locally.
2. Review the updated screenshots in `e2e/__screenshots__/`.
3. Commit the updated baseline images along with the code change.

The CI step fails when a visual diff exceeds **1% pixel difference**. Animations are disabled during tests to prevent false positives.

## Manual Testing Checklist

- [ ] Navigate all pages using only the keyboard (Tab, Shift+Tab, Enter, Space, Escape).
- [ ] Verify all modals trap focus and close on Escape.
- [ ] Test with screen reader (VoiceOver, NVDA, or JAWS).
- [ ] Verify skip-to-content link is visible on focus.
- [ ] Check color contrast for all text and interactive elements.
- [ ] Ensure all error messages are announced by screen readers.
- [ ] Test zoom at 200% — content should not overflow or clip.
