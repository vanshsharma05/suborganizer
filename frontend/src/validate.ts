/**
 * Input checks that run before anything is sent anywhere.
 *
 * Kept pure and here rather than inline in the screen, because the failure mode
 * these have is silent and expensive: a rule that is a shade too strict does not
 * look like a bug, it looks like the user mistyping their own email, and they
 * have no way to argue with it.
 */

/**
 * Whether a string is shaped like an email address.
 *
 * Deliberately permissive. The addresses people actually hold break almost every
 * rule you would think to write — plus-tags, dots in the local part, long and
 * new top-level domains, apostrophes in Irish surnames — and the cost of being
 * wrong is asymmetric. Rejecting a real address locks someone out of sign-up
 * entirely; letting a bad one through costs one bounced email and a message from
 * the server that says so.
 *
 * So this only asks for the shape a typo usually breaks: something, an @,
 * something, a dot, something, and no spaces anywhere.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
