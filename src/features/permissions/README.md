# permissions

Startup permission prompts, **native-only**: once per cold start, after the
app lands in the tabs (new users: right after onboarding), the app checks
location, camera, photo library, and notification permissions and fires the
**OS dialogs directly**, one at a time, for whatever is ungranted and still
askable. There is no custom permissions screen — a gate page existed briefly
and was removed by product call (2026-07-21): the OS prompts are the ask.

- Kinds the OS has blocked (`canAskAgain=false`) are skipped — requesting
  them auto-resolves to denied without showing anything. The in-flow primers
  (`CameraCapture`, the sighting location primer, Edit Profile's photo-access
  sheet) remain the recovery path to Settings.
- Prompts re-fire each cold start until granted; never more than once per
  session.

## Shape

- `lib/devicePermissions.ts` — lazy-require adapter: silent `checkAll()` +
  prompting `request(kind)`. A missing/broken expo module degrades to
  `'unavailable'`, which is never requested.
- `hooks/useStartupPermissionRequests.ts` — the once-per-start sequential
  prompt chain, enabled by `AuthGate` when the route resolves to `'app'`.

## Wiring

`src/features/auth/components/AuthGate.tsx` calls
`useStartupPermissionRequests(route === 'app')`. Requires the
`expo-notifications` module + plugin (app.config.ts) for the notifications
prompt.
