# Legal

**Actor:** everyone — signed in or not.
**One sentence:** the three legal documents (Safety guidelines, Terms of
service, Privacy policy) and the screen that renders one.

> ## ⚠️ These are DRAFTS. A UK solicitor must review them before launch.
>
> The **facts** are accurate — they were written by reading the schema, the
> Edge Functions and `docs/SECURITY_AND_TRUST.md`, not from a template, so what
> they say about data, retention, coarsening and the escrow mechanics matches
> what the code actually does. The **law** has not been checked by anyone
> qualified. Three areas need real advice, and the first is not optional:
>
> 1. **Holding bounty money.** Taking a payment from one user and later paying
>    part of it to another can be a regulated payment service under the PSRs
>    2017. The Stripe Connect separate-charges-and-transfers model (ADR-0002) is
>    the standard mitigation, but whether this arrangement needs FCA
>    authorisation, or sits under Stripe's, is a question for a lawyer. Get this
>    one answered first — it can change the product, not just the wording.
> 2. **Liability and safety.** We invite the public to look for stolen vehicles.
>    The limitation wording must be checked against the Consumer Rights Act
>    2015; liability for death or personal injury caused by negligence cannot be
>    excluded, and an over-broad clause is void rather than merely unenforceable.
> 3. **UK GDPR.** The lawful bases named in the privacy policy are our
>    reasoning, not a ruling. ICO registration (a small annual fee) very likely
>    applies to this processing.
>
> Also unresolved and named in the text: the operating entity. The documents say
> "Trackitdown" throughout; if you trade as a limited company, that name and its
> company number belong in the Terms and the Privacy policy before launch.

## Where the text lives

`lib/legalContent.ts` — one typed module, all three documents. Deliberately
data rather than markdown: no renderer dependency, and the copy sits in the same
review path as the code it describes.

## Why in-app, and why that isn't enough

The links used to open `https://trackitdown.example/...`. `.example` is an
IANA-reserved TLD that resolves to nothing, so **every** Terms and Privacy tap
in the app opened a browser error — including the consent line shown at sign-up,
directly above the button that says you agree to them.

Rendering in-app fixes that with no domain and no hosting, and it removes version
skew: the terms a user reads are the terms shipped in the build they agreed on.

**It does not satisfy the stores.** Both the App Store and Play Console require
a *publicly reachable* privacy-policy URL for the listing itself. That is a
launch blocker, tracked as `LEGAL_PUBLIC_URLS` in `src/shared/lib/legal.ts`,
which is deliberately `null` rather than a plausible-looking guess.

## Publishing to the web (when a domain exists)

The same content, not a second copy. `LEGAL_DOCUMENTS` is a plain serialisable
object, so a short script can render it to static HTML at build time. Keep one
source; a privacy policy that disagrees with itself across two locations is
worse than one that is merely late.

## Changing a document

1. Edit `lib/legalContent.ts`.
2. Bump `LEGAL_LAST_UPDATED` — it is rendered under every title.
3. If the change is material, tell users in-app before it takes effect (the
   Terms promise this).
4. Re-publish the web copies so the two agree.

## Tables / Edge Functions

None. Static content only.
