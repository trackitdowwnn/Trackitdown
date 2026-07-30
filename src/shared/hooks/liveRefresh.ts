/**
 * WHAT:  LIVE_REFRESH_MS — the app's one background-poll cadence for screens
 *        that keep server facts fresh in place (sighting timelines, the post
 *        detail's sighting count).
 * WHY:   One number so every "live" surface breathes on the same beat, and a
 *        deliberate 30s: the events polled for are rare (sightings), the
 *        payloads small, and Realtime is not an option where RLS blocks the
 *        direct reads by design (the RPCs are the door — see the sightings
 *        hooks). Lives HERE (not in a feature) so any feature's hook can
 *        import it without dragging another feature's module graph — and its
 *        supabase client — into jest (the types.ts jest-safety precedent).
 * LINKS: src/features/sightings/hooks/*; src/features/vehicles/hooks/
 *        usePostDetail.ts (consumers).
 */

export const LIVE_REFRESH_MS = 30_000;
