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

import { colors, radii, spacing, typography } from '@/shared/theme';
import type { PostSummary } from '@/shared/types';
import {
  BottomSheet,
  Button,
  SelectField,
  SkeletonVehicleCard,
  TextField,
  VehicleCard,
  type BottomSheetRef,
  type SelectOption,
} from '@/shared/ui';

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
  { value: 'sage', label: 'Sage', icon: <ColourDot colour={colors.primary} /> },
  { value: 'terracotta', label: 'Terracotta', icon: <ColourDot colour={colors.accent} /> },
  { value: 'sand', label: 'Sand', icon: <ColourDot colour={colors.borderStrong} /> },
  { value: 'charcoal', label: 'Charcoal', icon: <ColourDot colour={colors.textPrimary} /> },
  { value: 'gold', label: 'Gold', icon: <ColourDot colour={colors.warning} /> },
];

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
});
