/**
 * The parts of Sign in with Apple that are decisions rather than plumbing.
 *
 * Apple's flow has two properties that nothing else in this app has, and both of
 * them are quiet:
 *
 * The name is returned **once, ever**. Not once per device or once per install —
 * once per Apple ID per app, on the very first authorization. Sign out, delete
 * the app, reinstall, sign back in: `fullName` is null forever after. So the one
 * moment it arrives is the only moment it can be captured, and code that treats
 * a later null as "they removed their name" would wipe it permanently.
 *
 * The email may be a relay. "Hide My Email" issues an address like
 * `a4f9c2e1b8@privaterelay.appleid.com`, which is a real deliverable address and
 * a perfectly bad thing to call somebody. Every fallback in this app derives a
 * display name from the part before the `@`, which for a relay address is hex.
 * Without `isMachineAddress` the dashboard greets people as `a4f9c2e1b8`.
 *
 * Kept apart from the native module so both can be tested, since the flow itself
 * needs a real Apple ID on a real iPhone and cannot be.
 */

/** What `expo-apple-authentication` puts in `credential.fullName`. */
export type AppleName = {
  givenName?: string | null;
  familyName?: string | null;
  middleName?: string | null;
  nickname?: string | null;
} | null;

/** Apple's relay domain, issued by "Hide My Email". */
const RELAY_DOMAIN = '@privaterelay.appleid.com';

/** What we call somebody when we have nothing better. Matches fetchProfile. */
export const FALLBACK_NAME = 'there';

function clean(part: string | null | undefined): string {
  return typeof part === 'string' ? part.trim() : '';
}

/**
 * A display name from Apple's parts, or null if there is nothing usable.
 *
 * Middle names are dropped on purpose. Apple returns them and almost nobody
 * wants to be greeted with one, and the greeting on the dashboard is the only
 * place this is ever shown.
 *
 * The nickname is a last resort rather than a preference: Apple populates it
 * rarely, but when the given and family names are both blank it is the only
 * thing left that a person chose for themselves.
 */
export function fullNameFrom(name: AppleName): string | null {
  if (!name) return null;

  const given = clean(name.givenName);
  const family = clean(name.familyName);
  const joined = [given, family].filter(Boolean).join(' ');
  if (joined) return joined;

  return clean(name.nickname) || null;
}

/** Whether this address was minted by "Hide My Email" rather than chosen. */
export function isRelayAddress(email: string | null | undefined): boolean {
  return clean(email).toLowerCase().endsWith(RELAY_DOMAIN);
}

/**
 * Whether the part before the `@` is a machine's idea of a name.
 *
 * Relay addresses are the reason this exists, but the test is on the shape
 * rather than the domain, so a stored name that came from one still reads as
 * junk after the address itself has been forgotten. Eight or more characters of
 * unbroken lowercase hex is not a name anybody gave themselves; "ada" and "bob"
 * are hex too, which is why the length floor is there.
 */
export function isMachineAddress(handle: string | null | undefined): boolean {
  const h = clean(handle);
  return h.length >= 8 && /^[0-9a-f]+$/.test(h);
}

/**
 * What to call this person, given everything we know.
 *
 * The order is what each source can be trusted for: a name Apple handed us was
 * typed by the user, a name already on the profile was too, and the local part
 * of an address is a guess that happens to be right for most people and hex for
 * anyone hiding their email.
 */
export function greetingName(opts: {
  appleName?: AppleName;
  storedName?: string | null;
  email?: string | null;
}): string {
  const fromApple = fullNameFrom(opts.appleName ?? null);
  if (fromApple) return fromApple;

  const stored = clean(opts.storedName);
  if (stored && !isMachineAddress(stored)) return stored;

  const handle = clean(opts.email).split('@')[0];
  if (handle && !isMachineAddress(handle)) return handle;

  return FALLBACK_NAME;
}

/**
 * The name to write to the profile, or null to leave what is there alone.
 *
 * Only ever non-null on the first authorization, because that is the only time
 * Apple sends a name at all. A later sign-in returns null and must not touch the
 * stored one — the profile is by then the only copy in existence, and Apple will
 * never send it again to put it back.
 *
 * There is one case nothing can rescue: delete the account from inside the app
 * and sign in with Apple again, and Apple still counts it as an authorization it
 * has already made. No name comes back, and the new profile is stuck with
 * whatever the address gives it until the user edits it. Forgetting an app under
 * Settings → Apple ID → Sign in with Apple is the only thing that resets it, and
 * that is Apple's to offer, not ours.
 */
export function nameToStore(
  appleName: AppleName,
  storedName: string | null | undefined,
): string | null {
  const fromApple = fullNameFrom(appleName);
  if (!fromApple) return null;

  const stored = clean(storedName);
  // Written when the profile has nothing, or was seeded with hex from a relay
  // address. A real name already there is left alone: someone who edited it
  // meant to, and Apple's copy is the one that is years out of date.
  return !stored || isMachineAddress(stored) ? fromApple : null;
}

// -------------------------------------------------------------------- errors --

/**
 * Cancelling is not failing.
 *
 * Apple's sheet is dismissed by tapping outside it, which people do by accident,
 * and answering that with a red error banner tells them something went wrong
 * when nothing did.
 *
 * Both spellings are checked because the code was renamed between versions of
 * expo-apple-authentication and an upgrade should not resurrect the banner.
 */
export function wasCancelled(error: unknown): boolean {
  const code = codeOf(error);
  return code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED';
}

function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Something a person can act on.
 *
 * Apple's own messages are written for the console — "The authorization attempt
 * failed for an unknown reason" is true and useless. Anything not recognised
 * falls through to a line that at least says what to do next.
 */
export function describeAppleError(error: unknown): string {
  switch (codeOf(error)) {
    case 'ERR_APPLE_AUTHENTICATION_UNAVAILABLE':
      return 'Sign in with Apple is not available on this device.';
    case 'ERR_REQUEST_NOT_HANDLED':
    case 'ERR_REQUEST_NOT_INTERACTIVE':
      return 'Apple could not open the sign-in sheet. Try again in a moment.';
    case 'ERR_INVALID_RESPONSE':
    case 'ERR_INVALID_OPERATION':
    case 'ERR_INVALID_SCOPE':
    case 'ERR_APPLE_AUTHENTICATION_INVALID_SCOPE':
      return 'Apple sign-in is misconfigured for this build. Please contact support.';
    default:
      return 'Apple sign-in did not complete. Check your connection and try again.';
  }
}
