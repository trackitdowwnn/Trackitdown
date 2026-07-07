---
description: Explain any file, feature, or flow in plain English so anyone can understand it
argument-hint: <file path, feature name, or flow (e.g. "the payout flow")>
---

Explain this to me in plain English: $ARGUMENTS

Rules:

1. Assume I'm smart but not deeply technical — explain like a good
   colleague would at a whiteboard, not like documentation. Analogies
   welcome. Define any unavoidable jargon in one clause.
2. Read the actual code (and relevant docs) before explaining — never
   explain from assumption.
3. Structure the explanation as:
   - **One-sentence summary** — what this thing is for.
   - **The story** — walk through what happens step by step, in the
     order it happens at runtime (user taps X → this hook runs → this
     row is written → this function fires).
   - **Where things live** — the 3–6 most important files/tables
     involved and one line on each.
   - **Rules it enforces** — any DOMAIN.md / SECURITY_AND_TRUST.md
     rules baked in.
   - **Gotchas** — anything surprising or easy to misunderstand.
4. If, while explaining, you find the code confusing, poorly named, or
   the file headers out of date — say so at the end under **"This could
   be clearer"** with concrete suggestions. Confusion during explanation
   is a code-quality signal, not something to paper over.
5. If the target spans multiple features, offer a diagram-as-text of the
   flow between them.

End by asking if I want any part explained deeper.
