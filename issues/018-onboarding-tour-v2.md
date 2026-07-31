# Issue #18 — Onboarding Tour v2 with Analytics

**Labels:** `frontend` `feature` `onboarding` `ux` `analytics`

## Summary
Revamp the onboarding tour with interactive walkthrough steps, progress tracking, A/B testing capability, and analytics integration to measure completion rates and drop-off points.

## Background
The app has an `OnboardingTour` component (`frontend/components/OnboardingTour.tsx`) and `onboardingState.ts` library. The tour triggers on first wallet connection but is a simple modal overlay with basic steps. There's no progress tracking, analytics, or personalisation.

## Problem Statement
New users often get lost after the initial tour — there's no follow-up guidance, no way to track which features users engage with, and no data to improve the onboarding flow. Completion rates cannot be measured.

## Objectives
1. Redesign the onboarding tour with interactive step-by-step walkthrough.
2. Add progress tracking and analytics events.
3. Implement context-sensitive help and tips.
4. Add A/B testing infrastructure for onboarding flows.
5. Build an admin dashboard to view onboarding analytics.

## Scope
- **In scope:** interactive tour, analytics, A/B testing, context help, admin dashboard.
- **Out of scope:** video tutorials, interactive playground.

## Detailed Implementation Requirements

1. **Tour redesign:** Update `frontend/components/OnboardingTour.tsx`:
   - 8+ interactive steps: Connect Wallet, View Balance, Send Payment, Receive Payment, Explore Dashboard, Set Up Notifications, Manage Contacts, Visit Portfolio.
   - Each step highlights the target element with a spotlight overlay.
   - Progress bar showing step X of Y.
   - "Skip Tour" and "Remind Me Later" options.
   - Docking: tour can be minimised to a floating badge and resumed later.

2. **Analytics integration:** Create `frontend/lib/onboardingAnalytics.ts`:
   - Track events: `tour_started`, `step_viewed`, `step_completed`, `tour_completed`, `tour_skipped`, `tour_resumed`.
   - Send events to backend via `POST /api/analytics/onboarding`.
   - Store event metadata: timestamp, step_id, time_on_step, user_agent, screen_size.

3. **Context-sensitive help:** Create `frontend/components/ContextualHelp.tsx`:
   - Small "?" icon next to unfamiliar UI elements.
   - On click, shows a tooltip with brief explanation and optional link to relevant tour step.
   - Users can request "Take me to this tour step" which navigates to the tour.

4. **A/B testing:** Create `frontend/lib/featureVariants.ts`:
   - Simple A/B test framework: assign user to variant A or B based on publicKey hash.
   - Define test: "onboarding_v2_tour" with variants "sequential" (A) vs "choose-your-path" (B).
   - Record variant assignment in analytics events.
   - Store variant assignments in backend for analysis.

5. **Admin analytics dashboard:** Create `frontend/pages/admin/onboarding.tsx` (admin-only):
   - Tour completion rate over time (line chart).
   - Step-by-step drop-off funnel (bar chart).
   - A/B test comparison view.
   - Average time to complete tour.
   - Requires `requireAdmin` middleware on backend.

6. **Backend analytics:** Create `backend/src/services/onboardingAnalyticsService.js`:
   - `POST /api/analytics/onboarding` — receive and store events.
   - `GET /api/analytics/onboarding/summary` — aggregate stats (admin-only).
   - `GET /api/analytics/onboarding/funnel` — step-by-step funnel (admin-only).
   - Migration: `017_onboarding_analytics.js`.

7. **Tests:** Test analytics event capture, A/B variant assignment, admin dashboard rendering.

## Expected Architecture

```
frontend/
├── components/
│   ├── OnboardingTour.tsx       (UPDATE)
│   └── ContextualHelp.tsx       (NEW)
├── lib/
│   ├── onboardingAnalytics.ts  (NEW)
│   ├── onboardingState.ts      (UPDATE)
│   └── featureVariants.ts      (NEW)
├── pages/
│   └── admin/
│       └── onboarding.tsx       (NEW)
└── __tests__/
    └── onboarding.test.tsx     (UPDATE)

backend/
├── migrations/
│   └── 017_onboarding_analytics.js (NEW)
├── src/services/
│   └── onboardingAnalyticsService.js (NEW)
├── src/routes/
│   └── analytics.js            (UPDATE)
└── __tests__/
    └── onboardingAnalytics.test.js (NEW)
```

## Acceptance Criteria
- [ ] Interactive tour has 8+ steps with spotlight overlay.
- [ ] Tour can be minimised and resumed later.
- [ ] Analytics events captured for all tour interactions.
- [ ] A/B testing assigns users to variants and records results.
- [ ] Admin dashboard shows completion funnel and A/B comparison.
- [ ] Contextual help icons appear on key UI elements.
- [ ] All existing tests pass.
