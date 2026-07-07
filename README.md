# Trackitdown

A React Native (Expo) app. Built with Expo Router and TypeScript.

## Getting started

```bash
npm install
npm start        # start the Expo dev server
```

Then open the app on:

- **iOS** — `npm run ios`
- **Android** — `npm run android`
- **Web** — `npm run web`

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the Expo dev server |
| `npm run lint` | Lint with `expo lint` |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm test` | Run the Jest test suite |

## Project structure

Code is organised by feature (vertical slices) — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full layout and the
rules that keep features decoupled. Other key docs:

- [`docs/DOMAIN.md`](docs/DOMAIN.md) — domain model and core loop
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) — UI/design system
- [`docs/COMMENTING_STANDARDS.md`](docs/COMMENTING_STANDARDS.md) — required file headers

Routes live in `src/app/` (thin Expo Router wrappers); feature code lives
under `src/features/`, and shared building blocks under `src/shared/`.
