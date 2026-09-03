# Architecture — Feature-Based Structure

Trackitdown uses a **feature-based (vertical slice) structure**. Code is
grouped by what it does for the user, not by what kind of file it is.
Anyone opening the repo should be able to find "everything about sightings"
in one folder.

## Top-level layout

```
trackitdown/
├── app/                      # Expo Router route files ONLY (thin wrappers)
├── src/
│   ├── features/            # ⚠️ RECONCILED 2026-09-03 against `ls src/features`
│   │   ├── auth/             # sign up, sign in, session, onboarding
│   │   ├── chat/             # owner ↔ spotter messaging (Supabase Realtime)
│   │   ├── garage/           # saved cars, and posting one in a couple of taps
│   │   ├── legal/            # terms / privacy / safety, in-app and exported
│   │   ├── notifications/    # push registration, alerts, notification centre
│   │   ├── payments/         # bounty escrow, payouts, Stripe Connect UI
│   │   ├── permissions/      # device permission state (location, camera, push)
│   │   ├── profile/          # user profile, reputation, badges
│   │   ├── search-map/       # map + list search of active stolen cars
│   │   ├── sightings/        # reporting + viewing sightings
│   │   ├── vehicles/         # posting a stolen car, post detail, recovery
│   │   └── watchlist/        # saved posts and the named lists they file into
│   │                         # ⚠️ NO `moderation/`. This tree listed one until
│   │                         #   2026-09-03 and it has never existed — there is
│   │                         #   no role, no queue reader and no route (review
│   │                         #   finding #22). OPERATIONS.md §1–5 is the only
│   │                         #   thing that reads those tables, by hand.
│   └── shared/
│       ├── ui/               # design-system components (Button, Card, …)
│       ├── theme/            # tokens: colors, spacing, typography, radii
│       ├── api/              # Supabase client, typed query helpers
│       ├── hooks/            # generic hooks (useDebounce, useLocation, …)
│       ├── lib/              # pure utilities (plate validation, dates, …)
│       ├── types/            # cross-feature domain types
│       └── wizard/           # config-driven full-screen wizard framework
│                             #   (phases → steps; powers stepper flows)
├── supabase/
│   ├── migrations/           # SQL migrations (source of truth for schema)
│   └── functions/            # Edge Functions — 19. The money ones are
│                             #   stripe-webhook, create-payment-intent,
│                             #   refund-recovery, release-payout and
│                             #   release-held-refunds (the ONLY scheduled
│                             #   process in the system — OPERATIONS §7).
│                             #   ⚠️ `confirm-recovery` was listed here until
│                             #   2026-09-03 and has never existed; recovery is
│                             #   claim_recovery (SQL) + refund-recovery.
├── docs/                     # the documents referenced by CLAUDE.md
└── .claude/agents/           # Claude Code subagents
```

## Inside a feature folder

Every feature follows the same internal shape (omit folders it doesn't need):

```
src/features/sightings/
├── components/       # UI used only by this feature
├── screens/          # full screens, imported by app/ route files
├── hooks/            # feature-specific hooks (useReportSighting, …)
├── api/              # Supabase queries/mutations for this feature
├── types.ts          # types owned by this feature
└── index.ts          # PUBLIC API — the only file other features import
```

## The rules

> **Rules 1 and 2 are ENFORCED since 2026-09-03** — `no-restricted-imports` in
> `eslint.config.js`, so CI fails on a violation. Until then they were honour
> system, and the honour system had quietly lost in six places. Rule 1 has one
> sanctioned `eslint-disable`, in `useMyAlerts` (the auth barrel drags
> AsyncStorage into two plain api modules); it names its reason. Rule 2 had
> zero violations and still does.

1. **Features never deep-import each other.** `features/chat` may import
   from `features/sightings` **only via** `features/sightings/index.ts`.
   If two features need the same thing constantly, it probably belongs in
   `shared/`.
   *This is not theoretical — enforcing it moved three things down to
   `shared/lib` on the first day: `bountyBounds` (three features reached past
   the vehicles barrel for the bounty range), `browsingSource`, and
   `functionError`, which decodes any Edge Function error and had nothing
   payments-specific about it.*
   A feature importing ITSELF uses relative paths, and nested sub-features
   (`vehicles/post`) are the same feature — reach them with `../`, not the
   `@/features` alias.
2. **`shared/` never imports from `features/`.** Dependency direction is
   one-way: `app/ → features/ → shared/`.
3. **Route files in `app/` are thin.** They import a screen from a feature
   and render it. No business logic in `app/`.
4. **The database is the source of truth for domain state.** Post status,
   bounty amounts, and payout state live in Postgres and change only via
   Edge Functions / RPC (see `docs/DOMAIN.md`).
5. **Each feature folder gets a short `README.md`** (5–15 lines): what the
   feature does, its screens, its tables, its Edge Functions.

## "Where does this code go?" decision guide

| You are writing… | It goes in… |
|---|---|
| A screen for reporting a sighting | `features/sightings/screens/` |
| A button style used across the app | `shared/ui/` |
| UK number-plate validation | `shared/lib/plates.ts` |
| A Supabase query fetching one post | `features/vehicles/api/` |
| The Stripe webhook handler | `supabase/functions/stripe-webhook/` |
| A colour value | Nowhere — use a token from `shared/theme/` |
| A type used by 3+ features | `shared/types/` |
| A type used by one feature | that feature's `types.ts` |

When genuinely unsure, prefer putting it **inside the feature** and promote
to `shared/` later once a second feature needs it. Premature sharing is
worse than duplication.

## Naming conventions

- Folders: `kebab-case`. Components: `PascalCase.tsx`. Hooks: `useThing.ts`.
- Database: `snake_case` tables and columns, singular Edge Function names
  describing the action (`release-payout`, not `payments2`).
- One component per file; the file is named after the component.
