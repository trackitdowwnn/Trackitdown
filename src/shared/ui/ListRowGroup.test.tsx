/**
 * WHAT:  Tests for ListRowGroup — the divider arithmetic and the title.
 * WHY:   The dividers are the only logic here, and the one that matters is
 *        that a CONDITIONAL row leaves no orphan hairline. The profile's
 *        Payouts row is conditional, so this held before the extraction and
 *        has to keep holding after it.
 * LINKS: ./ListRowGroup.tsx; ./ListRow.tsx.
 */

import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import { ListRowGroup } from './ListRowGroup';

const Row = ({ label }: { label: string }) => (
  <View testID={`row-${label}`}>
    <Text>{label}</Text>
  </View>
);

describe('ListRowGroup', () => {
  it('titles the group as a header', async () => {
    const { getByRole } = await render(
      <ListRowGroup title="Appearance">
        <Row label="a" />
      </ListRowGroup>,
    );

    expect(getByRole('header', { name: 'Appearance' })).toBeTruthy();
  });

  it('puts a divider BETWEEN rows and not around them', async () => {
    const { queryAllByTestId } = await render(
      <ListRowGroup title="Settings" testID="group">
        <Row label="a" />
        <Row label="b" />
        <Row label="c" />
      </ListRowGroup>,
    );

    // Three rows → two dividers. A leading or trailing hairline would read as
    // the group being cut off rather than grouped.
    expect(queryAllByTestId('list-row-group-divider')).toHaveLength(2);
  });

  it('⚠️ a conditional row that renders null leaves no orphan divider', async () => {
    // The Payouts row on the profile is `{cond ? <ListRow/> : null}`. Without
    // Children.toArray dropping the null, the group would draw a hairline with
    // nothing under it whenever payouts are irrelevant — a rule that lives in
    // one line of this component and is invisible everywhere else.
    const showMiddle = false;

    const { queryByTestId, queryAllByTestId } = await render(
      <ListRowGroup title="Settings">
        <Row label="a" />
        {showMiddle ? <Row label="b" /> : null}
        <Row label="c" />
      </ListRowGroup>,
    );

    expect(queryByTestId('row-b')).toBeNull();
    // Two VISIBLE rows → exactly one divider, not two.
    expect(queryAllByTestId('list-row-group-divider')).toHaveLength(1);
  });

  it('quiet groups recede and drop their dividers', async () => {
    const { queryAllByTestId } = await render(
      <ListRowGroup title="Developer" quiet>
        <Row label="a" />
        <Row label="b" />
      </ListRowGroup>,
    );

    expect(queryAllByTestId('list-row-group-divider')).toHaveLength(0);
  });
});
