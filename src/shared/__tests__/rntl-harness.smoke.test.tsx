/**
 * WHAT:  Smoke test proving React Native Testing Library renders and queries
 *        components under the project's Jest (jest-expo) setup.
 * WHY:   Confirms the component-testing harness works before real screens
 *        rely on it — a broken RNTL setup would otherwise only surface when
 *        writing the first UI test.
 * LINKS: docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

function Hello() {
  return (
    <View>
      <Text>Hello Trackitdown</Text>
    </View>
  );
}

describe('RNTL harness', () => {
  it('renders a component and finds text', async () => {
    const { getByText } = await render(<Hello />);
    expect(getByText('Hello Trackitdown')).toBeTruthy();
  });
});
