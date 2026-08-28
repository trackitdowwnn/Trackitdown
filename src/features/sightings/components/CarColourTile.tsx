/**
 * WHAT:  CarColourTile — a rounded tile filled with a car's real colour, with a
 *        car silhouette drawn over it. The leading visual on a report card.
 * WHY:   ⚠️ IT IS THE ONLY PICTURE THIS SCREEN IS ALLOWED TO HAVE. `My reports`
 *        lists sightings a spotter filed on OTHER people's cars, and
 *        `my_sighting_record` deliberately returns no photo, no plate, no
 *        location and no post id — a spotter's own history must not become a
 *        back door into listings they were never shown. So the Airbnb card
 *        anatomy we borrow everywhere else (a photograph leading the row) has
 *        nothing to lead with here, and five reports read as five identical
 *        grey text blocks. The car's COLOUR is the one visual fact the payload
 *        carries, and it happens to be the one a person actually remembers.
 *
 *        The fill is `swatchForName`'s hex, which is DATA and not a token
 *        (carColours.ts says so at length) — it must not move with the theme,
 *        because a blue car is blue in dark mode too. So must the ink over it,
 *        which is why `glyphInkFor` lives beside the fills rather than here.
 *
 *        ⚠️ BORDERED ALWAYS, NOT ONLY WHEN `light`. ColourField learned this
 *        the expensive way: gating the edge on `colour.light` was right while
 *        the surface behind it was always white, and dark mode inverted it —
 *        Black #1A1A1A on a #1E1E1E card is 1.03:1, so the most commonly picked
 *        colour in the palette rendered as an empty hole. A sample of paint
 *        needs an edge at both ends of the range.
 * LINKS: src/shared/lib/carColours.ts (the palette, the hexes,
 *          `swatchForName` and `glyphInkFor`);
 *        src/features/vehicles/post/components/ColourField.tsx (the same
 *          swatches as a grid, and the border story);
 *        ./ReportCard.tsx (the only consumer).
 */

import { Car } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { glyphInkFor, swatchForName } from '@/shared/lib';
import { radii, sizes, usePalette, useThemedStyles, type Palette } from '@/shared/theme';

export interface CarColourTileProps {
  /** The stored colour NAME ("Blue"), not a hex. Unrecognised or blank is a
   *  real state — the RPC coalesces to '' on a sparse post. */
  colour: string | null | undefined;
  testID?: string;
}

export function CarColourTile({ colour, testID }: CarColourTileProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const swatch = swatchForName(colour);

  return (
    <View
      style={[
        styles.tile,
        // Swatch fill is DATA (see carColours.ts), never a token. No swatch is
        // the honest blank: a neutral surface, and a themed glyph on it.
        swatch ? { backgroundColor: swatch.hex } : styles.tileUnknown,
      ]}
      testID={testID}
    >
      {swatch?.secondaryHex ? (
        // ⚠️ TWO-TONE GETS NO GLYPH. "Multicolour / wrapped" fills the right
        // half with a second colour, and a centred silhouette would then
        // straddle both — white over #C7CCD1 is 1.6:1 and near-black over
        // #2B4C7E is 2.02:1, so NO ink is legible across the seam. The tile
        // becomes a pure sample of paint, which is what "multicolour" means.
        <View
          style={[styles.half, { backgroundColor: swatch.secondaryHex }]}
          testID={testID ? `${testID}-secondary` : undefined}
        />
      ) : (
        // ⚠️ `CarColour.icon` IS DELIBERATELY NOT CARRIED OVER from ColourField,
        // which draws it instead of a fill for the "Other" escape. Here the
        // glyph slot is already spent saying "this is a car" — which is the
        // tile's whole job on a row with no photo — and "Other" is #E4E4E4, so
        // the car reads at 13.7:1 on it. A second glyph would have to replace
        // the first rather than join it.
        <Car
          size={sizes.carTileGlyph}
          color={swatch ? glyphInkFor(swatch) : palette.textSecondary}
        />
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    tile: {
      width: sizes.carTile,
      height: sizes.carTile,
      borderRadius: radii.lg,
      // `overflow: hidden` so the two-tone half is clipped to the corners.
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      // ⚠️ 1, NOT `hairlineWidth`, and ColourField:244 makes the same call for
      // the same reason. On a White #F4F5F7 tile against a #FFFFFF card this
      // edge is the ONLY thing that makes the tile a tile, and a hairline is
      // one physical pixel. The card's own hairline is a different job —
      // separating a large filled area, where a whisper is enough.
      borderWidth: 1,
      borderColor: c.borderStrong,
    },
    tileUnknown: {
      backgroundColor: c.surfaceSubtle,
    },
    half: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: '50%',
    },
  });
