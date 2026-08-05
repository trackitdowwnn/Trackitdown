/**
 * WHAT:  The project's Reanimated test double: the library's own official mock
 *        plus `useReducedMotion`, which the official one deliberately omits
 *        (its source carries the literal line `// useReducedMotion: ADD ME IF
 *        NEEDED`). Wired up by the `moduleNameMapper` entry in package.json.
 * WHY:   docs/DESIGN_SYSTEM.md (Motion) requires that EVERY animated component
 *        reads `useReducedMotion()`, so a component that obeys the design
 *        system used to be untestable under the shared mock — it would throw
 *        "useReducedMotion is not a function" the moment it rendered. The
 *        workaround had been a hand-rolled `jest.mock('react-native-reanimated')`
 *        factory copied into each suite (ReputationCard, MapListSheet,
 *        FullscreenLoader…), which is why nine suites that render the loader
 *        could not have covered its reduced-motion branch at all.
 *
 *        Defaults to FALSE — motion ON — because that is what most users get,
 *        so the default test environment exercises the same branch they see.
 *        A suite that wants the reduced path spies on it:
 *          jest.spyOn(require('react-native-reanimated'), 'useReducedMotion')
 *            .mockReturnValue(true)
 *        Per-suite `jest.mock` factories still override this entirely, so the
 *        existing hand-rolled doubles keep working untouched.
 * LINKS: package.json (jest.moduleNameMapper), src/shared/ui/BrandLoader.tsx
 *        (the component that made this necessary), docs/TESTING.md.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS mock module, loaded by jest's resolver
const officialMock = require('react-native-reanimated/mock');

module.exports = {
  ...officialMock,
  useReducedMotion: () => false,
};
