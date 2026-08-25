/**
 * WHAT:  Tests for StickyActionBar and Screen's `footer` slot.
 * WHY:   The bar's whole reason to exist is WHERE it renders. A test that only
 *        checked it draws its children would pass just as happily on the
 *        absolutely-positioned version that the keyboard covers — so these
 *        pin the position in the tree, not the pixels.
 * LINKS: ./StickyActionBar.tsx; ./Screen.tsx.
 */

import { render, within } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Screen } from './Screen';
import { StickyActionBar } from './StickyActionBar';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

describe('StickyActionBar', () => {
  it('renders its action', async () => {
    const { getByText } = await render(
      <StickyActionBar testID="bar">
        <Text>Send report</Text>
      </StickyActionBar>,
    );

    expect(getByText('Send report')).toBeTruthy();
  });

  it('⚠️ sits OUTSIDE the scroll, not as its last child', async () => {
    // The point of the component. Inside the ScrollView it is just a normal
    // last item that scrolls away — which is the exact bug it was built to
    // fix, and which no visual assertion would catch.
    const { getByTestId } = await render(
      <Screen
        scroll
        keyboardAware
        footer={
          <StickyActionBar testID="bar">
            <Text>Send report</Text>
          </StickyActionBar>
        }
      >
        <Text>the form</Text>
      </Screen>,
    );

    const scroll = getByTestId('screen-scroll');
    expect(within(scroll).getByText('the form')).toBeTruthy();
    expect(within(scroll).queryByTestId('bar')).toBeNull();
    // Present on the screen, just not inside the scrolling part.
    expect(getByTestId('bar')).toBeTruthy();
  });

  it('a Screen with no footer renders nothing extra', async () => {
    const { queryByTestId } = await render(
      <Screen scroll>
        <Text>the form</Text>
      </Screen>,
    );

    expect(queryByTestId('bar')).toBeNull();
  });
});
