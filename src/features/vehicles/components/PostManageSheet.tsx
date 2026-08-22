/**
 * WHAT:  PostManageSheet — the owner's action sheet for THIS listing, opened by
 *        the sticky bar's "Manage post". A ListRow menu: view sightings, activity, one row
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

import { Ban, Banknote, ChartNoAxesColumn, Eye, Pencil, Share2, Trash2 } from 'lucide-react-native';
import { useImperativeHandle, useRef, type Ref } from 'react';

import { BottomSheet, ListRow, type BottomSheetRef } from '@/shared/ui';

export interface PostManageSheetProps {
  ref?: Ref<BottomSheetRef>;
  /** OWNER only: open their sighting list. */
  onViewSightings: () => void;
  /** Opens the per-listing activity stats. */
  onViewStats: () => void;
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
  /**
   * OWNER + DRAFT only: delete the draft for good. Mutually exclusive with
   * onDeactivate — a draft has no escrow to refund, and a paid listing
   * cannot be deleted at all.
   *
   * Opens the parent's confirm; never deletes straight from a row tap. It is
   * irreversible and there is no tombstone, so the confirm is the only thing
   * standing between a mis-tap and a lost draft.
   */
  onDeleteDraft?: () => void;
  /**
   * OWNER + `recovery_claimed` only: try sending the credited spotter their
   * bounty again.
   *
   * Exists because the usual answer the first time is "they haven't given
   * Stripe their details yet", which leaves the listing sitting between states
   * with the money still in escrow. Without a row here the owner has NO action
   * on such a post — they credited someone and the app went quiet. Safe to tap
   * repeatedly: the transfer carries a per-post idempotency key, so a second
   * press can never pay twice.
   */
  onReleasePayout?: () => void;
}

export function PostManageSheet({
  ref,
  onViewSightings,
  onViewStats,
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
  onDeleteDraft,
  onReleasePayout,
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

      {/* Beneath sightings on purpose: sightings are the thing an owner came
          for, activity is the context around it. */}
      <ListRow
        icon={ChartNoAxesColumn}
        title="View activity"
        onPress={run(onViewStats)}
        testID="manage-view-stats"
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

      {/* Only on a listing whose spotter is credited but unpaid. Not
          destructive and not a confirm: it moves money that is already
          promised, to a person already chosen. */}
      {onReleasePayout ? (
        <ListRow
          icon={Banknote}
          title="Send the bounty"
          subtitle="Try again to pay the spotter you credited."
          onPress={run(onReleasePayout)}
          testID="manage-release-payout"
        />
      ) : null}

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

      {/* DRAFT ONLY, and mutually exclusive with the row above: a draft has no
          escrow to refund, and a paid listing cannot be deleted at all. The
          parent decides which by passing one handler or the other.

          Says "Delete", not "Discard" or "Remove", because it is permanent —
          there is no tombstone and no undo. A draft was never published, so
          there is nothing to preserve and nobody to inform; leaving a cancelled
          row behind would be the clutter the owner is trying to clear, wearing
          a different label. The parent's confirm is what makes it safe. */}
      {onDeleteDraft ? (
        <ListRow
          icon={Trash2}
          title="Delete draft"
          subtitle="Removes it for good. This can’t be undone."
          destructive
          onPress={run(onDeleteDraft)}
          testID="manage-delete-draft"
        />
      ) : null}
    </BottomSheet>
  );
}
