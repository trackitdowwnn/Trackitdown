/**
 * WHAT:  Turns Gesture Handler 3's "GestureDetector must be used as a
 *        descendant of GestureHandlerRootView" dev check into a no-op in Jest.
 * WHY:   The app has its root view (src/app/_layout.tsx), but component tests
 *        render a slider or the photo grid on their own, without the app
 *        root, and GH 3 throws in __DEV__ when it can't see one. The check
 *        guards app wiring, which is not what those suites test.
 * LINKS: package.json "jest.setupFiles";
 *        node_modules/react-native-gesture-handler/jestSetup.js (mocks both
 *        the src and lib/module copies the same way).
 */

/* global jest */

jest.mock('react-native-gesture-handler/src/v3/detectors/useEnsureGestureHandlerRootView', () => ({
  useEnsureGestureHandlerRootView: () => {},
}));
jest.mock(
  'react-native-gesture-handler/lib/module/v3/detectors/useEnsureGestureHandlerRootView',
  () => ({ useEnsureGestureHandlerRootView: () => {} }),
);
