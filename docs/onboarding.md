# Onboarding Tour

> Issue #254 — Interactive first-time user onboarding tour.

The onboarding tour is a step-by-step guided walkthrough powered by [react-joyride](https://react-joyride.com/) that introduces first-time users to the key features of Finchippay.

## Tour Steps

The tour consists of **5 steps** that highlight the core UI elements:

| Step | Target element | Topic |
|------|----------------|-------|
| 1 | `[data-tour="wallet-connect"]` | Connect your Freighter wallet |
| 2 | `[data-tour="dashboard"]` | Your dashboard (balances, charts, quick actions) |
| 3 | `[data-tour="send-payment"]` | Send your first payment |
| 4 | `[data-tour="escrow"]` | Explore time-locked escrow |
| 5 | `[data-tour="streaming-payments"]` | Try streaming payments |

Each step uses `disableBeacon: true` so the spotlight appears immediately without an animated beacon dot.

## Onboarding Flow

```
First visit
    │
    ▼
No localStorage entries found
    │
    ▼
Tour auto-starts at step 1
    │
    ├──► User completes all steps ──► Tour marked complete, auto-start disabled
    │
    └──► User skips / closes ────────► Step index saved, "Resume Tour" banner shown
                                            │
                                            ├──► User clicks "Resume Tour" ──► Tour resumes from saved step
                                            │
                                            └──► User clicks "Don't show again" ──► Auto-start permanently disabled
```

## Persistence Behaviour

Tour state is persisted in `localStorage` using three keys:

| Key | Type | Description |
|-----|------|-------------|
| `finchippay:onboarding:completed` | `"true"` / absent | Set when the user finishes all 5 steps |
| `finchippay:onboarding:dismissed` | `"true"` / absent | Set when the user clicks "Don't show again" |
| `finchippay:onboarding:step` | `"0"` – `"4"` | The last step index the user reached |

Progress is **never lost on page refresh** — the hook reads all three keys on mount.

### Auto-start rules

| Condition | Behaviour |
|-----------|-----------|
| All keys absent (first visit) | Tour starts automatically at step 0 |
| `step > 0`, not completed, not dismissed | Resume banner shown; tour does not auto-start |
| `completed = "true"` | Tour does not auto-start |
| `dismissed = "true"` | Tour does not auto-start |

## Resume Behaviour

When the user closes or skips the tour mid-way:

1. The current step index is written to `finchippay:onboarding:step`.
2. The tour overlay is hidden.
3. A **"Resume Tour"** banner appears in the bottom-right corner of the screen.
4. Clicking **Resume Tour** restarts the tour from the saved step.
5. Clicking **Don't show again** sets `finchippay:onboarding:dismissed = "true"` and hides the banner permanently.

## Manual Launch

Users can restart the tour at any time via the **Navbar Help menu**:

1. Click the **Help** button (question-mark icon) in the top navigation bar.
2. Select **Take a Tour** from the dropdown.

This is also available in the **mobile menu** under the navigation links section.

The `onTakeTour` callback is wired through `NavbarProps` and supplied by `_app.tsx` via the `useOnboardingTour` hook, so the tour can be launched from the Navbar without introducing additional global state.

## Disabling Auto-Start

Auto-start can be permanently disabled in two ways:

1. **Complete the tour** — finish all 5 steps. The `completed` flag is written and the tour never auto-starts again.
2. **Click "Don't show again"** — on the resume banner. The `dismissed` flag is written immediately.

To re-enable the tour for testing or debugging, clear the relevant `localStorage` keys:

```js
localStorage.removeItem('finchippay:onboarding:completed');
localStorage.removeItem('finchippay:onboarding:dismissed');
localStorage.removeItem('finchippay:onboarding:step');
```

## Implementation Files

| File | Purpose |
|------|---------|
| `frontend/components/OnboardingTour.tsx` | React component — renders the Joyride overlay and resume banner |
| `frontend/hooks/useOnboardingTour.ts` | State management hook with localStorage persistence |
| `frontend/components/Navbar.tsx` | Navbar with "Take a Tour" in the Help menu (desktop + mobile) |
| `frontend/pages/_app.tsx` | Wires the hook and passes `startTour` to `<Navbar>` |
| `frontend/__tests__/onboarding.test.tsx` | 28 unit tests covering all onboarding scenarios |

## Testing

Run the onboarding tests:

```bash
cd frontend
npx jest --testPathPatterns="onboarding" --no-coverage
```

The test suite covers:

- First visit auto-start
- Resume after interruption
- localStorage persistence (step, completed, dismissed)
- Skip functionality
- Don't show again
- Manual launch via Navbar
- Step progression (next, prev, setStepIndex)
- Completion state
