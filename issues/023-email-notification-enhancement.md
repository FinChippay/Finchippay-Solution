# Issue #23 — Email Notification Service Enhancement

**Labels:** `backend` `feature` `email` `notifications`

## Summary
Enhance the existing email notification service with transactional email templates, delivery tracking, unsubscribe management, and integration with notification preferences.

## Background
The backend has `emailTemplates.js`, `notificationService.js`, and `migrations/012_notification_email_preferences.js`. There's basic email support but it's not fully integrated with the notification system, lacks delivery tracking, and has limited template support.

## Problem Statement
Users cannot receive email notifications for important events (incoming payments, escrow releases, scheduled transaction execution) because the email service is not fully integrated with the notification pipeline and lacks delivery infrastructure.

## Objectives
1. Create production-ready email templates using a template engine (Handlebars/MJML).
2. Add delivery tracking (sent, delivered, bounced, opened).
3. Implement unsubscribe management (list-unsubscribe header + preference page).
4. Integrate with notification preferences (Issue #15).
5. Add email verification flow.

## Scope
- **In scope:** email templates, delivery tracking, unsubscribe, preference integration, verification.
- **Out of scope:** email provider abstraction (use existing Nodemailer/SendGrid config).

## Detailed Implementation Requirements

1. **Template engine:** Create `backend/src/services/emailRenderer.js`:
   - Use Handlebars for server-side email rendering.
   - Templates: `welcome`, `payment_received`, `payment_sent`, `escrow_released`, `stream_claimed`, `scheduled_txn_executed`, `price_alert`, `security_alert`, `email_verification`.
   - Each template: HTML + plain text version.
   - Responsive email design (tested on mobile/desktop email clients).
   - Company branding: logo, colours, footer with unsubscribe link.

2. **Delivery tracking:** Create `backend/src/services/emailTrackingService.js`:
   - Add tracking pixel to HTML emails (1x1 transparent GIF with unique ID).
   - Track delivery, open, click events via custom webhook endpoint.
   - Store events in `email_events` table: `{ email_id, event_type, timestamp, user_agent, ip }`.
   - Bounce handling: mark email as bounced after 3 hard bounces.
   - Migration: `021_email_events.js`.

3. **Unsubscribe management:**
   - Add `List-Unsubscribe: <mailto:...>, <https://...>` header to all emails.
   - Create unsubscribe endpoint: `GET /api/emails/unsubscribe?token=...` (one-click).
   - Store unsubscribe preferences: `{ email, unsubscribed_at, reason }`.
   - Unsubscribe from all or per-category.

4. **Notification integration:** Update `notificationService.js`:
   - When a notification event occurs, check user's email notification preference.
   - If enabled, render appropriate template and send via configured email provider.
   - Batch emails: aggregate multiple events into daily digest if >3 events/hour.

5. **Email verification:** Create `backend/src/services/emailVerificationService.js`:
   - `POST /api/emails/:publicKey/verify` — sends verification email with token.
   - `POST /api/emails/:publicKey/confirm` — verifies token, marks email as confirmed.
   - Store verified email in `user_preferences` table.
   - Require verified email for email notifications.

6. **Queue processing:** Use the existing executor pattern (from `scheduledExecutor.js`) to process email send queue asynchronously. Retry failed sends 3 times with exponential backoff.

7. **Tests:** Test template rendering, delivery tracking, unsubscribe, email verification flow, bounce handling.

## Expected Architecture

```
backend/
├── migrations/
│   └── 021_email_events.js           (NEW)
├── src/services/
│   ├── emailRenderer.js              (NEW)
│   ├── emailTrackingService.js       (NEW)
│   ├── emailVerificationService.js   (NEW)
│   └── notificationService.js        (UPDATE)
├── templates/
│   ├── payment_received.hbs          (NEW)
│   ├── payment_sent.hbs              (NEW)
│   ├── escrow_released.hbs           (NEW)
│   ├── stream_claimed.hbs            (NEW)
│   ├── welcome.hbs                   (NEW)
│   ├── email_verification.hbs        (NEW)
│   └── unsubscribe.hbs               (NEW)
├── src/routes/
│   └── emails.js                     (NEW)
└── __tests__/
    ├── emailRenderer.test.js         (NEW)
    └── emailTracking.test.js         (NEW)
```

## Acceptance Criteria
- [ ] 9 email templates rendered with correct branding and responsive design.
- [ ] Delivery tracking records sent, delivered, opened, bounced events.
- [ ] List-Unsubscribe header present on all emails.
- [ ] Unsubscribe endpoint works (one-click).
- [ ] Emails are only sent to verified addresses with notification preference enabled.
- [ ] Email verification flow complete (send → verify → confirm).
- [ ] Failed sends are retried 3 times with exponential backoff.
- [ ] All existing tests pass.
