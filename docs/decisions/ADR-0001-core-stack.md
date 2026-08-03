# ADR-0001 — Core stack: Expo, Supabase, Stripe Connect

**Status:** accepted, fee wording superseded · **Date:** 2026-07-07

> **Partly superseded by [ADR-0002](./ADR-0002-stripe-connect.md)** (2026-07-07).
> The stack choices below stand. The phrase "our 5% is a Connect application
> fee" under **Decision** is **wrong**: we use separate charges and transfers,
> so the 5% is the remainder that stays on the platform balance, never an
> `application_fee_amount`. ADR-0002 recorded that it superseded this wording on
> the day it was written; this banner was not added until 2026-08-03, and in the
> meantime the stale phrasing was copied into DOMAIN.md and SECURITY_AND_TRUST.md.

## Context

Trackitdown needs iOS + Android from one codebase, heavy geospatial
queries ("notify spotters within their chosen radius"), realtime chat,
and regulated money handling (escrowed bounties, payouts, platform fee)
— built by a very small team.

## Decision

- **React Native with Expo** — one codebase, EAS handles builds/releases,
  strongest ecosystem for a small team.
- **Supabase over Firebase** — Postgres + PostGIS gives native radius
  queries (`ST_DWithin`) instead of Firebase's geohash workarounds;
  RLS gives database-level privacy enforcement; Realtime covers chat;
  Edge Functions host Stripe webhooks and payout logic.
- **Stripe Connect** — Stripe holds escrowed bounties and runs spotter
  KYC/payouts; ~~our 5% is a Connect application fee~~ **(superseded by
  ADR-0002: separate charges and transfers, 5% retained as the remainder)**.
  This keeps us out of directly holding client money.

## Consequences

- All spatial data must use PostGIS geography columns (not bare floats).
- Payout/refund logic lives exclusively in Edge Functions.
- Spotters must complete Stripe onboarding before their first payout.
- Revisit if: Expo blocks a needed native capability, or Stripe Connect
  terms don't fit the bounty model (verify during launch legal review).

---

*Template for new ADRs: copy this file, increment the number, fill in
Context / Decision / Consequences. One decision per file, kept short.*
