/**
 * WHAT:  Dev-only component sandbox — a live playground that renders the shared
 *        UI components (TextField, BottomSheet) in every variant and state.
 * WHY:   Lets us eyeball and interact with components in the real app (focus,
 *        error, disabled, plate uppercasing, sheet open/dismiss/keyboard)
 *        without wiring them into a feature yet. Add a new <Section> here
 *        whenever a shared component lands. Not a shipped screen — remove or
 *        gate before launch.
 * LINKS: src/shared/ui, src/shared/theme, docs/DESIGN_SYSTEM.md.
 */

import { useRouter } from 'expo-router';
import { type ReactNode, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFullscreenLoader } from '@/shared/hooks';
import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { colors, radii, spacing, typography } from '@/shared/theme';
import type { LocationValue, PostSummary } from '@/shared/types';
import {
  BottomSheet,
  Button,
  DateTimeField,
  defaultBountyPanelCopy,
  FullscreenLoader,
  LocationPicker,
  LocationPickerModal,
  MoneySlider,
  PermissionPrimer,
  PhotoGridPicker,
  photoListSchema,
  SelectField,
  SkeletonVehicleCard,
  TextField,
  VehicleCard,
  type BottomSheetRef,
  type PickedPhoto,
  type SelectOption,
} from '@/shared/ui';
import { AppMap } from '@/shared/ui/AppMap';
import {
  SIGHTING_CAMERA_PRIMER,
  SIGHTING_LOCATION_PRIMER,
} from '@/features/sightings/components/sightingSteps';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Module-level (render must stay pure): the plain demo field allows a year ahead.
const A_YEAR_AHEAD = new Date(Date.now() + 365 * 24 * 3600_000);

/** Mock feed exercising the card's states; picsum photos are dev-only. */
const photo = (seed: number) => ({ uri: `https://picsum.photos/seed/car${seed}/800/600` });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const MOCK_FEED: PostSummary[] = [
  {
    id: 'mock-1',
    photos: [photo(1), photo(2), photo(3)],
    make: 'BMW',
    model: '3 Series',
    colour: 'Blue',
    plate: 'AB12 CDE',
    status: 'active',
    lastSeenAt: hoursAgo(2),
    lastSeenArea: 'Camden',
    distanceMiles: 2.3,
    bountyPence: 50000,
  },
  {
    id: 'mock-2',
    photos: [photo(4)],
    make: 'Ford',
    model: 'Fiesta',
    colour: 'Red',
    plate: 'CX68 PLR',
    status: 'active',
    lastSeenAt: hoursAgo(26),
    lastSeenArea: 'Peckham',
    distanceMiles: 0.8,
    bountyPence: 25000,
  },
  {
    id: 'mock-3',
    photos: [photo(5), photo(6)],
    make: 'Land Rover',
    model: 'Range Rover Autobiography LWB',
    colour: 'Santorini Black',
    plate: 'RR70 LUX',
    status: 'recovered',
    lastSeenAt: hoursAgo(96),
    lastSeenArea: 'Hampstead Garden Suburb',
    distanceMiles: 11.4,
    bountyPence: 500000,
  },
  {
    id: 'mock-4',
    photos: [],
    make: 'Vauxhall',
    model: 'Corsa',
    colour: 'Silver',
    plate: 'VK19 HJD',
    status: 'pending_verification',
    lastSeenAt: hoursAgo(1),
    distanceMiles: 4.1,
    bountyPence: 7550,
  },
  {
    id: 'mock-5',
    photos: [photo(7), photo(8), photo(9), photo(10), photo(11)],
    make: 'Mercedes-Benz',
    model: 'A-Class',
    colour: 'White',
    plate: 'MB21 AMG',
    status: 'active',
    lastSeenAt: hoursAgo(0.01),
    lastSeenArea: 'Shoreditch',
    bountyPence: 120000,
  },
  {
    id: 'mock-6',
    photos: [photo(12)],
    make: 'Toyota',
    model: 'Yaris',
    colour: 'Green',
    plate: 'TY65 ECO',
    status: 'expired',
    lastSeenAt: hoursAgo(24 * 30),
    lastSeenArea: 'Brixton',
    distanceMiles: 6,
    bountyPence: 15000,
  },
];

