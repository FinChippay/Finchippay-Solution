# Issue #15 — Notification Preferences UI and Management Dashboard

**Labels:** `frontend` `feature` `notifications` `ux`

## Summary
Build a comprehensive notification preferences dashboard allowing users to control which events trigger notifications, choose delivery channels (push, email, in-app), set quiet hours, and view notification history.

## Background
The app has push notification support via `frontend/lib/pushNotifications.ts`, a `PushNotificationPrompt` component, and a toggle on the dashboard. The backend has `notificationService.js`, `pushService.js`, `pushNotifier.js`, and `emailTemplates.js`. However, there's no unified preferences UI — notifications are all-or-nothing.

## Problem Statement
Users cannot control which events trigger notifications (e.g., only incoming payments, not price alerts), choose delivery channels (push vs email), set quiet hours, or view notification history.

## Objectives
1. Build a notification preferences page at `/settings/notifications`.
2. Implement per-event-type notification toggles.
3. Add quiet hours scheduling.
4. Add notification history viewer.
5. Wire backend to respect preferences.

## Scope
- **In scope:** preferences UI, event-type filtering, quiet hours, history, backend integration.
- **Out of scope:** SMS notifications, custom notification sounds.

## Detailed Implementation Requirements

1. **Preferences schema:** Define notification preference types:
   - Event types: `incoming_payment`, `outgoing_payment`, `escrow_release`, `stream_claim`, `multi_sig_approval`, `price_alert`, `scheduled_payment`, `contract_event`.
   - Channels: `push` (browser), `email` (if configured), `in_app` (dashboard bubble).
   - Per event-type: which channels are active.
   - Global settings: quiet_hours_enabled, quiet_hours_start (HH:mm), quiet_hours_end (HH:mm), timezone.

2. **Frontend preferences UI:** Create `frontend/components/NotificationPreferences.tsx`:
   - Event-type list with toggle switches for each channel (push/email/in-app).
   - Quiet hours time picker with timezone selector.
   - "Test Notification" button for each channel.
   - Save/Cancel buttons.
   - Visual hierarchy: grouped by category (Payments, Contract, Alerts).

3. **Notification history:** Create `frontend/components/NotificationHistory.tsx`:
   - Reverse-chronological list of past notifications.
   - Each item: timestamp, event type, message, channel, read/unread status.
   - Mark as read on click.
   - "Clear All" button.

4. **Backend integration:**
   - Create `backend/migrations/015_notification_preferences.js`.
   - Add `GET/PUT /api/notifications/:publicKey/preferences` endpoints.
   - Add `GET /api/notifications/:publicKey/history?page=&limit=` endpoint.
   - Update `notificationService.js` to check preferences before sending.
   - Respect quiet hours — queue notifications during quiet hours and deliver when they end.

5. **Settings page integration:** Add notification preferences to `frontend/pages/settings.tsx` with a new "Notifications" tab/section.

6. **Tests:** Test preference toggles, quiet hours filtering, history pagination, backend preference validation.

## Expected Architecture

```
frontend/
├── components/
│   ├── NotificationPreferences.tsx  (NEW)
│   └── NotificationHistory.tsx     (NEW)
├── pages/
│   └── settings.tsx                (UPDATE: add notifications tab)
└── __tests__/
    └── notification-preferences.test.tsx (NEW)

backend/
├── migrations/
│   └── 015_notification_preferences.js (NEW)
├── src/routes/
│   └── notifications.js            (UPDATE: preferences endpoints)
└── src/services/
    └── notificationService.js      (UPDATE: respect preferences)
```

## Acceptance Criteria
- [ ] Preferences page shows all event types grouped by category.
- [ ] Each event type has independent push/email/in-app toggles.
- [ ] Quiet hours setting works — notifications are queued during quiet hours.
- [ ] Notification history shows past notifications with read/unread status.
- [ ] Backend respects preferences and quiet hours.
- [ ] Test notification button sends a sample notification via each channel.
- [ ] All existing tests pass.
