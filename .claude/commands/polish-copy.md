---
description: Review and tighten all user-facing wording across the project (minimal, clear, human)
argument-hint: "[path or area] [review-only]"
---

# Polish copy

Review every piece of user-facing text in this project and improve it. The house style is minimal but effective, in the spirit of Airbnb: few words, plain language, warm without being chatty, and always clear about what happens next.

Scope: $ARGUMENTS

- If a path or area is given, limit the pass to it. If nothing is given, cover the whole project.
- If the arguments include `review-only`, change nothing and only report proposed edits.

## 1. Find the text

Sweep the project for anything a user reads. Skip `node_modules`, build output, lockfiles, vendored code and generated files.

- UI strings in components, templates and views: headings, body text, buttons, links, labels, placeholders, helper text, tooltips
- Locale and translation files (`en.json`, `messages.*`, `strings.*`, and similar)
- States: empty, loading, success, error, confirmation dialogs, toasts, banners
- Form validation messages and server error messages shown to users
- Onboarding, marketing and landing copy
- Emails, push notifications, SMS templates
- Page titles, meta descriptions, Open Graph text, `alt` text, `aria-label`s
- README and user-facing docs (lighter touch; clarity over brevity here)

Before editing, note the terms the product already uses for its core concepts (for example "booking" vs "reservation", "sign in" vs "log in"). Pick one term per concept, the one used most, and apply it everywhere.

## 2. Style rules

**Say less**
- Cut every word that doesn't change the meaning. "In order to" becomes "to". "Please note that" goes.
- One idea per sentence. One job per screen element.
- Drop filler: "simply", "just", "easily", "successfully", "currently", "actually".
- If the UI already shows it, the text doesn't need to say it.

**Say it plainly**
- Use everyday words: "use" not "utilize", "help" not "assistance", "about" not "regarding".
- No jargon, internal names or system language ("invalid input", "null", "request failed").
- Talk to the person: "you" and "your". Active voice. Present tense.
- Contractions are fine: "can't", "you'll", "we've".

**Buttons and links**
- Start with a verb and name the outcome: "Save changes", "Add a photo", "Send message".
- One to three words where possible. Never "Click here", "Submit" or "OK" when a specific verb fits.
- A confirmation dialog's button repeats the action: "Delete photo", not "Yes".

**Headings and labels**
- Sentence case everywhere. No full stop on headings, labels or buttons.
- Headings state what the screen is for. Labels are nouns, not questions, unless a question is clearer.
- Placeholders show an example, never the instruction. Instructions belong in the label or helper text.

**Errors and empty states**
- Say what happened, then what to do. "That card was declined. Try another one."
- Never blame the user. No "invalid", "illegal", "failed to", "you must".
- No apologies unless it's really our fault, and then only once.
- Empty states say what goes here and offer the first step.

**Tone**
- Calm and friendly. No exclamation marks, except a rare real celebration.
- No hype words: "amazing", "awesome", "powerful", "seamless".
- "Please" only when asking for real effort from the user.
- Numbers as digits. Dates and times in the format the product already uses.

**Accessibility**
- `alt` text describes the image's content or purpose in a short phrase. Decorative images get empty `alt`.
- `aria-label`s match the visible wording where there is visible wording.

## 3. What not to touch

- Translation keys, variable names, IDs, routes, `data-testid`s, analytics event names
- Interpolation placeholders and markup inside strings (`{name}`, `%s`, `{{count}}`, `<b>`): keep them intact and in a sensible position
- Plural and ICU message structure
- Legal text: terms, privacy, consent wording, regulated disclosures. Flag these instead of editing.
- Safety copy: any string marked `// SAFETY:`, everything exported by `SafetyNotice.tsx` (`SAFETY_RULE_LINE`, title, body), the "Don't approach — your report is enough." register line, the "Open in Maps" label (pinned by SECURITY_AND_TRUST §1), and the chat quick-reply lexicon (`quickReplies.ts` — every reply is safety-vetted, tense included). Flag, never edit — and never let a trim shorten a sentence that ends with a don't-approach clause.
- Log messages and developer-only errors
- Non-source locales: edit the source language only, and list the keys whose translations now need updating
- Meaning: never change what a string promises or instructs. If a string is unclear because the behavior is unclear, flag it rather than guessing.

## 4. How to work

1. Inventory the text and group it by area (for example: auth, onboarding, checkout, settings, emails).
2. Settle the glossary of preferred terms.
3. Go area by area. For each string, ask: is it needed, is it clear, can it be shorter, does it match the glossary? Leave good copy alone; not every string needs a change.
4. Apply the edits (unless `review-only`).
5. Update any tests, snapshots or stories that assert on the old strings.
6. Run the project's lint, type check and tests if they exist, and fix anything the copy changes broke.

## 5. Report

Finish with a short report:

- **Glossary**: the terms chosen, and the variants replaced
- **Changes**: a table per area with file, before and after
- **Flagged**: strings left alone that need a human decision (legal, ambiguous meaning, missing context), each with a one-line reason
- **Translations to update**: keys changed in the source locale
- **Patterns**: recurring problems worth fixing at the source, such as a shared error component or a missing empty state