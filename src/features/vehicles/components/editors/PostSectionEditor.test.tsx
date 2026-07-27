/**
 * WHAT:  Tests for the shared PostSectionEditor scaffold — Save is gated on
 *        canSave, a successful save toasts + calls onSaved, and a failed save
 *        (PostSubmissionError) keeps the editor OPEN with the message (the
 *        money/retry-safe rule every section editor inherits).
 * WHY:   All 7 editors delegate their save/busy/error handling here, so this one
 *        scaffold test pins the "never lose an edit to a blip" behaviour once.
 * LINKS: src/features/vehicles/components/editors/PostSectionEditor.tsx, docs/TESTING.md.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  EditorPresentationContext,
  type EditorPresentation,
} from './editorPresentation';
import { PostSectionEditor } from './PostSectionEditor';

const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View, Text, Pressable } = require('react-native');
  return {
    Screen: ({ children }: { children: React.ReactNode }) => (
      <View testID="full-screen-scaffold">{children}</View>
    ),
    useToast: () => ({ show: mockToastShow }),
    Button: ({
      label,
      onPress,
      disabled,
    }: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <Pressable testID={`btn-${label}`} disabled={disabled} onPress={disabled ? undefined : onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

jest.mock('@/features/vehicles/post', () => {
  class PostSubmissionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return { PostSubmissionError };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- pull the mocked class
const { PostSubmissionError } = require('@/features/vehicles/post');

function renderEditor(
  props: Partial<React.ComponentProps<typeof PostSectionEditor>> = {},
  presentation: EditorPresentation = 'screen',
) {
  return render(
    <EditorPresentationContext value={presentation}>
      <PostSectionEditor
        title="Bounty"
        onClose={props.onClose ?? jest.fn()}
        onSave={props.onSave ?? jest.fn(async () => {})}
        onSaved={props.onSaved ?? jest.fn()}
        canSave={props.canSave ?? true}
      >
        <Text>body</Text>
      </PostSectionEditor>
    </EditorPresentationContext>,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('PostSectionEditor', () => {
  it('saves, toasts, and calls onSaved on success', async () => {
    const onSave = jest.fn(async () => {});
    const onSaved = jest.fn();
    const { getByTestId } = await renderEditor({ onSave, onSaved });

    fireEvent.press(getByTestId('btn-Save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(mockToastShow).toHaveBeenCalledWith('Changes saved', 'success');
  });

  it('keeps the editor open and shows the message when the save fails', async () => {
    const onSave = jest.fn(async () => {
      throw new PostSubmissionError('This post can no longer be edited.', 'POST_NOT_EDITABLE');
    });
    const onSaved = jest.fn();
    const { getByTestId, getByText } = await renderEditor({ onSave, onSaved });

    fireEvent.press(getByTestId('btn-Save'));

    await waitFor(() => expect(getByText('This post can no longer be edited.')).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled(); // stays open for retry
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it('does not save when canSave is false', async () => {
    const onSave = jest.fn(async () => {});
    const { getByTestId } = await renderEditor({ onSave, canSave: false });

    fireEvent.press(getByTestId('btn-Save'));

    expect(onSave).not.toHaveBeenCalled();
  });

  describe('presentation', () => {
    it('screen mode brings its own full-screen scaffold', async () => {
      const { getByTestId, getByText } = await renderEditor({}, 'screen');
      expect(getByTestId('full-screen-scaffold')).toBeTruthy();
      expect(getByText('Bounty')).toBeTruthy();
    });

    // The host's BottomSheet supplies the surface, the safe-area padding and the
    // scrolling. A Screen (or a ScrollView) here would nest scrollers inside
    // BottomSheetScrollView and break both the sheet's drag-to-close and the
    // inner scroll — so sheet mode must render bare.
    it('sheet mode renders bare — no Screen — but keeps title, body and actions', async () => {
      const { queryByTestId, getByTestId, getByText } = await renderEditor({}, 'sheet');
      expect(queryByTestId('full-screen-scaffold')).toBeNull();
      expect(getByText('Bounty')).toBeTruthy();
      expect(getByText('body')).toBeTruthy();
      expect(getByTestId('btn-Save')).toBeTruthy();
      expect(getByTestId('btn-Cancel')).toBeTruthy();
    });

    it('sheet mode still saves through the shared lifecycle', async () => {
      const onSave = jest.fn(async () => {});
      const onSaved = jest.fn();
      const { getByTestId } = await renderEditor({ onSave, onSaved }, 'sheet');

      fireEvent.press(getByTestId('btn-Save'));

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(mockToastShow).toHaveBeenCalledWith('Changes saved', 'success');
    });
  });
});
