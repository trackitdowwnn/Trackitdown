/**
 * WHAT:  The text of the three legal documents — Safety guidelines, Terms of
 *        service, Privacy policy — as structured data.
 * WHY:   ONE source of truth. These are rendered in-app today (so the Profile
 *        rows and the sign-in consent line open something real rather than a
 *        dead placeholder URL) and the same data is what gets published to the
 *        web when a domain exists — the App Store and Play Console both demand
 *        a public privacy-policy URL, which an in-app screen cannot satisfy.
 *        Keeping it as data rather than markdown avoids a renderer dependency
 *        and keeps the copy in the same review path as the code it describes.
 *
 * ⚠️ NOT LEGAL ADVICE — DRAFT PENDING SOLICITOR REVIEW.
 *        Written by reading what the app actually does, so the FACTS are
 *        accurate: the data collected, where it goes, the escrow mechanics,
 *        the retention rules. The LAW is not. Three areas need a UK solicitor
 *        before launch, and the first is not optional:
 *          1. HOLDING BOUNTY MONEY. Taking a payment from one user and later
 *             paying part of it to another can be a regulated payment service
 *             under the PSRs 2017. The Stripe Connect separate-charges-and-
 *             transfers model (ADR-0002) is the standard mitigation, but
 *             whether this arrangement needs FCA authorisation or falls under
 *             Stripe's is a question for a lawyer, not for us.
 *          2. LIABILITY AND SAFETY. We invite the public to look for stolen
 *             vehicles. The limitation-of-liability and safety wording must be
 *             checked against the Consumer Rights Act 2015 — you cannot
 *             exclude liability for death or personal injury from negligence.
 *          3. UK GDPR. The lawful bases named below are our reasoning, not a
 *             ruling, and the ICO registration fee likely applies.
 *
 * LINKS: src/features/legal/README.md (how to review + publish);
 *        src/shared/lib/legal.ts (where the links point);
 *        docs/SECURITY_AND_TRUST.md (the controls these documents describe);
 *        docs/DOMAIN.md (lifecycle + bounty rules the Terms restate).
 */

export type LegalDocumentSlug = 'safety' | 'terms' | 'privacy';

export interface LegalSection {
  heading: string;
  /** Paragraphs. A line starting with "• " renders as a bullet. */
  body: string[];
}

export interface LegalDocument {
  slug: LegalDocumentSlug;
  title: string;
  /** Shown under the title. Update whenever the text changes. */
  lastUpdated: string;
  intro: string[];
  sections: LegalSection[];
}

/** Bump when any document below changes materially. */
export const LEGAL_LAST_UPDATED = '23 August 2026';

/** The operator. Replace with the registered entity before launch. */
const OPERATOR = 'Trackitdown';

// =============================================================================
// SAFETY GUIDELINES
// The most important of the three, and the only one that is really OURS rather
// than a lawyer's: it is the promise the whole product rests on. Kept first,
// short, and in plain words — someone reads this when they have just spotted a
// car, not at leisure.
// =============================================================================
const SAFETY: LegalDocument = {
  slug: 'safety',
  title: 'Staying safe',
  lastUpdated: LEGAL_LAST_UPDATED,
  intro: [
    'Trackitdown exists to gather information, not to recover vehicles. Recovery is for the owner and the police.',
    'Read this before you report anything. It is short on purpose.',
  ],
  sections: [
    {
      heading: 'The one rule',
      body: [
        'Report from a distance. Never approach the vehicle, never follow it, and never confront anyone.',
        'A stolen car may be occupied, and the people in it may be dangerous. No bounty is worth your safety, and nothing in this app asks you to take a risk.',
      ],
    },
    {
      heading: 'If a crime is happening right now',
      body: [
        'Call 999. Do not use this app first.',
        'If it is not an emergency, report it to the police on 101 or through your local force’s website. Trackitdown is not a substitute for reporting a crime, and we are not connected to any police force.',
      ],
    },
    {
      heading: 'What a good report looks like',
      body: [
        '• Taken from somewhere you were already safely standing or passing.',
        '• A photo of the vehicle, not of people. Do not photograph anyone’s face.',
        '• Honest about doubt. "I think this might be it" is useful. A confident guess is not.',
        'If you cannot take a photo safely, do not take one. You can report a sighting without one.',
      ],
    },
    {
      heading: 'Never do these',
      body: [
        '• Do not attempt to stop, block, immobilise or retrieve a vehicle.',
        '• Do not tail a vehicle on foot or by car.',
        '• Do not approach or challenge anyone you believe is involved.',
        '• Do not share a sighting publicly, on social media, or in any group chat. It can reach the thief before it reaches the owner and it can put the owner at risk.',
        '• Do not enter private property to get a closer look.',
      ],
    },
    {
      heading: 'If you are the owner',
      body: [
        'Report the theft to the police first and get a crime reference number. Your insurer will need it, and so may we if a sighting is disputed.',
        'When a sighting comes in, pass it to the police. Do not go to the location yourself. We know that is hard advice to follow about your own car, and we mean it anyway.',
      ],
    },
    {
      heading: 'Location and your privacy',
      body: [
        'Where a car was last seen is shown only roughly to other people when the theft was from a home address, because that address is yours.',
        'When you set an alert area, the location you choose is rounded to roughly a kilometre before we store it. We do not keep the exact point.',
      ],
    },
    {
      heading: 'Telling us about a problem',
      body: [
        'You can report a listing from the listing itself. If you believe someone is using Trackitdown to track a person rather than find a vehicle, report it and we will act on it.',
        'We would always rather hear about a suspicion that turns out to be nothing than miss one that does not.',
      ],
    },
  ],
};

