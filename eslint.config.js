// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// ⚠️ THE ARCHITECTURE RULES, MADE REAL (2026-09-03).
//
// ARCHITECTURE.md has stated both of these as HARD rules since the project
// started, and nothing enforced either: this file was ten lines with no
// no-restricted-imports, and BUILD_PLAN.md was candid that review and comments
// were the only enforcement. The whole-app review found six live violations —
// so the honour system had already lost, quietly, in six places.
//
// Rule 1 is load-bearing rather than tidy: it is what forced two promotions to
// shared/ui this week, and it is the reason bountyBounds moved to shared/lib
// (three features had reached past the vehicles barrel for the bounty range —
// exactly the "if two features need the same thing constantly, it probably
// belongs in shared/" case the doc names).
//
// Rule 2 had ZERO violations when this landed. It is here to keep it that way:
// one `shared/` file importing a feature inverts the dependency direction the
// whole layout rests on, and it would be found by a circular-import crash at
// runtime rather than by a reviewer.
module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Rule 1 — features never deep-import each other.
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Two or more segments past `features/` — i.e. anything but the
              // barrel. A feature importing ITSELF uses relative paths and is
              // unaffected; `@/features/x` (the barrel) stays allowed.
              group: ['@/features/*/*'],
              message:
                'Features must not deep-import each other (ARCHITECTURE.md rule 1). Import from the feature barrel — @/features/<name> — and export it there if it is missing. If two features keep needing the same thing, it belongs in shared/.',
            },
          ],
        },
      ],
    },
  },
  {
    // Rule 2 — shared/ never imports from features/. Dependency direction is
    // one-way: app/ → features/ → shared/.
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*', '@/features/*/**'],
              message:
                'shared/ must never import from features/ (ARCHITECTURE.md rule 2). The dependency direction is one-way: app/ → features/ → shared/. Move the shared thing down, or take a prop/parameter instead.',
            },
          ],
        },
      ],
    },
  },
]);
