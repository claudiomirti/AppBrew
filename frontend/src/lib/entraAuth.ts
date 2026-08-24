/**
 * Entra sign-in for direct browser -> Eventhouse queries.
 *
 * Used only when the Vite KQL proxy is absent (i.e. a deployed static build). The Fabric
 * Kusto endpoint returns permissive CORS headers, so once the browser holds a token for the
 * cluster it can call the REST API directly — no backend required.
 *
 * In local development the proxy path is preferred and this module is never loaded.
 *
 * Goal: never show a login screen to someone who is already signed in to Fabric. Three
 * attempts, cheapest first:
 *
 *   1. acquireTokenSilent  — a token is already cached for this tab.
 *   2. ssoSilent           — hidden iframe to Entra. Only works where third-party cookies
 *                            are allowed, which most browsers no longer do by default.
 *   3. redirect with prompt=none — a full-page bounce through Entra. This is a *first-party*
 *                            navigation, so the existing Fabric session cookie is visible and
 *                            the round trip completes without any UI. `prompt=none` guarantees
 *                            that if there is no usable session the user gets an error we can
 *                            handle rather than an unexpected login page.
 *
 * Only if all three fail does the page offer an interactive sign-in button.
 */
import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser'
import { ENTRA_CLIENT_ID, ENTRA_TENANT_ID, KUSTO_SCOPE, LOGIN_HINT } from './eventhouseConfig'
import { SignInRequiredError } from './authTypes'

export { SignInRequiredError }

/**
 * Auth returns to this exact path, so the Stream Analytics page is remounted and picks the
 * response straight back up. Must be registered as a SPA redirect URI on the app.
 */
const REDIRECT_PATH = '/streams'

/**
 * Popups redirect here instead of to the app. A popup that loads the app would run a second
 * MSAL instance which consumes the auth response before the opener can read it, against a
 * cache that never held the request — the no_token_request_cache_error failure.
 */
const POPUP_REDIRECT_PATH = '/blank.html'

/**
 * Guards against a redirect loop: if the silent bounce comes back without an account we must
 * not immediately bounce again. Holds the timestamp of the last attempt, not a flag, so the
 * guard decays — a tab that failed once must still be able to recover on its own later (the
 * Fabric session may since have been renewed) instead of being stuck until site data is
 * cleared. sessionStorage (not localStorage) so a new tab retries immediately.
 */
const REDIRECT_ATTEMPTED_KEY = 'appbrew.sso.redirect-attempted'

/** How long one failed silent bounce suppresses the next. */
const REDIRECT_COOLDOWN_MS = 5 * 60 * 1000

/** Why the last silent redirect came back empty. Survives the bounce's page reload. */
const REDIRECT_DETAIL_KEY = 'appbrew.sso.redirect-detail'

/**
 * Time since the last silent bounce, or null if there has not been one. Returns "expired" for
 * a value this build did not write: older builds stored the flag `'1'`, and a tab holding one
 * would otherwise never retry.
 */
function sinceLastRedirect(): number | null {
  const raw = sessionStorage.getItem(REDIRECT_ATTEMPTED_KEY)
  if (!raw) return null
  const at = Number(raw)
  if (!Number.isFinite(at) || at <= 0) return REDIRECT_COOLDOWN_MS + 1
  return Date.now() - at
}

function markRedirectAttempted(): void {
  sessionStorage.setItem(REDIRECT_ATTEMPTED_KEY, String(Date.now()))
}

/** Drop the loop guard *and* the stored reason — they are only meaningful as a pair. */
function clearRedirectGuard(): void {
  sessionStorage.removeItem(REDIRECT_ATTEMPTED_KEY)
  sessionStorage.removeItem(REDIRECT_DETAIL_KEY)
}

let app: PublicClientApplication | null = null
let initialising: Promise<PublicClientApplication> | null = null

/**
 * The account to use, out of everything MSAL has cached.
 *
 * Taking `getAllAccounts()[0]` is only safe when there is exactly one. A browser signed in to
 * several tenants caches several, and picking the wrong one produces AADSTS16000 on every
 * silent attempt — the token can never be issued for it, but the ladder keeps retrying. When
 * LOGIN_HINT names the account this environment expects, honour it.
 */
function pickAccount(instance: PublicClientApplication): AccountInfo | null {
  const active = instance.getActiveAccount()
  const all = instance.getAllAccounts()
  if (!LOGIN_HINT) return active ?? all[0] ?? null
  const wanted = LOGIN_HINT.toLowerCase()
  const match = all.find(a => a.username?.toLowerCase() === wanted)
  if (match) return match
  // The hinted account is not cached. An account that contradicts the hint is worse than
  // none: it sends the ladder down a path that cannot succeed, whereas returning null goes
  // straight to SSO where the hint is applied.
  return null
}

