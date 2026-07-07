/**
 * WHAT:  Public surface of the shared data layer.
 * WHY:   Features import from '@/shared/api' and never reach into internal
 *        files, keeping the data layer small and swappable.
 * LINKS: docs/ARCHITECTURE.md (shared/ rules).
 */

export { supabase } from './supabase';
