Review the entire Trackitdown project and suggest quality-of-life improvements. This is a read-only review: change nothing, suggest everything. $ARGUMENTS

SCOPE OF "QUALITY OF LIFE"

Two audiences, treat both:

1. The user's QoL — small product touches that make the app nicer to live with day to day. Think: remembering scroll position and last-used values, sensible defaults on forms, undo instead of confirm dialogs, pull-to-refresh, haptics on key actions, dark mode gaps, launcher shortcuts, copy that could be friendlier, one-tap paths to things that currently take three, empty states that teach, widgets/share targets that would fit naturally.

2. The developer's QoL — friction in working on this codebase. Think: missing .editorconfig or formatter config, no lint/detekt/ktlint setup, absent or broken run configurations, slow or unconfigured Gradle (caching, parallel, configuration cache), missing CI, no version catalog, TODOs that have rotted, dead code and unused resources, inconsistent naming that makes search fail, missing README/setup docs, hardcoded strings that should be resources, magic numbers that should be constants.

Explicitly OUT of scope: architecture rewrites, framework migrations, performance work, new major features, dependency upgrades for their own sake. If you spot something big, put it in a single "larger items noticed" footnote — one line each, no elaboration.

HOW TO REVIEW

- Walk the full project: manifest, gradle files, every screen, the data layer, resources (strings, themes, drawables), and any CI/tooling config. Actually read the screens' UI code — most user-facing QoL wins are visible there.
- For user-facing suggestions, ground each one in something concrete you saw in the code ("the add form clears on rotation because X", "there's no launcher shortcut despite Y being the obvious quick action"), not generic best-practice lists.
- Do not suggest things the app already does. Verify before suggesting.
- Do not pad. If an area is fine, skip it. Twenty sharp suggestions beat sixty generic ones.

OUTPUT

A single ranked table, both audiences mixed together, ordered by (benefit × ease). Columns:
- Suggestion (one line, concrete: "Persist the last-selected category in the add flow", not "improve form UX")
- Who benefits (user / dev)
- Evidence (file/screen where you saw the gap)
- Effort (S = under an hour, M = an afternoon, L = a day+)
- Why it matters (one sentence, in terms of the annoyance it removes)

Then: your top 5 — the ones you'd do first — with two or three sentences each on exactly how you'd implement them in THIS codebase (which files, which pattern already in the project to follow).

Finish by asking me which items to implement. Do not implement anything in this run.