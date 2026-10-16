/**
 * WHAT:  Tests for BankDetailsForm — the bank-only form behind "Update bank
 *        details" and a refused payout's "Add your bank details again".
 * WHY:   It must type a bank number exactly as the setup wizard does (2026-10-14:
 *        it didn't — no dashes, no length cap, errors only after "Save"), and
 *        what it hands on must be digits only, whatever was typed.
 * LINKS: ./BankDetailsForm.tsx; ./payoutSetupSteps.tsx (the wizard's bank step).
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { BankDetailsForm } from './BankDetailsForm';

const renderForm = async (onSubmit = jest.fn(async (_details: unknown) => {})) => ({
  onSubmit,
  view: await render(<BankDetailsForm onSubmit={onSubmit} onCancel={jest.fn()} />),
});

describe('BankDetailsForm', () => {
  it('puts every label above its box, as the setup wizard does', async () => {
    const { view } = await renderForm();
    const tree = JSON.stringify(view.toJSON());
    // Label text comes before its input in the tree — over the box, not in it.
    for (const [label, id] of [
      ['Sort code', 'bank-sort-code'],
      ['Account number', 'bank-account-number'],
      ['Confirm account number', 'bank-confirm-account-number'],
    ]) {
      expect(tree.indexOf(`"${label}"`)).toBeGreaterThan(-1);
      expect(tree.indexOf(`"${label}"`)).toBeLessThan(tree.indexOf(`"${id}"`));
    }
  });

  it('types the sort code’s dashes for them, as the wizard does', async () => {
    const { view } = await renderForm();
    await act(async () => {
      fireEvent.changeText(view.getByTestId('bank-sort-code'), '108800');
    });
    expect(view.getByTestId('bank-sort-code').props.value).toBe('10-88-00');
  });

  it('says a short sort code is wrong on leaving the field — not only after "Save"', async () => {
    const { view } = await renderForm();
    await act(async () => {
      fireEvent.changeText(view.getByTestId('bank-sort-code'), '1088');
    });
    await act(async () => {
      fireEvent(view.getByTestId('bank-sort-code'), 'blur');
    });
    expect(view.getByText('A sort code is 6 digits')).toBeTruthy();
  });

  it('an untouched field is not an error yet', async () => {
    const { view } = await renderForm();
    await act(async () => {
      fireEvent(view.getByTestId('bank-account-number'), 'blur');
    });
    expect(view.queryByText('An account number is 8 digits')).toBeNull();
  });

  it('⚠️ hands on digits only, whatever was typed', async () => {
    const { view, onSubmit } = await renderForm();
    await act(async () => {
      fireEvent.changeText(view.getByTestId('bank-sort-code'), '108800');
      fireEvent.changeText(view.getByTestId('bank-account-number'), '0001 2345');
      fireEvent.changeText(view.getByTestId('bank-confirm-account-number'), '00012345');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Save new account'));
    });
    expect(onSubmit).toHaveBeenCalledWith({ sortCode: '108800', accountNumber: '00012345' });
  });
});
