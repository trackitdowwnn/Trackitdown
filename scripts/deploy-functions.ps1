# WHAT:  Deploys the Supabase Edge Functions in the ONE order that is safe for
#        money, and refuses to continue if any step fails.
# WHY:   There is no deploy automation in this repo, so functions drift behind
#        the migrations that are already live in the database — which is exactly
#        how the £4.99 listing fee broke: create-payment-intent sat at v9 (16 Aug)
#        while the fee migration went in on 20 Aug, so it read a NULL bounty and
#        handed Stripe amount:null.
#
#        THE ORDER IS LOAD-BEARING. create-payment-intent is what lets money
#        start moving. stripe-webhook is what records it. If the payment function
#        goes out first, a £4.99 charge succeeds at Stripe and the OLD webhook
#        calls mark_post_payment_held, which the current migration makes return
#        SILENTLY for a listing_fee row (ADR-0014: never put a fee into escrow).
#        Result: card charged, post stuck in 'draft', no error logged anywhere.
#        So the webhook group always goes first and the gate below is real.
# USAGE: $env:SUPABASE_ACCESS_TOKEN = "sbp_..."   # from supabase.com/dashboard/account/tokens
#        .\scripts\deploy-functions.ps1
# LINKS: supabase/functions/create-payment-intent/index.ts;
#        supabase/migrations/20260820110000_no_bounty_listing_fee.sql;
#        docs/decisions/ADR-0014-no-bounty-listings.md.

$ErrorActionPreference = "Stop"

$ref = "lbbbxelbembseohxjhkv"

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "SUPABASE_ACCESS_TOKEN is not set." -ForegroundColor Red
  Write-Host 'Run:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."'
  Write-Host "Get one at https://supabase.com/dashboard/account/tokens"
  exit 1
}

# --use-api bundles server-side; without it the CLI needs Docker running.
# NOTE: never add --prune here. `delete-draft` and `notify-sighting-confirmed`
# are deployed with no source in this repo, and --prune deletes exactly those.
function Deploy-Fns {
  param([string[]]$Names)
  Write-Host "`n=> deploying: $($Names -join ', ')" -ForegroundColor Cyan
  npx supabase functions deploy @Names --project-ref $ref --use-api
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`nFAILED (exit $LASTEXITCODE). Stopping before anything downstream." -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

# 1. Everything that RECORDS or MOVES money, plus the three functions that
#    bundle _shared/releasePayout.ts (changed in the same commit).
Deploy-Fns @(
  "stripe-webhook",
  "deactivate-post",
  "release-payout",
  "release-held-refunds",
  "create-payout-account"
)

# 2. Only now the function that lets a charge START.
Deploy-Fns @("create-payment-intent")

Write-Host "`nAll functions deployed." -ForegroundColor Green
Write-Host "Now verify the versions actually incremented before testing a payment."
