# ADR-0010 — Whitelabel payout onboarding on Accounts v2 recipient configuration

**Status:** accepted · **Date:** 2026-08-03 · Supersedes the onboarding-surface
decisions of ADR-0002 (the escrow/charge decisions there stand unchanged)

## Context

Spotter payout setup has been through three shapes in one day: hosted Account
Links in a browser (rejected: the bounce-out is the clunkiest moment in the
product), Stripe's embedded `ConnectAccountOnboarding` in-app (shipped), and a
native prefill form covering what Stripe's window allows (shipped). Even the
best of these keeps two pieces of Stripe UI the owner explicitly does not want:
the mandatory Stripe sign-in popup, and Stripe's own form for the remainder.

Both exist because our accounts carry the Express dashboard, which forces
`requirements_collector: stripe`. Removing them was previously rejected on the
basis that platform-owned collection meant Custom-account KYC — document and
liveness collection up front, full compliance ownership — "a compliance
function, not a feature".

Fresh research against current Stripe documentation (2026-08-03) changed the
facts underneath that rejection:

- **Accounts v2 with the `recipient` configuration is GA for Connect** (API
  `2025-12-15.clover`). Not the Global Payouts preview — that is a different,
  non-Connect product that also uses v2 accounts; do not confuse them.
- For a **UK individual receiving only transfers**, baseline identity is
  **name + date of birth + address**. No document, no selfie, unless data
  verification fails or risk fires. Requirements are dynamic: read
  `requirements.entries`, satisfy what restricts capabilities.
- **Identity can be tokenised client-side** (v2 account/person tokens, created
  with the publishable key, plain REST — no SDK wrapper needed) and **bank
  details can be tokenised client-side** (the RN SDK's
  `createToken({type:'BankAccount'})`). Under this model **no PII or bank data
  touches our server at all** — strictly better than the transit-only form we
  ship today.
- **The residual hard limit survives v2**: `proof_of_liveness` and risk-review
  `challenge` requirements can NEVER be satisfied via the API, under any
  account configuration. A Stripe surface (remediation link / hosted flow /
  Identity SDK) must exist as a fallback, even if it is rarely shown.
- `requirements_collector` is now **derived, not set**: the platform owns
  collection exactly when `losses_collector: application` (we already are) AND
  `dashboard: none` (we must drop the Express dashboard).
- v1 and v2 accounts coexist; v1 `transfers.create` pays v2 recipients;
  `account.updated` still fires alongside v2 thin events. The escrow side is
  untouched.
- Server prerequisite: **stripe-node ≥ 20.2** for the V2 namespace. We pin
  17.5.0 — a four-major upgrade underneath the working escrow path.

## Decision

1. **New payee accounts are Accounts v2 with the `recipient` configuration**:
   `stripe_balance.stripe_transfers` capability, `dashboard: none`,
   fees + losses on the platform. We become the requirements collector.
2. **All happy-path collection happens in our own native UI.** Identity goes
   directly from the app to Stripe as a v2 account token; bank details go
   directly as a client-created bank token. Our server handles ids and status,
   never the data. `submit-payout-details`' transit role retires with this.
3. **The payout-setup moment moves to CREDIT time** — the "you've earned £X"
   screen is the entry point, per DOMAIN's existing rule, now with a push
   behind it.
4. **Payouts release automatically** once the recipient capability is active
   and a credited post is waiting — BUT auto-release ships only behind the
   collusion check SECURITY_AND_TRUST §5 requires. A webhook that moves money
   on its own does not ship before the check that stops an owner paying
   themselves.
5. **A Stripe remediation fallback stays wired** for risk/liveness step-ups.
   The current embedded + hosted path is kept for exactly this, and for
   existing v1 accounts, which are not migrated.
6. Server SDK upgrades to stripe-node 21.x first, proven against escrow,
   before any v2 call is written.

## Consequences

- **We own recurring compliance work**: Stripe's stated obligation to review
  onboarding requirements and re-collect information **at least every six
  months**, plus handling "Stripe needs more information" states in our own UI.
  For a team of one this is a calendar obligation, not a code obligation — it
  is the single heaviest cost of this decision and is accepted with eyes open.
- **Legal flag (explicit):** the compliance-responsibility shift is exactly the
  kind of thing to raise in the launch accountant/solicitor conversation,
  alongside the existing escrow/PSR question in legalContent.ts.
- The Stripe sign-in popup and Stripe-branded onboarding disappear from the
  happy path. The ~5% that cannot be ours (risk, liveness) is a Stripe surface
  by regulation, not by our choice.
- Bank details and identity leave our threat model entirely (no transit).
  LOGGING.md's bank-details prohibition stays — belt and braces.
- Test-mode connected accounts are wiped and recreated under the new model;
  production has none yet, so there is no live migration.
- If v2 recipient requirements harden in future (e.g. the 2026 European
  verification wave expanding beyond `card_payments`), our exposure is capped
  by the remediation fallback: worst case, spotters see a Stripe surface again.

## Rejected alternatives

- **Stay on the embedded hybrid (B)** — zero new obligations, but permanently
  keeps Stripe's sign-in + form in the product's highest-trust moment. Owner
  rejected twice.
- **v1 `requirement_collection: application` (old "Custom")** — strictly
  dominated by v2 recipient: same ownership burden, heavier baseline KYC,
  identity PII would transit our server, and it is the surface Stripe is
  migrating away from.
