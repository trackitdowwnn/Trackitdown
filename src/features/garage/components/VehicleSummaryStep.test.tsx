/**
 * WHAT:  Tests for the "Your car" sheet — the name, plate and details line
 *        (unknowns left out, an escape colour giving way to its note), the
 *        distinctive features only when there are some, every photo, "Edit
 *        details", and nothing tappable among the photos.
 * WHY:   It replaced "Is this the car?" (2026-10-08): a question the owner had
 *        just answered, over one photo and a count. What it shows is now the
 *        point of it, so what it shows is pinned.
 * LINKS: src/features/garage/components/VehicleSummaryStep.tsx;
 *        src/features/garage/lib/prefilledPostFlow.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { SavedVehicle } from '../types';
import { VehicleSummaryStep, vehicleDetailLine } from './VehicleSummaryStep';

// The one thing this needs from the vehicles feature; its barrel reaches the
// network and native modules.
jest.mock('@/features/vehicles', () => ({ BODY_TYPE_UNKNOWN: 'Not sure' }));

function vehicle(overrides: Partial<SavedVehicle> = {}): SavedVehicle {
  return {
    id: 'v1',
    plate: 'AB12 CDE',
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    colourNote: null,
    year: 2019,
    bodyType: 'Saloon',
    nickname: null,
    verificationState: 'unverified',
    photos: [
      { url: 'https://x/0.jpg', position: 0 },
      { url: 'https://x/1.jpg', position: 1 },
      { url: 'https://x/2.jpg', position: 2 },
    ],
    distinctiveFeatures: [],
    isCurrentlyPosted: false,
    activePostId: null,
    createdAt: '2026-07-01T10:00:00Z',
    ...overrides,
  };
}

describe('vehicleDetailLine', () => {
  it('reads colour · year · body type', () => {
    expect(vehicleDetailLine(vehicle())).toBe('Blue · 2019 · Saloon');
  });

  it('leaves out what is not known — never "Not sure", never a blank', () => {
    expect(vehicleDetailLine(vehicle({ year: null, bodyType: 'Not sure' }))).toBe('Blue');
    expect(vehicleDetailLine(vehicle({ bodyType: null }))).toBe('Blue · 2019');
  });

  it('an escape colour gives way to the owner’s note — or stays when there is none', () => {
    expect(vehicleDetailLine(vehicle({ colour: 'Other', colourNote: 'Matte green wrap' }))).toBe(
      'Matte green wrap · 2019 · Saloon',
    );
    expect(vehicleDetailLine(vehicle({ colour: 'Other', colourNote: null }))).toBe(
      'Other · 2019 · Saloon',
    );
  });
});

describe('VehicleSummaryStep', () => {
  it('shows the car: name, plate and its details', async () => {
    const view = await render(<VehicleSummaryStep vehicle={vehicle()} onEdit={jest.fn()} />);
    expect(view.getByText('BMW 320d')).toBeTruthy();
    expect(view.getByText('Blue · 2019 · Saloon')).toBeTruthy();
    expect(view.getByText('AB12 CDE')).toBeTruthy();
  });

  it('every photo is there to swipe through', async () => {
    const view = await render(<VehicleSummaryStep vehicle={vehicle()} onEdit={jest.fn()} />);
    await act(async () => {
      fireEvent(view.getByTestId('vehicle-summary-photos'), 'layout', {
        nativeEvent: { layout: { width: 320 } },
      });
    });
    expect(view.getByText('1 / 3')).toBeTruthy();
  });

  it('lists the distinctive features only when there are some', async () => {
    const without = await render(<VehicleSummaryStep vehicle={vehicle()} onEdit={jest.fn()} />);
    expect(without.queryByText('Distinctive features')).toBeNull();

    const withMarks = await render(
      <VehicleSummaryStep
        vehicle={vehicle({
          distinctiveFeatures: [
            { photoUrl: 'https://x/f.jpg', description: 'Dent on rear door', position: 0 },
          ],
        })}
        onEdit={jest.fn()}
      />,
    );
    expect(withMarks.getByText('Distinctive features')).toBeTruthy();
    expect(withMarks.getByLabelText('Distinctive feature: Dent on rear door')).toBeTruthy();
  });

  it('"Edit details" opens the full questions', async () => {
    const onEdit = jest.fn();
    const view = await render(<VehicleSummaryStep vehicle={vehicle()} onEdit={onEdit} />);
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: "Edit your car's details" }));
    });
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('⚠️ the photos are display-only — Edit is the only way to change anything', async () => {
    const view = await render(
      <VehicleSummaryStep vehicle={vehicle({ plate: null })} onEdit={jest.fn()} />,
    );
    expect(view.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
      "Edit your car's details",
    ]);
  });
});
