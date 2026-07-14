## Summary

This PR adds Turrets server-side signing support to the frontend settings page, allowing users to deploy DCA and stop-loss txFunctions through the existing backend challenge/verification flow.

## Type of change

- [ ] Bug fix
- [x] New feature
- [ ] Documentation update
- [ ] Refactor / chore
- [ ] Smart contract change

## Related issue

Closes #282

## Changes

- Added Turrets UI to `frontend/pages/settings.tsx`
- Integrated Turrets challenge creation and deploy flow with Freighter signing
- Added deployment list, refresh, pause/resume buttons, and status display

## Testing

- [ ] Tested locally on Testnet
- [ ] Added/updated unit tests
- [x] Manually tested UI flow

## Screenshots (if UI change)

<!-- Add before/after screenshots -->

## Checklist

- [x] My code follows the project style
- [ ] I've updated docs if needed
- [x] No console errors or warnings
- [x] I've rebased on latest `main`
