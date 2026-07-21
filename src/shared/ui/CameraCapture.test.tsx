/**
 * WHAT:  Tests for CameraCapture — the camera-permission primer states, and
 *        the evidence contract of a capture: photo + its OWN timestamp + its
 *        OWN GPS fix bundled atomically; a failed fix produces an UN-located
 *        photo (all three location fields absent), never a blocked capture.
 * WHY:   SAFETY — the evidence bundle is what makes a sighting resistant to
 *        fabrication; a photo must never borrow a location, and a spotter
 *        without GPS must still be able to report.
 * LINKS: src/shared/ui/CameraCapture.tsx, docs/DOMAIN.md (Sighting rules),
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { CameraCapture, type EvidencePhoto } from './CameraCapture';

const mockTakePicture = jest.fn();
const mockUseCameraPermissions = jest.fn();

jest.mock('expo-camera', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  return {
    CameraView: forwardRef((_props: object, ref: unknown) => {
      useImperativeHandle(ref as never, () => ({ takePictureAsync: mockTakePicture }));
      return null;
    }),
    useCameraPermissions: () => mockUseCameraPermissions(),
  };
});

const mockGetPermissions = jest.fn();
const mockGetPosition = jest.fn();
const mockGetLastKnown = jest.fn();
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: () => mockGetPermissions(),
  getCurrentPositionAsync: () => mockGetPosition(),
  getLastKnownPositionAsync: () => mockGetLastKnown(),
}));

const granted = { granted: true, canAskAgain: true };

async function pressShutter(getByLabelText: (label: string) => unknown) {
  await act(async () => {
    fireEvent.press(getByLabelText('Take photo') as never);
  });
}

describe('CameraCapture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCameraPermissions.mockReturnValue([granted, jest.fn()]);
    mockTakePicture.mockResolvedValue({ uri: 'file:///photo1.jpg' });
  });

  it('shows the camera primer while permission is undetermined', async () => {
    const request = jest.fn();
    mockUseCameraPermissions.mockReturnValue([{ granted: false, canAskAgain: true }, request]);
    const { getByText } = await render(
      <CameraCapture photos={[]} onChange={() => {}} maxPhotos={3} />,
    );
    fireEvent.press(getByText('Allow camera'));
    expect(request).toHaveBeenCalled();
  });

  it('offers settings with acknowledging copy when the permission is blocked', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: false, canAskAgain: false }, jest.fn()]);
    const { getByText, queryByText } = await render(
      <CameraCapture photos={[]} onChange={() => {}} maxPhotos={3} />,
    );
    expect(getByText('Camera access is off')).toBeTruthy();
    expect(getByText('Open settings')).toBeTruthy();
    // The ask-phase button is gone — no dead re-prompt.
    expect(queryByText('Allow camera')).toBeNull();
  });

  it('bundles photo + timestamp + GPS fix atomically on capture', async () => {
    mockGetPermissions.mockResolvedValue({ granted: true });
    mockGetPosition.mockResolvedValue({
      coords: { latitude: 51.54, longitude: -0.14, accuracy: 12 },
    });
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <CameraCapture photos={[]} onChange={onChange} maxPhotos={3} />,
    );
    await pressShutter(getByLabelText);

    const photo: EvidencePhoto = onChange.mock.calls[0][0][0];
    expect(photo.uri).toBe('file:///photo1.jpg');
    expect(photo.capturedAt).toEqual(expect.any(String));
    expect(photo.lat).toBe(51.54);
    expect(photo.lng).toBe(-0.14);
    expect(photo.accuracyM).toBe(12);
  });

  it('captures UN-located (no lat/lng/accuracy at all) when permission is missing', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false });
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <CameraCapture photos={[]} onChange={onChange} maxPhotos={3} />,
    );
    await pressShutter(getByLabelText);

    const photo: EvidencePhoto = onChange.mock.calls[0][0][0];
    expect(photo.uri).toBe('file:///photo1.jpg');
    expect(photo.capturedAt).toEqual(expect.any(String));
    expect(photo.lat).toBeUndefined();
    expect(photo.lng).toBeUndefined();
    expect(photo.accuracyM).toBeUndefined();
    expect(mockGetPosition).not.toHaveBeenCalled();
  });

  it('falls back to a recent last-known fix when the live fix fails', async () => {
    mockGetPermissions.mockResolvedValue({ granted: true });
    mockGetPosition.mockRejectedValue(new Error('gps down'));
    mockGetLastKnown.mockResolvedValue({
      coords: { latitude: 51.5, longitude: -0.1, accuracy: 150 },
    });
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <CameraCapture photos={[]} onChange={onChange} maxPhotos={3} />,
    );
    await pressShutter(getByLabelText);

    const photo: EvidencePhoto = onChange.mock.calls[0][0][0];
    // Poor accuracy is recorded with its value, not rejected.
    expect(photo.accuracyM).toBe(150);
  });

  it('disables the shutter at maxPhotos and removes on thumbnail tap', async () => {
    const photos: EvidencePhoto[] = [
      { uri: 'file:///a.jpg', capturedAt: '2026-07-14T10:00:00Z' },
      { uri: 'file:///b.jpg', capturedAt: '2026-07-14T10:01:00Z' },
    ];
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <CameraCapture photos={photos} onChange={onChange} maxPhotos={2} />,
    );
    expect(getByLabelText('Photo limit reached')).toBeTruthy();

    fireEvent.press(getByLabelText('Remove photo 1'));
    expect(onChange).toHaveBeenCalledWith([photos[1]]);
  });
});