// =============================================================================
// TERMS OF SERVICE
// =============================================================================
const TERMS: LegalDocument = {
  slug: 'terms',
  title: 'Terms of service',
  lastUpdated: LEGAL_LAST_UPDATED,
  intro: [
    `These terms are an agreement between you and ${OPERATOR}. By creating an account you accept them.`,
    'They are written to be read. Where a term matters to your money or your safety, it is stated plainly rather than buried.',
  ],
  sections: [
    {
      heading: 'What Trackitdown is',
      body: [
        'Trackitdown is a noticeboard. Owners list vehicles that have been stolen and offer a reward for information. Other people report where they have seen one.',
        'We are an information service. We do not recover vehicles, we are not a security company, we are not insurers, and we are not connected to any police force. We do not verify that a listed vehicle was stolen, that the person listing it owns it, or that any sighting is accurate.',
      ],
    },
    {
      heading: 'Who can use it',
      body: [
        'You must be 18 or over and resident in the United Kingdom. The service covers UK vehicles only.',
        'You may hold one account. You are responsible for what happens under it.',
      ],
    },
    {
      heading: 'Safety comes before everything else in these terms',
      body: [
        'You must not approach, follow, stop or attempt to recover any vehicle, and you must not approach or confront any person, in connection with anything you see on Trackitdown.',
        'Breaking this is a breach of these terms and we may close your account for it. More importantly, it may get you hurt.',
      ],
    },
    {
      heading: 'Listing a vehicle',
      body: [
        'By listing a vehicle you confirm that it is yours or that you are authorised to act for the owner, that it has genuinely been stolen, and that you have reported or will report it to the police.',
        'You must not list a vehicle in order to locate a person. Using Trackitdown to track, monitor or harass anyone is the most serious misuse of this service. We will close the account and we may pass information to the police.',
        'You are responsible for what you write. Do not include anyone’s personal details, accusations against named individuals, or anything you cannot stand behind.',
      ],
    },
    {
      heading: 'The bounty and how the money works',
      body: [
        'When you publish a listing you pay the bounty up front. It is held by our payment provider and is not ours to spend.',
        // ⚠️ The floor moved to £10 on 2026-08-13 and this said £50 until
        // 2026-08-23 — the Terms stated a minimum the app had stopped enforcing,
        // so a lawful £10 listing was one the document called impossible. Kept
        // as a LITERAL rather than interpolated from MIN_BOUNTY_PENCE on purpose:
        // legal text should change by a decision, not as a side effect of a
        // constant moving. Whoever moves the floor next must come here too.
        'The bounty is between £10 and £5,000. All amounts are in pounds sterling.',
        'If a sighting leads to your vehicle being recovered, you credit that sighting. The person who reported it receives 95% of the bounty. We keep 5%.',
        'Only one sighting can be credited per recovery. If several people helped, you choose the one that made the difference. We cannot split a bounty.',
        'If you recover the vehicle without anyone’s help, or you cancel the listing, or it expires, the bounty is refunded to you minus the card processing costs, which the card networks do not return to us. That deduction is shown to you before you pay.',
        'A listing lasts 90 days unless you cancel or renew it.',
      ],
    },
    {
      heading: 'Reporting a sighting, and being paid',
      body: [
        'Report only what you actually saw. Reporting a sighting you have invented, or one arranged with the owner, is fraud. We will withhold payment and may report it.',
        'Being credited is the owner’s decision. Reporting a sighting does not entitle you to the bounty, and a sighting that turns out to be the wrong car is not a failure — it is how this works.',
        'To be paid you must complete identity checks with our payment provider, Stripe. We cannot pay you until you do. Payments are made by Stripe to the account you give them, and their timescales apply.',
        'You are responsible for any tax due on a bounty you receive. If you are unsure, speak to HMRC or an accountant.',
      ],
    },
    {
      heading: 'If you think a bounty was withheld unfairly',
      body: [
        'Tell us. We will look at the sighting trail — what was reported, when, and what happened next — and we can credit a sighting on the owner’s behalf where the evidence is clear.',
        'We will not do this on the strength of assertion alone, in either direction.',
      ],
    },
    {
      heading: 'Photos and content you upload',
      body: [
        'You keep ownership of everything you upload. You give us permission to store it and to show it to the people who need to see it — a sighting photo goes to the vehicle’s owner, a listing photo goes to people searching.',
        'Only upload photos you took yourself. Do not upload photos of people.',
        'We may remove content that breaks these terms, and we may close listings that do.',
      ],
    },
    {
      heading: 'What we do not promise',
      body: [
        'We do not promise that a listing will lead to a recovery, that anyone will see it, or that any sighting reported to you is genuine or accurate.',
        'We do not promise the service will be available without interruption.',
        'Nothing here limits our liability for death or personal injury caused by our negligence, for fraud, or for anything else that cannot be excluded under English law. Subject to that, we are not liable for loss arising from your use of the service beyond the amount you have paid us.',
      ],
    },
    {
      heading: 'Closing your account',
      body: [
        'You can delete your account at any time from your profile. If you have a listing with a bounty in escrow you will need to cancel or complete it first, because we cannot leave money without an owner.',
        'We may suspend or close an account that breaks these terms, and we will refund any bounty still held unless we are required not to.',
      ],
    },
    {
      heading: 'Changes, and the law that applies',
      body: [
        'We may change these terms. If a change matters, we will tell you in the app before it takes effect.',
        'These terms are governed by the law of England and Wales, and the courts of England and Wales have jurisdiction. If you live in Scotland or Northern Ireland you may bring proceedings in your own courts.',
      ],
    },
  ],
};

