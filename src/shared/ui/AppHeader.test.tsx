/**
 * WHAT:  Tests for AppHeader — renders the title + right actions, and the
 *        back button fires onBack.
 * WHY:   The header is the only way back off a full-screen detail page; a
 *        dead back button strands the user. The scroll-fade itself runs on the
 *        UI thread and is exercised on-device, not here.
 * LINKS: src/shared/ui/AppHeader.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppHeader } from './AppHeader';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    // Older mocks expose Extrapolate, not the current Extrapolation name.
    Extrapolation: actual.Extrapolation ?? actual.Extrapolate ?? { CLAMP: 'clamp' },
  };
});

describe('AppHeader', () => {
  const scrollY = { value: 0 } as { value: number };

  it('renders the title and right actions, and fires onBack', async () => {
    const onBack = jest.fn();
    const { getByText, getByLabelText } = await render(
      <AppHeader
        title="BMW 3 Series"
        scrollY={scrollY as never}
        fadeStart={100}
        fadeEnd={200}
        onBack={onBack}
        rightActions={<Text>share</Text>}
      />,
    );

    expect(getByText('BMW 3 Series')).toBeTruthy();
    expect(getByText('share')).toBeTruthy();

    fireEvent.press(getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
