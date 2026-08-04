/**
 * Auth signal shared between the Eventhouse client and the MSAL module.
 *
 * Lives in its own file so `eventhouse.ts` can re-export the error type without statically
 * importing MSAL — the auth module is only pulled in when the direct transport is used.
 */
export class SignInRequiredError extends Error {
  constructor(message = 'Sign in to query the Eventhouse.') {
    super(message)
    this.name = 'SignInRequiredError'
  }
}