// =============================================================================
// PRIVACY POLICY
// The factual accuracy here is the part that matters most and is the part this
// draft is strongest on — every claim below was checked against the schema,
// the Edge Functions and SECURITY_AND_TRUST.md rather than assumed.
// =============================================================================
const PRIVACY: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy policy',
  lastUpdated: LEGAL_LAST_UPDATED,
  intro: [
    `${OPERATOR} is the controller of the personal data described here.`,
    'This app handles location, vehicle details, photographs and payments, so this policy is specific rather than generic. If something below is not clear, ask us before you use the service.',
  ],
  sections: [
    {
      heading: 'What we collect',
      body: [
        '• Account: your email address, first name, the display name you choose, and a profile photo if you add one.',
        '• Vehicles: make, model, colour, year, body type, and photographs of vehicles you list or save.',
        '• Locations: where a listed vehicle was last seen; where a sighting was reported; and the centre of any alert area you set.',
        '• Sightings: your photograph, notes, and the details you confirm about the vehicle.',
        '• Messages: the content of messages between an owner and a spotter.',
        '• Payments: we do not see or store your card details. Stripe processes payments and holds that information.',
        '• Device: a push notification token for each device you sign in on, so we can notify you.',
        '• Activity: counts of sightings reported, sightings marked helpful, and recoveries credited.',
      ],
    },
    {
      heading: 'How we use it, and our lawful basis',
      body: [
        '• To run the service — publishing listings, delivering sightings, enabling messages, taking and releasing bounties. Basis: performance of our contract with you.',
        '• To notify you about a car near you or a message you have received. Basis: consent, given when you allow notifications. You can withdraw it in your device settings at any time.',
        '• To keep people safe and prevent fraud and misuse — moderation, reviewing reports, investigating suspicious activity. Basis: our legitimate interests in a safe and honest service.',
        '• To meet legal obligations, including financial record-keeping.',
      ],
    },
    {
      heading: 'Location, in detail',
      body: [
        'Location is the most sensitive thing here, so we are specific.',
        'When a vehicle is reported stolen from a home address, the last-seen point is deliberately coarsened to roughly a kilometre for everyone except the owner, because that point is somebody’s home.',
        'When you set an alert area, we round the centre to roughly a kilometre before storing it. We never hold the exact location you chose. This happens on our servers, not in the app, so it is not something the app can be persuaded to skip.',
        'A sighting’s location is shown to the vehicle’s owner exactly, because that is the information they need. It is not shown publicly.',
        'We do not track your location in the background. The app asks for location only while you are using it.',
      ],
    },
    {
      heading: 'Notifications and what travels in them',
      body: [
        'Push notifications leave our systems and pass through Expo and then Apple or Google, so their contents are readable by those companies.',
        'Because of that, a notification carries only a make, a colour and a district-level area — never a number plate, never coordinates, and never the contents of a message. The app fetches the detail after you tap, over an authenticated connection.',
      ],
    },
    {
      heading: 'Who we share it with',
      body: [
        '• Supabase — hosting, database and file storage, in the EU (Ireland).',
        '• Stripe — payments and identity checks for anyone receiving a bounty. Stripe is a controller in its own right for that.',
        '• Expo, and Apple or Google — delivery of push notifications.',
        '• Google Maps — map display and converting locations into place names.',
        '• The police, if we are required to disclose information or where we believe it is necessary to prevent harm.',
        'We do not sell personal data and we do not use it for advertising.',
      ],
    },
    {
      heading: 'How long we keep it',
      body: [
        'A closed listing stays visible for 30 days after it closes, then leaves public view.',
        'The detailed location history attached to a closed listing’s sightings is deleted after 90 days.',
        'Payment records are kept for as long as financial and tax law requires, which is longer than the rest.',
        'Everything else is kept while your account exists.',
      ],
    },
    {
      heading: 'Deleting your account',
      body: [
        'You can delete your account from your profile. It removes your profile, your listings, your sightings, your saved vehicles, your alerts and your photographs.',
        'Two things do not go. Photographs you took of somebody else’s stolen vehicle stay attached to that listing, because they are evidence in someone else’s live case and removing them would take away their only record. Once your account is gone those photographs are no longer linked to you. And we keep a minimal record that a deletion happened, plus any payment references we are required to retain.',
        'If you have a listing with a bounty in escrow, cancel or complete it first — we cannot delete an account while it holds money.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        'You have the right to ask for a copy of your data, to have it corrected, to have it deleted, to object to or restrict how we use it, and to receive it in a portable form.',
        'The quickest route for most of these is the app itself — edit your profile, or delete your account. For anything else, contact us.',
        'If you are unhappy with how we have handled your data you can complain to the Information Commissioner’s Office at ico.org.uk, though we would appreciate the chance to put it right first.',
      ],
    },
    {
      heading: 'Children',
      body: [
        'Trackitdown is for adults. It is not intended for anyone under 18 and we do not knowingly collect their data.',
      ],
    },
    {
      heading: 'Contact',
      body: [
        'You can reach us from the Contact support link in your profile.',
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocumentSlug, LegalDocument> = {
  safety: SAFETY,
  terms: TERMS,
  privacy: PRIVACY,
};

export function legalDocument(slug: string): LegalDocument | null {
  // Object.hasOwn, NOT `in`: `in` walks the prototype chain, so a slug of
  // 'constructor' or 'toString' would resolve to a function and be rendered as
  // a document. The slug comes straight from a route param.
  return Object.hasOwn(LEGAL_DOCUMENTS, slug)
    ? LEGAL_DOCUMENTS[slug as LegalDocumentSlug]
    : null;
}