/** ~45 UK-market makes, sectioned A–Z, to exercise search + sticky headers. */
const CAR_MAKES: SelectOption[] = [
  'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Citroën', 'Cupra',
  'Dacia', 'DS', 'Ferrari', 'Fiat', 'Ford', 'Genesis', 'Honda', 'Hyundai',
  'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Land Rover', 'Lexus', 'Lotus',
  'Maserati', 'Mazda', 'McLaren', 'Mercedes-Benz', 'MG', 'MINI', 'Mitsubishi',
  'Nissan', 'Peugeot', 'Polestar', 'Porsche', 'Renault', 'Rolls-Royce',
  'SEAT', 'Škoda', 'Smart', 'Subaru', 'Suzuki', 'Tesla', 'Toyota',
  'Vauxhall', 'Volkswagen', 'Volvo',
].map((label) => ({
  value: label.toLowerCase().replace(/[^a-z]+/g, '-'),
  label,
  section: label[0].toUpperCase(),
}));

function ColourDot({ colour }: { colour: string }) {
  return <View style={[styles.colourDot, { backgroundColor: colour }]} />;
}

/** Simple flat select with leading colour dots (theme-token colours). */
const COLOUR_OPTIONS: SelectOption[] = [
  { value: 'orange', label: 'Orange', icon: <ColourDot colour={colors.primary} /> },
  { value: 'terracotta', label: 'Terracotta', icon: <ColourDot colour={colors.accent} /> },
  { value: 'grey', label: 'Grey', icon: <ColourDot colour={colors.borderStrong} /> },
  { value: 'charcoal', label: 'Charcoal', icon: <ColourDot colour={colors.textPrimary} /> },
  { value: 'gold', label: 'Gold', icon: <ColourDot colour={colors.warning} /> },
];

// LocationPicker is driven by the real react-native-maps adapter (AppMap) and
// the real expo-location geocoding (expoLocationServices). On Android the map
// ONLY renders in a dev build (`npx expo run:android`) — Expo Go shows grey
// tiles because its bundled Maps key is dead (expo/expo#39301). Web falls
// back to AppMap.web (search-only).

