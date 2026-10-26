/**
 * WHAT:  Cloudflare Turnstile for the email-code request — its config, the
 *        tiny page the hidden WebView loads, and the messages it posts back.
 * WHY:   Security audit lead 5: the project-wide auth email budget could be
 *        drained by anyone holding the public key. Supabase checks a captcha
 *        token on /otp (and sign-up) once "Captcha protection" is on; Google,
 *        Apple, token refresh and code verification are exempt. Turnstile is
 *        usually invisible; it asks a person to tap only when unsure.
 *        Unconfigured (no site key) = no captcha, so the app can ship before
 *        the dashboard switch is flipped — and MUST, or sign-in breaks.
 * LINKS: hooks/useCaptcha.tsx (the WebView); api/authApi.ts requestEmailOtp;
 *        src/features/auth/README.md (setup order).
 */

export interface CaptchaConfig {
  siteKey: string;
  /** An https origin on the Turnstile widget's hostname list — the page's
   *  base URL, because Turnstile checks the hostname it is served from. */
  origin: string;
}

/** The configured Turnstile widget, or null when captcha is off. */
export function captchaConfig(): CaptchaConfig | null {
  const siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const origin = process.env.EXPO_PUBLIC_TURNSTILE_ORIGIN?.trim();
  if (!siteKey || !origin || !origin.startsWith('https://')) return null;
  return { siteKey, origin };
}

/**
 * The widget page. `execution: 'execute'` = a fresh token only when asked
 * (window.getToken), because Supabase accepts each token once.
 * `interaction-only` = invisible unless Cloudflare wants a tap.
 */
export function turnstileHtml(siteKey: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" async defer></script>
</head><body style="margin:0;background:transparent;display:flex;justify-content:center">
<div id="w"></div>
<script>
function send(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
var id=null,queued=false;
function run(){turnstile.reset(id);turnstile.execute(id);}
function onTurnstileLoad(){
  id=turnstile.render('#w',{sitekey:${JSON.stringify(siteKey)},execution:'execute',appearance:'interaction-only',
    callback:function(t){send({type:'token',token:t});},
    'error-callback':function(){send({type:'error'});return true;},
    'before-interactive-callback':function(){send({type:'interactive'});},
    'after-interactive-callback':function(){send({type:'done'});}});
  if(queued){queued=false;run();}
}
window.getToken=function(){if(id===null){queued=true;return;}run();};
</script></body></html>`;
}

export type TurnstileMessage =
  | { type: 'token'; token: string }
  | { type: 'error' | 'interactive' | 'done' };

/** A message from the widget page, or null for anything else. */
export function parseTurnstileMessage(data: string): TurnstileMessage | null {
  try {
    const m = JSON.parse(data) as { type?: unknown; token?: unknown };
    if (m.type === 'token') {
      return typeof m.token === 'string' && m.token ? { type: 'token', token: m.token } : null;
    }
    if (m.type === 'error' || m.type === 'interactive' || m.type === 'done') {
      return { type: m.type };
    }
    return null;
  } catch {
    return null;
  }
}
