# Going live with Stripe: the first real payment

**What this is:** the steps, in order, for the first live Stripe payment, a
genuine **£5 no-reward listing** posted with the owner's own card. The order
matters, so follow it top to bottom.

**Why it's fiddly:** there is ONE Supabase project and ONE OTA channel
(`preview`). Live keys switch the whole tester fleet to live at once: every
tester can then make real charges. The server key and the app key must also
change together; while they don't match, PaymentSheet fails for everyone.

**What's already done:**
- **Code:** payouts are tied to their charge (#207), and chargebacks send alerts (#208).
- **Sandbox rows cleared (2026-10-16):** the 3 held test rewards are settled as `refunded`, their posts are `cancelled`, and the sandbox payout account row is deleted. Nothing in the database still points at a sandbox Stripe id the sweep would call.

> ⚠️ **Stripe's terms ban "testing in live mode using real payment method
> details".** A real £5 listing that you keep is a genuine purchase. Don't run
> charge-and-refund loops on your own card.

---

## 1. Stripe Dashboard (live mode), by the owner

1. **Activate the account.** Choose sole trader, then add your details, your bank account and your ID. Describe the business without the word "escrow" (Stripe treats it as a restricted category), for example: *"An app where car owners post a listing about a stolen car, optionally with a reward, paid to people whose sightings help recover it."* Wait for **Charges enabled**.
2. **Settings → Payouts → Manual.** This matters before any reward is taken. On the default daily schedule, held rewards are swept to your bank (see the functions README).
3. **Settings → Public details:**
   - Statement descriptor `TRACKITDOWN`
   - Support email and phone
   - Website `https://trackitdown.co.uk`
4. **Settings → Payment methods:**
   - **On:** cards and Link.
   - **Off:** Klarna, Amazon Pay and Revolut Pay.
   - **Google Pay:** leave it off for now (see the note at the bottom).
5. **Settings → Emails:** turn on receipts for successful payments and refunds.
6. **Settings → Team and security:** turn on 2FA.

## 2. Live webhook destinations

Ask Claude to create these through the Stripe MCP, or add them in Workbench → Webhooks. All three use the same URL, and every one must be a **dahlia** API version:
`https://lbbbxelbembseohxjhkv.supabase.co/functions/v1/stripe-webhook`

| Destination | Events from | Payload | Events | Secret goes in |
|---|---|---|---|---|
| Platform | Your account | Snapshot | `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.closed`, `transfer.reversed` | `STRIPE_WEBHOOK_SECRET` |
| Connected accounts | Connected accounts | Snapshot | `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, `account.updated` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| Payee accounts v2 | Your account | **Thin** | `v2.core.account[configuration.recipient].capability_status_updated`, `v2.core.account[requirements].updated` | `STRIPE_THIN_WEBHOOK_SECRET` |

Before you continue, copy the **sandbox** values of all four secrets somewhere safe. You need them to roll back.

## 3. The switch: server and app together, in one sitting

Run these in **your own PowerShell** (the `!` prefix has no stdin). Copy each value from the live Dashboard first, then run its line:

```powershell
npx supabase secrets set "STRIPE_WEBHOOK_SECRET=$((Get-Clipboard).Trim())"
npx supabase secrets set "STRIPE_CONNECT_WEBHOOK_SECRET=$((Get-Clipboard).Trim())"
npx supabase secrets set "STRIPE_THIN_WEBHOOK_SECRET=$((Get-Clipboard).Trim())"
npx supabase secrets set "STRIPE_SECRET_KEY=$((Get-Clipboard).Trim())"      # sk_live_…
```

Payments are broken for testers from here until the OTA lands. Change the app's key straight away:

```powershell
npx eas-cli env:set preview --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value "$((Get-Clipboard).Trim())" --visibility plaintext --non-interactive   # pk_live_… (public by design)
$env:NODE_OPTIONS="--use-system-ca"; $env:EAS_SKIP_AUTO_FINGERPRINT="1"
npx eas-cli update --branch preview --environment preview --platform android --non-interactive --message "Stripe live keys"
npx eas-cli update:list --branch preview --limit 3      # the newest entry must be yours; exit codes lie
```

Then fully close and reopen the app twice, so the OTA loads.

## 4. The payment

Post a **no-reward** listing and pay £5 by **typing your card into the sheet**, not with Google Pay.

**It passed if all of these are true:**
- [ ] The Stripe live payment `succeeded`, with metadata `kind=listing_fee`.
- [ ] The platform destination shows the delivery returned **200**.
- [ ] The post is `active`, and its `payments` row is `listing_fee` / `collected`.
- [ ] No `ops_alert` in the function logs, and no alert email.
- [ ] Your bank statement shows `TRACKITDOWN`.
- [ ] The £5, less Stripe's fee, reaches your Stripe balance. With manual payouts, you send it to your bank yourself.

Claude can check the first four for you through Stripe and Supabase.

## 5. Rollback (if anything above fails)

Set the four sandbox secrets back. Then run `env:set` with the `pk_test_…` key, and OTA the same way. The £5 charge stays: it was a real purchase.

---

**Before reward listings go live:**
- Install `react-native-webview` and ship a new APK, so spotters can onboard. Until then, a credited spotter can't be paid.
- Ask Stripe whether holding rewards for up to 60 days suits a sole trader.

**Google Pay:** turn it on only after Google grants production access. Use the Google Pay & Wallet Console, integration type **Gateway**, with screenshots. It also needs a signed release build. The app already switches Google Pay to production mode when the key is `pk_live_…`.
