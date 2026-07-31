# Issue #19 — Theme Customization (Dark/Light/Accent Colors)

**Labels:** `frontend` `feature` `theme` `ux` `accessibility`

## Summary
Build a comprehensive theme customization system allowing users to choose between dark/light/system modes, custom accent colours, and font size preferences, persisted across sessions.

## Background
The app has `ThemeContext.tsx` for dark mode toggling, `ThemeToggle.tsx` component, and `high-contrast.css` for WCAG AAA support. The `tailwind.config.ts` defines the colour palette. Currently only "light" and "dark" modes are supported, with no accent colour customisation.

## Problem Statement
Users want to personalise their experience beyond simple dark/light mode. Custom accent colours improve brand alignment, and font size preferences improve accessibility. The app needs a proper theme management system.

## Objectives
1. Build a theme settings page with dark/light/system mode, accent colour picker, and font size selector.
2. Implement CSS variable-based theming for dynamic accent colours.
3. Add theme persistence (localStorage + backend sync).
4. Ensure all components respect theme variables.
5. Write tests and Storybook stories.

## Scope
- **In scope:** theme settings, accent colours, font sizes, CSS variables, persistence.
- **Out of scope:** custom CSS injection, community themes.

## Detailed Implementation Requirements

1. **CSS variable architecture:** Update `frontend/styles/globals.css`:
   - Define CSS custom properties for all themeable values: `--color-accent`, `--color-accent-hover`, `--color-bg-primary`, `--color-text-primary`, `--color-border`, etc.
   - Define 8 preset accent colours: Stellar (current blue), Emerald, Violet, Amber, Rose, Teal, Indigo, Slate.
   - Each accent defines: base, hover, light (10% bg), border variants.
   - Font size scale: small (14px base), medium (16px base, default), large (18px base).

2. **Theme context update:** Update `frontend/lib/ThemeContext.tsx`:
   - State: `mode` (light/dark/system), `accent` (preset name), `fontSize` (small/medium/large).
   - `system` mode: detect via `prefers-color-scheme` media query.
   - Apply theme by setting CSS variables on `document.documentElement`.
   - Persist to localStorage with key `finchippay:theme`.
   - Sync to backend via `PUT /api/users/:publicKey/preferences`.

3. **Theme settings UI:** Create `frontend/components/ThemeSettings.tsx`:
   - Mode selector: Light / Dark / System (radio buttons with preview thumbnails).
   - Accent colour picker: 8 preset colour swatches with live preview.
   - Font size selector: Small / Medium / Large with sample text preview.
   - "Reset to Defaults" button.

4. **Settings page integration:** Add theme settings to `frontend/pages/settings.tsx` as a new "Appearance" section.

5. **Component audit:** Ensure all components use CSS variables instead of hardcoded Tailwind colour classes. Key components to update:
   - `Navbar.tsx` — use `var(--color-bg-primary)` instead of `bg-white dark:bg-cosmos-950`.
   - `TransactionList.tsx` — border colours.
   - Dashboard cards — background colours.
   - Buttons — accent colour variants.

6. **High-contrast support:** Ensure the existing `high-contrast.css` works with custom accent colours. Add a "High contrast" toggle in theme settings.

7. **Tests:** Update `frontend/__tests__/ThemeToggle.test.tsx`, test theme persistence, accent colour application, system mode detection.

## Expected Architecture

```
frontend/
├── styles/
│   ├── globals.css            (UPDATE: CSS variables)
│   └── high-contrast.css      (UPDATE: accent-aware)
├── lib/
│   └── ThemeContext.tsx        (UPDATE: accent, fontSize, system mode)
├── components/
│   ├── ThemeToggle.tsx         (UPDATE: show current accent)
│   └── ThemeSettings.tsx       (NEW)
├── pages/
│   └── settings.tsx            (UPDATE: appearance tab)
└── __tests__/
    └── ThemeToggle.test.tsx    (UPDATE)
    └── ThemeSettings.test.tsx  (NEW)
```

## Acceptance Criteria
- [ ] Dark/Light/System mode toggle works correctly across all components.
- [ ] 8 preset accent colours are available and apply instantly.
- [ ] Font size setting (small/medium/large) affects all text elements.
- [ ] Theme preferences persist across page reloads and browser sessions.
- [ ] System mode follows OS preference and updates in real-time.
- [ ] High-contrast mode works with custom accent colours.
- [ ] All existing tests pass.
- [ ] Storybook stories updated for ThemeSettings.
