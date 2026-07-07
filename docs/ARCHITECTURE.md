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
│   ├── features/
│   │   ├── auth/             # sign up, sign in, session, onboarding
│   │   ├── vehicles/         # posting a stolen car, verification, post detail
│   │   ├── sightings/        # reporting + viewing sightings
│   │   ├── search-map/       # map + list search of active stolen cars
│   │   ├── notifications/    # push registration, alert radius settings
│   │   ├── payments/         # bounty escrow, payouts, Stripe Connect UI
│   │   ├── chat/             # owner ↔ spotter messaging (Supabase Realtime)
│   │   ├── profile/          # user profile, reputation, badges
│   │   └── moderation/       # admin review queues (verification, reports)
│   └── shared/
│       ├── ui/               # design-system components (Button, Card, …)
│       ├── theme/            # tokens: colors, spacing, typography, radii
│       ├── api/              # Supabase client, typed query helpers
│       ├── hooks/            # generic hooks (useDebounce, useLocation, …)
│       ├── lib/              # pure utilities (plate validation, dates, …)
│       └── types/            # cross-feature domain types
├── supabase/
│   ├── migrations/           # SQL migrations (source of truth for schema)
│   └── functions/            # Edge Functions (stripe-webhook, notify-spotters,
│                             #   confirm-recovery, release-payout, …)
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

1. **Features never deep-import each other.** `features/chat` may import
   from `features/sightings` **only via** `features/sightings/index.ts`.
   If two features need the same thing constantly, it probably belongs in
   `shared/`.
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
