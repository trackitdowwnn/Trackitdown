/**
 * WHAT:  OwnerCard — who owns this car, as one quiet row: an initial avatar,
 *        the first name, and one grey line of facts ("2 years on Trackitdown ·
 *        3 sightings"), in a hairline-outlined card.
 * WHY:   Redesigned 2026-09-24 from the Airbnb host "passport" (an elevated
 *        card, centred avatar, a column of big stats). Research across
 *        Dribbble and shipping apps (Uber, Vinted, eBay, Gumtree) agreed: the
 *        person behind a listing is a flat row — name first, facts second, the
 *        facts as one sentence-like line rather than numbers over labels. Big
 *        stats read as a dashboard, and "3 sightings" as a KPI is wrong for a
 *        theft victim; the passport sells a host, and our owner is not selling.
 *        No shadow: nothing here is tappable, and a shadow promises it is.
 *
 *        ⚠️ NO "VERIFIED" ANYWHERE. Ownership verification was removed on
 *        2026-07-30 (ADR-0007; SECURITY_AND_TRUST.md lists "no ownership check
 *        exists anywhere" as an open gap). The card used to call every owner
 *        "Verified owner", and the redesign briefly added a shield beside the
 *        name — both claimed a check nobody runs, to every viewer, on the very
 *        surface a fake poster would use to look legitimate (security review,
 *        2026-09-24). Do not bring either back without a real verification
 *        field from the server.
 *
 *        Identity rules (SAFETY, DOMAIN.md "Owner identity on a post"): first
 *        name only for signed-in viewers, a de-identified "Car owner" otherwise,
 *        initial-letter avatar only (a photo path would leak owner_id),
 *        member-since always present. Never a surname, owner_id, or contact
 *        path.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx (the "Message the
 *        owner" action sits below this, outside the card);
 *        docs/DOMAIN.md ("Owner identity on a post").
 */

import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import {
  cardSurface,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { Avatar } from '@/shared/ui';

import type { OwnerSummary } from '../types';

export interface OwnerCardProps {
  owner: OwnerSummary;
  /** This post's aggregate sighting count (never individual sightings). */
  sightingCount: number;
}

/** What a logged-out viewer sees in place of the name. Not "Verified owner" —
 *  see the header. */
const ANONYMOUS_OWNER = 'Car owner';

/**
 * Whole calendar months between memberSince and now, floored at 0 — or null
 * for a date that will not parse.
 *
 * ⚠️ UTC ON BOTH SIDES. The server sends the member-since MONTH as midnight UTC
 * on the 1st (get_post_detail: date_trunc('month', …)). Read in local time,
 * that is the last day of the PREVIOUS month anywhere west of UTC, and every
 * tenure came out a month long — someone who joined this month read "1 month"
 * instead of "New" (code review, 2026-09-24).
 */
function monthsSince(iso: string): number | null {
  const since = new Date(iso);
  if (Number.isNaN(since.getTime())) {
    return null;
  }
  const now = new Date();
  const months =
    (now.getUTCFullYear() - since.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - since.getUTCMonth());
  return Math.max(0, months);
}

/** "New to Trackitdown" this month (not a rounded-up "1 month"), then "5
 *  months on Trackitdown", then whole years from two — "26 months" reads
 *  like a glitch. Null when the date is unusable: no line beats "NaN months". */
function tenureText(memberSince: string): string | null {
  const months = monthsSince(memberSince);
  if (months === null) {
    return null;
  }
  if (months === 0) {
    return 'New to Trackitdown';
  }
  const years = Math.floor(months / 12);
  if (years >= 2) {
    return `${years} years on Trackitdown`;
  }
  return months === 1 ? '1 month on Trackitdown' : `${months} months on Trackitdown`;
}

/** Never a bare "0": on a victim's listing that reads as a failure. */
function sightingsText(count: number): string {
  if (count === 0) {
    return 'No sightings yet';
  }
  return count === 1 ? '1 sighting' : `${count} sightings`;
}

/**
 * The owner row on post detail — first name only when the viewer is signed in
 * (SAFETY); the facts are the owner's tenure and THIS POST's sighting count.
 */
export function OwnerCard({ owner, sightingCount }: OwnerCardProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  // Trimmed: a whitespace-only name is no name — never a blank heading.
  const firstName = owner.firstName?.trim() ?? '';
  const identified = firstName.length > 0;
  const name = identified ? firstName : ANONYMOUS_OWNER;
  const tenure = tenureText(owner.memberSince);
  const sightings = sightingsText(sightingCount);
  const facts = tenure ? `${tenure} · ${sightings}` : sightings;
  // Spoken, the count says whose it is: next to a person, "3 sightings" alone
  // could be heard as THEIR total rather than this car's.
  const spokenSightings =
    sightingCount === 0
      ? 'no sightings of this car yet'
      : `${sightings} of this car`;
  const spoken = [name, tenure, spokenSightings].filter(Boolean).join(', ');

  return (
    <View style={styles.card} accessible accessibilityLabel={spoken}>
      {identified ? (
        <Avatar name={firstName} size="md" />
      ) : (
        <View style={styles.anonymousAvatar}>
          {/* A plain person, not a shield: a shield reads as "verified". */}
          <Feather name="user" size={sizes.iconSm} color={palette.textSecondary} />
        </View>
      )}

      <View style={styles.text}>
        {/* Two lines, not one: at the largest text sizes a name or "Car
            owner" would otherwise truncate — the only identity fact a
            logged-out viewer gets. */}
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.facts}>{facts}</Text>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // The shared flat card (DESIGN_SYSTEM "Card": hairline edge, no shadow) —
  // the page's featureCard is the same grammar, and neither is tappable. The
  // xl radius is the one override: the person reads a touch softer.
  card: {
    ...cardSurface(c),
    borderRadius: radii.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  anonymousAvatar: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.full,
    backgroundColor: c.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // flex: 1 + minWidth 0 so a long facts line wraps instead of pushing the
  // card wider than the screen.
  text: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  name: {
    ...typography.heading,
    color: c.textPrimary,
  },
  facts: {
    ...typography.caption,
    color: c.textSecondary,
  },
});
