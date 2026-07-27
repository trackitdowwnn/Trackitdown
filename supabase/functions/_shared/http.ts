/**
 * WHAT:  Small HTTP helpers shared by the Edge Functions — permissive CORS
 *        headers for the browser preflight, and JSON / error response builders.
 * WHY:   The RN app invokes these functions via supabase.functions.invoke,
 *        which issues an OPTIONS preflight; every function must answer it and
 *        return JSON with the CORS headers, so that boilerplate lives in one
 *        place. The error helper keeps a stable { error, code } shape the
 *        client maps to user-facing copy.
 * LINKS: supabase/functions/create-payment-intent/index.ts;
 *        supabase/functions/stripe-webhook/index.ts;
 *        src/features/payments/api/paymentsApi.ts (the client that reads code).
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** A JSON response with the CORS headers attached. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** A JSON error carrying a stable machine `code` plus a human `error` line. */
export function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: message, code }, status);
}

/** The standard preflight answer; return this for an OPTIONS request. */
export function preflightResponse(): Response {
  return new Response('ok', { headers: corsHeaders });
}