/** Silent-auth failures, in order, surfaced in the page's diagnostic line. */
const authTrail: string[] = []
function noteAuth(detail: string): void {
  // Keep every step: the redirect reason arrives first and is the useful one, so a later
  // failure must not overwrite it.
  authTrail.push(detail)
  if (authTrail.length > 4) authTrail.shift()
}
export function getLastAuthDetail(): string {
  return authTrail.join(' · ')
}

async function getApp(): Promise<PublicClientApplication> {
  if (app) return app
  if (!initialising) {
    const instance = new PublicClientApplication({
      auth: {
        clientId: ENTRA_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`,
        redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
      },
      // sessionStorage keeps the token out of other tabs and clears on browser close.
      cache: { cacheLocation: 'sessionStorage' },
    })
    initialising = instance
      .initialize()
      // Consume a redirect response if we are returning from one. A failure here just means
      // silent SSO did not work (e.g. no session, or several accounts) — not fatal.
      // We already land back on the page that started the request, so skip MSAL's own
      // restore-the-original-URL navigation (which would cause a second page load).
      .then(() =>
        instance.handleRedirectPromise({ navigateToLoginRequestUrl: false }).catch(err => {
          // A response with no matching request means the cache and the response came from
          // different windows, or the back button restored this page from the bfcache and MSAL
          // dropped the request on `pageshow`. Either way it is a stale hash, not a rejected
          // sign-in: nothing is wrong with the session. Drop the guard *and* the stored reason
          // so the ladder starts clean rather than reporting this against a later failure.
          if ((err as { errorCode?: string }).errorCode === 'no_token_request_cache_error') {
            clearRedirectGuard()
            noteAuth('redirect: stale response discarded')
            return null
          }
          // Why the silent bounce came back empty (typically AADSTS50058 or
          // interaction_required). Persisted because this is the single most useful fact
          // and the redirect reloads the page, wiping in-memory state.
          const detail = `redirect: ${describeAuthError(err)}`
          sessionStorage.setItem(REDIRECT_DETAIL_KEY, detail)
          noteAuth(detail)
          return null
        }),
      )
      .then(result => {
        if (result?.account) instance.setActiveAccount(result.account)
        if (instance.getAllAccounts().length) clearRedirectGuard()
        // An unconsumed response left in the address bar would be replayed — and rejected —
        // on the next load. MSAL only strips it on the paths it completes.
        if (window.location.hash.includes('code=') || window.location.hash.includes('error=')) {
          history.replaceState(null, '', window.location.pathname + window.location.search)
        }
        const carried = sessionStorage.getItem(REDIRECT_DETAIL_KEY)
        if (carried && !authTrail.includes(carried)) noteAuth(carried)
        app = instance
        return instance
      })
  }
  return initialising
}

export async function getAccount(): Promise<AccountInfo | null> {
  const instance = await getApp()
  return pickAccount(instance)
}

/**
 * Token acquisition without any user interaction. Navigates away from the page when it needs
 * the redirect round trip; throws SignInRequiredError only once every silent option is spent.
 *
 * Works for any resource. A second resource (the Fabric API alongside Kusto) is acquired
 * silently from the same account, because both have tenant-wide admin consent.
 */
export async function getTokenSilent(scopes: string[]): Promise<string> {
  const instance = await getApp()
  const account = pickAccount(instance)

  if (account) {
    try {
      const result = await instance.acquireTokenSilent({ scopes, account })
      clearRedirectGuard()
      return result.accessToken
    } catch (err) {
      if (!(err instanceof InteractionRequiredAuthError)) throw err
      // Cached account can no longer produce a token — fall through and re-establish SSO.
    }
  }

  return ssoFromExistingSession(instance, scopes)
}

export function getKustoTokenSilent(): Promise<string> {
  return getTokenSilent([KUSTO_SCOPE])
}

/**
 * Token for callers that must never navigate the page away. The redirect ladder is fine on
 * page load, but not in the middle of a conversation — losing the thread to a full-page bounce
 * is worse than asking for a click. Throws SignInRequiredError instead.
 */
export async function getTokenQuiet(scopes: string[]): Promise<string> {
  const instance = await getApp()
  const account = pickAccount(instance)
  if (!account) throw new SignInRequiredError('Sign in to query Fabric.')
  try {
    const result = await instance.acquireTokenSilent({ scopes, account })
    return result.accessToken
  } catch (err) {
    throw new SignInRequiredError(describeAuthError(err))
  }
}

/** Reuse the Entra session the browser already holds from Fabric. Never prompts. */
async function ssoFromExistingSession(
  instance: PublicClientApplication,
  scopes: string[],
): Promise<string> {
  const hint = LOGIN_HINT ? { loginHint: LOGIN_HINT } : {}

  // ssoSilent is deliberately not attempted. It drives a hidden iframe to Entra, which every
  // current browser blocks as a third-party context; it cannot succeed here and costs a
  // 10-second timeout before failing. The redirect below does the same job for real.

  const since = sinceLastRedirect()
  if (since !== null && since < REDIRECT_COOLDOWN_MS) {
    // Only a reason recorded during this cycle survives here — a new bounce clears it first —
    // so it genuinely describes the failure being reported.
    const why = sessionStorage.getItem(REDIRECT_DETAIL_KEY)
    throw new SignInRequiredError(
      `Your Fabric sign-in could not be reused automatically. Sign in once to continue.${
        why ? ` (${why})` : ''
      }`,
    )
  }

  // MSAL refuses to redirect from inside an iframe, which is how the app is hosted when it
  // is opened in the Fabric Portal. A popup is the only interactive option there.
  if (window.self !== window.top) {
    throw new SignInRequiredError(
      'Running inside the Fabric Portal, where a silent redirect is not allowed. ' +
        'Sign in once, or open the app in its own browser tab.',
    )
  }

  // Start a clean cycle: a reason left over from an earlier attempt must never be reported
  // as the outcome of this one.
  sessionStorage.removeItem(REDIRECT_DETAIL_KEY)
  markRedirectAttempted()
  // Navigates away; nothing after this runs. prompt=none means the user sees a brief bounce
  // rather than a login screen, and we come back to REDIRECT_PATH already authenticated.
  try {
    await instance.acquireTokenRedirect({ scopes, prompt: 'none', ...hint })
  } catch (err) {
    // The bounce never started, so the guard would block a retry that was never really made.
    clearRedirectGuard()
    throw new SignInRequiredError(describeAuthError(err))
  }
  throw new SignInRequiredError('Reusing your Fabric sign-in…')
}

/**
 * Turns an MSAL failure into something a person can act on. MSAL nests the useful part
 * (the AADSTS code) inside a long message, so surface it explicitly.
 */
export function describeAuthError(err: unknown): string {
  const e = err as { errorCode?: string; errorMessage?: string; message?: string }
  const code = e?.errorCode ? `[${e.errorCode}] ` : ''
  const text = e?.errorMessage || e?.message || String(err)
  const aadsts = /AADSTS\d+/.exec(text)?.[0]
  const suffix = aadsts && !code.includes(aadsts) ? ` (${aadsts})` : ''
  return `${code}${text.split('\n')[0].slice(0, 300)}${suffix}`
}

/**
 * Interactive sign-in. Must be triggered by a user gesture or the popup gets blocked.
 *
 * Three hosting situations have to work:
 *
 *   - Inside the Fabric Portal, the app runs in a cross-origin iframe. MSAL refuses to
 *     redirect from there, and browsers routinely block popups opened from one. The only
 *     dependable answer is to re-open the app in its own tab, where auth is first-party.
 *   - A normal tab: popup, which keeps the page state intact.
 *   - A tab where popups are blocked: fall back to a full-page redirect.
 */
export async function signIn(): Promise<AccountInfo | null> {
  const instance = await getApp()
  // With a hint, go straight to the account this environment expects. Without one, force the
  // account picker: an interactive sign-in that silently reuses whichever session Entra
  // happens to prefer is exactly how the wrong identity gets cached in the first place.
  const request = LOGIN_HINT
    ? { scopes: [KUSTO_SCOPE], loginHint: LOGIN_HINT }
    : { scopes: [KUSTO_SCOPE], prompt: 'select_account' as const }

  if (window.self !== window.top) {
    window.open(window.location.href, '_blank', 'noopener')
    throw new SignInRequiredError(
      'The Fabric Portal runs this app in a frame, where Entra will not sign you in. ' +
        'It has been opened in a new tab — sign in there.',
    )
  }

  try {
    const result = await instance.acquireTokenPopup({
      ...request,
      redirectUri: `${window.location.origin}${POPUP_REDIRECT_PATH}`,
    })
    instance.setActiveAccount(result.account)
    clearRedirectGuard()
    return result.account
  } catch (err) {
    const code = (err as { errorCode?: string }).errorCode ?? ''
    // A blocked or manually-closed popup is not a real auth failure — retry as a redirect.
    if (code === 'popup_window_error' || code === 'empty_window_error' || code === 'user_cancelled') {
      clearRedirectGuard()
      await instance.acquireTokenRedirect(request)
      throw new SignInRequiredError('Redirecting to sign in…')
    }
    throw new Error(describeAuthError(err))
  }
}

export async function signOut(): Promise<void> {
  const instance = await getApp()
  // Clear every cached account, not just the first. The bug this guards against is a browser
  // holding several identities, so leaving the others behind would put the app straight back
  // into the ambiguous state that made signing out necessary.
  for (const account of instance.getAllAccounts()) await instance.clearCache({ account })
  clearRedirectGuard()
}