export default function SandboxScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plate, setPlate] = useState('');
  const [notes, setNotes] = useState('');
  const [badEmail, setBadEmail] = useState('not an email');
  const [sheetName, setSheetName] = useState('');
  const [dismissCount, setDismissCount] = useState(0);
  const [make, setMake] = useState<string | null>(null);
  const [carColour, setCarColour] = useState<string | null>(null);
  const [lastTappedPost, setLastTappedPost] = useState<string | null>(null);
  const { loaderProps, run, update } = useFullscreenLoader();
  const [loaderOutcome, setLoaderOutcome] = useState('—');
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [anyTime, setAnyTime] = useState<string | null>(null);
  const [lastSeenLoc, setLastSeenLoc] = useState<LocationValue | null>(null);
  const [bountyPence, setBountyPence] = useState(20000);
  const [bareAmountPence, setBareAmountPence] = useState(10000);
  const [ownerPhotos, setOwnerPhotos] = useState<PickedPhoto[]>([]);
  const [photoTipsDismissed, setPhotoTipsDismissed] = useState(false);
  const [v5cPhotos, setV5cPhotos] = useState<PickedPhoto[]>([]);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [approxOnly, setApproxOnly] = useState(true);
  const [confirmedAlertLoc, setConfirmedAlertLoc] = useState<LocationValue | null>(null);

  const formatLoc = (loc: LocationValue) =>
    `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)} · ${loc.addressLabel || '(pin location)'}`;

  const runLoaderDemo = async (operation: () => Promise<void>, initialMessage?: string) => {
    try {
      await run(operation, initialMessage);
      setLoaderOutcome('resolved');
    } catch (error) {
      // The loader has ALREADY hidden itself by the time we get here.
      setLoaderOutcome(`failed: ${(error as Error).message}`);
    }
  };

  const basicSheetRef = useRef<BottomSheetRef>(null);
  const tallSheetRef = useRef<BottomSheetRef>(null);
  const formSheetRef = useRef<BottomSheetRef>(null);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.title}>Component sandbox</Text>
        <Text style={styles.subtitle}>A dev playground for shared UI components.</Text>

        <Section title="TextField · text">
          <TextField
            label="Full name"
            placeholder="Jane Smith"
            value={name}
            onChangeText={setName}
            helperText="As it appears on your documents"
          />
        </Section>

        <Section title="TextField · email">
          <TextField
            label="Email"
            variant="email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
          />
        </Section>

        <Section title="TextField · plate (auto-uppercases)">
          <TextField
            label="Number plate"
            variant="plate"
            placeholder="AB12 CDE"
            value={plate}
            onChangeText={setPlate}
            helperText={`Stored value: ${plate || '—'}`}
          />
        </Section>

        <Section title="TextField · multiline">
          <TextField
            label="Notes"
            variant="multiline"
            placeholder="Anything else we should know?"
            value={notes}
            onChangeText={setNotes}
          />
        </Section>

        <Section title="TextField · error state">
          <TextField
            label="Email"
            variant="email"
            value={badEmail}
            onChangeText={setBadEmail}
            error="Enter a valid email address"
          />
        </Section>

        <Section title="TextField · disabled">
          <TextField label="Reference" value="TID-000123" onChangeText={() => {}} disabled />
        </Section>

        <Section title="BottomSheet · basic">
          <Button label="Open basic sheet" onPress={() => basicSheetRef.current?.open()} />
          <Text style={styles.sectionNote}>
            Dismissed {dismissCount} {dismissCount === 1 ? 'time' : 'times'} (swipe down or tap
            the scrim)
          </Text>
        </Section>

        <Section title="BottomSheet · tall content (scrolls)">
          <Button label="Open tall sheet" onPress={() => tallSheetRef.current?.open()} />
        </Section>

        <Section title="BottomSheet · with TextField (keyboard)">
          <Button label="Open form sheet" onPress={() => formSheetRef.current?.open()} />
        </Section>

        <Section title="Wizard · full demo flow">
          <Button label="Start demo wizard" onPress={() => router.push('/wizard-demo')} />
        </Section>

        <Section title="SelectField · sectioned + search (car make)">
          <SelectField
            label="Car make"
            placeholder="Choose a make"
            options={CAR_MAKES}
            value={make}
            onChange={setMake}
            helperText="A–Z sections, sticky headers, debounced search"
          />
        </Section>

        <Section title="SelectField · flat with icons (colour)">
          <SelectField
            label="Colour"
            options={COLOUR_OPTIONS}
            value={carColour}
            onChange={setCarColour}
          />
        </Section>

        <Section title="VehicleCard · mock feed (tap vs swipe, badges, fallback)">
          <View style={styles.feed}>
            {MOCK_FEED.map((post) => (
              <VehicleCard
                key={post.id}
                post={post}
                onPress={() => setLastTappedPost(`${post.make} ${post.model}`)}
              />
            ))}
          </View>
          <Text style={styles.sectionNote}>
            Last tapped: {lastTappedPost ?? '—'} (swiping photos must not count as a tap)
          </Text>
        </Section>

        <Section title="DateTimeField · last-seen presets (max = now)">
          <DateTimeField
            label="When did you last see it?"
            value={lastSeenAt}
            onChange={setLastSeenAt}
            helperText="Roughly is fine"
          />
          <Text style={styles.sectionNote}>ISO: {lastSeenAt ?? '—'}</Text>
        </Section>

        <Section title="DateTimeField · plain, no presets">
          <DateTimeField
            label="Pick any date & time"
            value={anyTime}
            onChange={setAnyTime}
            presets={[]}
            maxDate={A_YEAR_AHEAD}
          />
          <Text style={styles.sectionNote}>ISO: {anyTime ?? '—'}</Text>
        </Section>

        <Section title="MoneySlider · bounty step (£50–£5,000, panel)">
          <Text style={styles.wizardHeadline}>Set your bounty</Text>
          <MoneySlider
            label="Bounty"
            valuePence={bountyPence}
            onChangePence={setBountyPence}
            minPence={5000}
            maxPence={500000}
            snapSteps={[{ upToPence: 50000, stepPence: 2500 }, { stepPence: 5000 }]}
            panel={defaultBountyPanelCopy}
            accessibilityLabel="Bounty amount"
            testID="sandbox-bounty-slider"
          />
          <Text style={styles.sectionNote}>Raw pence: {bountyPence}</Text>
        </Section>

        <Section title="MoneySlider · bare (£0–£1,000, no panel)">
          <MoneySlider
            valuePence={bareAmountPence}
            onChangePence={setBareAmountPence}
            minPence={0}
            maxPence={100000}
            snapSteps={[{ stepPence: 1000 }]}
            accessibilityLabel="Amount"
            testID="sandbox-bare-slider"
          />
          <Text style={styles.sectionNote}>Raw pence: {bareAmountPence}</Text>
        </Section>

        <Section title="PhotoGridPicker · wizard photo step (min 3 / max 6)">
          <Text style={styles.wizardHeadline}>Add photos of your car</Text>
          <PhotoGridPicker
            photos={ownerPhotos}
            onChangePhotos={setOwnerPhotos}
            minPhotos={3}
            maxPhotos={6}
            tipsVisible={!photoTipsDismissed}
            onDismissTips={() => setPhotoTipsDismissed(true)}
            testID="sandbox-owner-photos"
          />
          <Text style={styles.sectionNote}>
            Valid (wizard Next): {photoListSchema(3, 6).safeParse(ownerPhotos).success ? 'yes' : 'no'}
          </Text>
          <Text style={styles.sectionNote}>
            {ownerPhotos.length > 0
              ? ownerPhotos.map((p, i) => `${i}: ${p.uri.slice(-24)}`).join('\n')
              : 'No photos yet'}
          </Text>
        </Section>

        <Section title="PhotoGridPicker · V5C upload (min 1 / max 1)">
          <PhotoGridPicker
            photos={v5cPhotos}
            onChangePhotos={setV5cPhotos}
            minPhotos={1}
            maxPhotos={1}
            allowCamera
            copy={{
              tips: undefined,
              addLabel: 'Add your V5C photo',
              addMore: () => 'A clear photo of the whole logbook page',
              cameraLabel: 'Photograph it now',
              permissionBody:
                'To add a photo of your V5C logbook we need access to your photo library. You can allow this in Settings.',
            }}
            testID="sandbox-v5c-photo"
          />
          <Text style={styles.sectionNote}>URI: {v5cPhotos[0]?.uri.slice(-24) ?? '—'}</Text>
        </Section>

        <Section title="LocationPicker · embedded wizard step (last seen)">
          <Text style={styles.wizardHeadline}>Where did you last see it?</Text>
          <View style={styles.mapFrame}>
            <LocationPicker
              MapComponent={AppMap}
              locationServices={expoLocationServices}
              onLocationChange={setLastSeenLoc}
            />
          </View>
          <View style={styles.fakeFooter}>
            <Text style={styles.sectionNote}>
              {lastSeenLoc?.isSettled
                ? `Confirmed: ${formatLoc(lastSeenLoc)}`
                : 'Move the map to enable Next'}
            </Text>
            <Button label="Next" onPress={() => {}} disabled={!lastSeenLoc?.isSettled} />
          </View>
        </Section>

        <Section title="LocationPicker · full-screen modal (alert location)">
          <Button label="Open alert-location picker" onPress={() => setAlertModalOpen(true)} />
          <Text style={styles.sectionNote}>
            {confirmedAlertLoc
              ? `Confirmed: ${formatLoc(confirmedAlertLoc)} · approx area: ${approxOnly ? 'on' : 'off'}`
              : '—'}
          </Text>
        </Section>

        <Section title="FullscreenLoader · blocking waits only">
          <Button
            label="3s operation, two messages"
            onPress={() =>
              runLoaderDemo(async () => {
                await wait(1500);
                update('Processing payment…');
                await wait(1500);
              }, 'Uploading photos…')
            }
          />
          <Button
            label="Instant operation (600ms minimum)"
            onPress={() => runLoaderDemo(async () => {})}
          />
          <Button
            label="Failing operation (always hides)"
            onPress={() =>
              runLoaderDemo(async () => {
                await wait(1200);
                throw new Error('card declined');
              }, 'Processing payment…')
            }
          />
          <Text style={styles.sectionNote}>Last outcome: {loaderOutcome}</Text>
        </Section>

        <Section title="VehicleCard · skeleton + compact">
          <View style={styles.feed}>
            <SkeletonVehicleCard />
            <VehicleCard
              post={MOCK_FEED[0]}
              variant="compact"
              onPress={() => setLastTappedPost('compact card')}
            />
          </View>
        </Section>

        <Section title="PermissionPrimer · sighting location (ask, with opt-out)">
          <View style={styles.primerFrame}>
            <PermissionPrimer
              content={SIGHTING_LOCATION_PRIMER}
              onPrimary={() => {}}
              onSecondary={() => {}}
            />
          </View>
        </Section>

        <Section title="PermissionPrimer · sighting camera (ask, no opt-out)">
          <View style={styles.primerFrame}>
            <PermissionPrimer content={SIGHTING_CAMERA_PRIMER} onPrimary={() => {}} />
          </View>
        </Section>

        <Section title="PermissionPrimer · camera denied (OS-blocked → settings)">
          <View style={styles.primerFrame}>
            <PermissionPrimer
              content={SIGHTING_CAMERA_PRIMER}
              variant="denied"
              onPrimary={() => {}}
            />
          </View>
        </Section>

        <Section title="PermissionPrimer · tight frame (460pt — scrolls, actions reachable)">
          <View style={styles.primerFrameTight}>
            <PermissionPrimer
              content={SIGHTING_LOCATION_PRIMER}
              onPrimary={() => {}}
              onSecondary={() => {}}
            />
          </View>
        </Section>
      </ScrollView>

      <BottomSheet
        ref={basicSheetRef}
        title="Basic sheet"
        onDismiss={() => setDismissCount((count) => count + 1)}
      >
        <Text style={styles.sheetBody}>
          A content-fit modal sheet. It sizes to this text, dims the screen behind it, and closes
          on swipe-down, scrim tap, or the button below.
        </Text>
        <Button label="Close" onPress={() => basicSheetRef.current?.close()} />
      </BottomSheet>

      <BottomSheet ref={tallSheetRef} title="Tall sheet">
        {Array.from({ length: 20 }, (_, index) => (
          <Text key={index} style={styles.sheetBody}>
            Paragraph {index + 1} — enough content to pass the height cap, so the sheet stops
            short of full screen and this body scrolls instead.
          </Text>
        ))}
      </BottomSheet>

      <FullscreenLoader {...loaderProps} testID="sandbox-loader" />

      <BottomSheet ref={formSheetRef} title="Form sheet">
        <Text style={styles.sheetBody}>
          Tap the field — the sheet should rise with the keyboard so the input stays visible.
        </Text>
        <TextField
          label="Full name"
          placeholder="Jane Smith"
          value={sheetName}
          onChangeText={setSheetName}
        />
      </BottomSheet>

      <LocationPickerModal
        visible={alertModalOpen}
        title="Alert location"
        MapComponent={AppMap}
        locationServices={expoLocationServices}
        initialLocation={{ latitude: 51.5074, longitude: -0.1278 }}
        optionSlot={{
          title: 'Use approximate area only',
          caption: 'alerts still work, your exact home stays private',
          value: approxOnly,
          onValueChange: setApproxOnly,
        }}
        onConfirm={(value) => {
          setConfirmedAlertLoc(value);
          setAlertModalOpen(false);
        }}
        onCancel={() => setAlertModalOpen(false)}
      />
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textSecondary,
  },
  sectionNote: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sheetBody: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  colourDot: {
    width: spacing.lg,
    height: spacing.lg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  feed: {
    gap: spacing.xxl,
  },
  wizardHeadline: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  mapFrame: {
    height: 360,
  },
  // Bounded frame so the primer's flexGrow layout anchors its actions to the
  // bottom, as it does in the camera modal / wizard step.
  // The primer doesn't self-pad (hosts own the gutter) — these preview
  // frames stand in for a host screen, so they provide it.
  primerFrame: {
    height: 560,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: 'hidden',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  primerFrameTight: {
    height: 460,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: 'hidden',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  fakeFooter: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
