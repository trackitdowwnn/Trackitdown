/**
 * WHAT:  PostManageSheet — the owner's action sheet for THIS listing, opened by
 *        the sticky bar's "Manage post". A ListRow menu: view sightings, one row
 *        per section they're currently allowed to edit, share, and (paid posts)
 *        the destructive deactivate + refund.
 * WHY:   "Manage post" used to navigate to /my-posts, which threw the owner off
 *        the very listing they were managing to look at a list containing it —
 *        a dead end. Every owner action already exists on this screen (pencils,
 *        the deactivate block); this gathers them into one predictable place so
 *        the sticky bar's promise is kept without leaving the page. Rows are
 *        built from the handlers the parent passes, so the sheet can never offer
 *        an edit the server would reject: absent handler = absent row (the same
 *        presence-is-permission contract the pencils use).
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx (owner, builds the
 *          handlers from canEditDraftSection / canEditSafeSection / canDeactivate);
 *        src/features/vehicles/components/PostBottomBar.tsx (the trigger);
 *        src/shared/ui/BottomSheet.tsx + ListRow.tsx; docs/DESIGN_SYSTEM.md.
 */

import { Ban, Eye, Pencil, Share2 } from 'lucide-react-native';
import { useImperativeHandle, useRef, type Ref } from 'react';

import { BottomSheet, ListRow, type BottomSheetRef } from '@/shared/ui';

export interface PostManageSheetProps {
  ref?: Ref<BottomSheetRef>;
  /** OWNER only: open their sighting list. */
  onViewSightings: () => void;
  /** How many sightings this post has — shown as quiet row metadata. */
  sightingCount: number;
  /** Share the listing (the same payload as the header's share button). */
  onShare: () => void;
  // Per-section edit openers — passed ONLY when that section is editable for
  // this post's status. Absent = the row doesn't render.
  onEditCarDetails?: () => void;
  onEditPhotos?: () => void;
  onEditLastSeen?: () => void;
  onEditBounty?: () => void;
  onEditDescription?: () => void;
  onEditTheftContext?: () => void;
  onEditDistinctiveFeatures?: () => void;
  /** OWNER + PAID only: take the listing down and refund the bounty. Opens the
   *  parent's confirm — never deactivates straight from a row tap. */
  onDeactivate?: () => void;
}

export function PostManageSheet({
  ref,
  onViewSightings,
  sightingCount,
  onShare,
  onEditCarDetails,
  onEditPhotos,
  onEditLastSeen,
  onEditBounty,
  onEditDescription,
  onEditTheftContext,
  onEditDistinctiveFeatures,
  onDeactivate,
}: PostManageSheetProps) {
  const sheetRef = useRef<BottomSheetRef>(null);

  useImperativeHandle(ref, () => ({
    open: () => sheetRef.current?.open(),
    close: () => sheetRef.current?.close(),
  }));

  // Dismiss this sheet, then run the row's action. Deliberately NOT deferred to
  // the sheet's onDismiss: that would make every row silently do nothing if the
  // dismissal callback never arrived. The follow-on surfaces (the deactivate
  // confirm, a section editor) are happy to appear while this one animates out.
  const run = (action: () => void) => () => {
    sheetRef.current?.close();
    action();
  };

  const edits: { key: string; title: string; onPress?: () => void }[] = [
    { key: 'car_details', title: 'Edit car details', onPress: onEditCarDetails },
    { key: 'photos', title: 'Edit photos', onPress: onEditPhotos },
    { key: 'last_seen', title: 'Edit last seen', onPress: onEditLastSeen },
    { key: 'bounty', title: 'Edit reward', onPress: onEditBounty },
    { key: 'description', title: 'Edit description', onPress: onEditDescription },
    { key: 'theft_context', title: 'Edit how it was taken', onPress: onEditTheftContext },
    {
      key: 'distinctive_features',
      title: 'Edit distinctive features',
      onPress: onEditDistinctiveFeatures,
    },
  ];

  return (
    <BottomSheet ref={sheetRef} title="Manage your listing">
      <ListRow
        icon={Eye}
        title="View sightings"
        value={sightingCount > 0 ? String(sightingCount) : undefined}
        onPress={run(onViewSightings)}
        testID="manage-view-sightings"
      />

      {edits.map(({ key, title, onPress }) =>
        onPress ? (
          <ListRow
            key={key}
            icon={Pencil}
            title={title}
            onPress={run(onPress)}
            testID={`manage-edit-${key}`}
          />
        ) : null,
      )}

      <ListRow icon={Share2} title="Share listing" onPress={run(onShare)} testID="manage-share" />

      {/* Destructive, and last — the refund confirm is the parent's dialog. */}
      {onDeactivate ? (
        <ListRow
          icon={Ban}
          title="Deactivate & refund"
          subtitle="Takes the listing down and refunds your reward."
          destructive
          onPress={run(onDeactivate)}
          testID="manage-deactivate"
        />
      ) : null}
    </BottomSheet>
  );
}
