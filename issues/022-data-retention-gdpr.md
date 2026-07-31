# Issue #22 — Data Retention and GDPR Compliance Service

**Labels:** `backend` `compliance` `gdpr` `new-service`

## Summary
Implement a data retention and GDPR compliance service that manages user data lifecycle, including data export, data deletion (right to be forgotten), consent management, and automated data purging.

## Background
The project has a `backend/src/services/dataRetentionService.js` that appears to be a stub. The app stores user data in PostgreSQL (webhooks, scheduled transactions, push subscriptions, contacts) and logs. There's no mechanism for users to request data export or account deletion.

## Problem Statement
For EU users and enterprise adoption, the app must comply with GDPR requirements including data export, right to deletion, consent records, and automated data purging based on retention policies.

## Objectives
1. Build a data export service that packages all user data.
2. Implement "right to be forgotten" data deletion.
3. Add consent management (tracking user consent for processing).
4. Implement automated data purging based on retention policies.
5. Add admin dashboard for managing data requests.

## Scope
- **In scope:** data export, data deletion, consent management, automated purging, admin dashboard.
- **Out of scope:** DPA agreements, data processing register.

## Detailed Implementation Requirements

1. **Data export service:** Create/update `backend/src/services/dataRetentionService.js`:
   - `exportUserData(publicKey)` collects: account info, transaction history, webhooks, push subscriptions, scheduled transactions, contacts, notification preferences, analytics events.
   - Package as JSON file (or ZIP for large exports).
   - Process export asynchronously — queue via Bull or in-process queue.
   - Email download link when ready (or return as direct download for small exports).
   - Endpoint: `POST /api/compliance/:publicKey/export-data`.

2. **Data deletion service:** Add to dataRetentionService.js:
   - `deleteUserData(publicKey, confirmPhrase)`:
     - Anonymise or delete from all tables: `webhooks`, `scheduled_transactions`, `push_subscriptions`, `refresh_tokens`, `contacts`, `notification_preferences`, `user_preferences`.
     - Keep transaction references (can't delete Horizon data) but anonymise any PII.
     - Log deletion event for audit trail.
     - Requires confirmation phrase: `"DELETE my account forever"`.
   - Endpoint: `DELETE /api/compliance/:publicKey/data?confirm=...`.

3. **Consent management:** Create `backend/src/services/consentService.js`:
   - Record consent events: `{ publicKey, consentType, granted (boolean), timestamp, ipAddress }`.
   - Consent types: `data_processing`, `email_notifications`, `push_notifications`, `analytics_cookies`.
   - `GET /api/compliance/:publicKey/consents` — list consent records.
   - `POST /api/compliance/:publicKey/consents` — record consent.
   - Migration: `019_consent_records.js`.

4. **Automated purging:** Create `backend/src/jobs/dataPurgeJob.js`:
   - Scheduled job (runs daily via cron or node-schedule).
   - Purge expired refresh tokens (older than 90 days).
   - Purge unverified accounts (no activity in 1 year).
   - Anonymise webhook event payloads older than 90 days (retain metadata only).
   - Delete soft-deleted data after 30 days.
   - Log purge results with counts.

5. **Admin dashboard:** Create admin-only compliance dashboard:
   - View pending data export/deletion requests.
   - Manual trigger for data purging.
   - View consent records by user.
   - Retention policy configuration UI.

6. **Frontend compliance page:** Create `frontend/pages/settings/compliance.tsx`:
   - "Download My Data" button.
   - "Delete My Account" section with confirmation phrase.
   - Consent management toggles.
   - Privacy policy link.

7. **Tests:** Test data export packaging, deletion anonymisation, consent recording, automated purge logic.

## Expected Architecture

```
backend/
├── migrations/
│   ├── 019_consent_records.js       (NEW)
│   └── 020_data_retention_policy.js (NEW)
├── src/services/
│   ├── dataRetentionService.js      (UPDATE)
│   └── consentService.js            (NEW)
├── src/jobs/
│   └── dataPurgeJob.js              (NEW)
├── src/routes/
│   └── compliance.js                (NEW)
└── __tests__/
    ├── dataRetention.test.js        (UPDATE)
    └── consentService.test.js       (NEW)

frontend/
├── pages/
│   └── settings/
│       └── compliance.tsx           (NEW)
└── components/
    └── ConsentManager.tsx           (NEW)
```

## Acceptance Criteria
- [ ] `POST /api/compliance/:publicKey/export-data` returns a JSON package of all user data.
- [ ] `DELETE /api/compliance/:publicKey/data` anonymises/deletes all PII across all tables.
- [ ] Consent records are stored with timestamps and can be queried per user.
- [ ] Automated purge job runs daily and follows configured retention policies.
- [ ] Admin dashboard shows compliance data and allows manual purge.
- [ ] All existing tests pass.
