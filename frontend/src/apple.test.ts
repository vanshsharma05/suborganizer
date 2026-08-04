import { describe, expect, it } from 'vitest';
import {
  describeAppleError, FALLBACK_NAME, fullNameFrom, greetingName,
  isMachineAddress, isRelayAddress, nameToStore, wasCancelled,
} from './apple';

describe('fullNameFrom', () => {
  it('joins the given and family names', () => {
    expect(fullNameFrom({ givenName: 'Vansh', familyName: 'Sharma' })).toBe('Vansh Sharma');
  });

  it('copes with only one half', () => {
    expect(fullNameFrom({ givenName: 'Vansh', familyName: null })).toBe('Vansh');
    expect(fullNameFrom({ givenName: null, familyName: 'Sharma' })).toBe('Sharma');
  });

  /** Apple returns it; nobody wants to be greeted with it. */
  it('drops the middle name', () => {
    expect(fullNameFrom({ givenName: 'Ada', middleName: 'Augusta', familyName: 'Lovelace' }))
      .toBe('Ada Lovelace');
  });

  it('falls back to the nickname only when there is no real name', () => {
    expect(fullNameFrom({ nickname: 'Ace' })).toBe('Ace');
    expect(fullNameFrom({ givenName: 'Ada', nickname: 'Ace' })).toBe('Ada');
  });

  it('is null when Apple sent nothing usable', () => {
    expect(fullNameFrom(null)).toBeNull();
    expect(fullNameFrom({})).toBeNull();
    expect(fullNameFrom({ givenName: '', familyName: '' })).toBeNull();
    expect(fullNameFrom({ givenName: '   ', familyName: '\t' })).toBeNull();
  });

  it('trims the padding Apple sometimes includes', () => {
    expect(fullNameFrom({ givenName: '  Vansh ', familyName: ' Sharma  ' })).toBe('Vansh Sharma');
  });
});

describe('isRelayAddress', () => {
  it('recognises Hide My Email', () => {
    expect(isRelayAddress('a4f9c2e1b8@privaterelay.appleid.com')).toBe(true);
    expect(isRelayAddress('A4F9C2E1B8@PrivateRelay.AppleID.com')).toBe(true);
  });

  it('leaves ordinary addresses alone', () => {
    expect(isRelayAddress('vansh@icloud.com')).toBe(false);
    expect(isRelayAddress('vansh@gmail.com')).toBe(false);
    expect(isRelayAddress(null)).toBe(false);
    expect(isRelayAddress(undefined)).toBe(false);
  });
});

describe('isMachineAddress', () => {
  it('catches the hex a relay address hands out', () => {
    expect(isMachineAddress('a4f9c2e1b8')).toBe(true);
    expect(isMachineAddress('deadbeef')).toBe(true);
  });

  /**
   * "ada", "bob" and "face" are all valid hex. The length floor is the only
   * thing standing between a short real name and being called "there".
   */
  it('does not mistake a short name for hex', () => {
    expect(isMachineAddress('ada')).toBe(false);
    expect(isMachineAddress('bob')).toBe(false);
    expect(isMachineAddress('face')).toBe(false);
  });

  it('anything with a non-hex character is a name', () => {
    expect(isMachineAddress('vanshsharma')).toBe(false);
    expect(isMachineAddress('a4f9c2e1b8z')).toBe(false);
    expect(isMachineAddress('contact.suborg')).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(isMachineAddress('')).toBe(false);
    expect(isMachineAddress(null)).toBe(false);
    expect(isMachineAddress(undefined)).toBe(false);
  });
});

describe('greetingName', () => {
  it('prefers the name Apple gave us', () => {
    expect(greetingName({
      appleName: { givenName: 'Vansh', familyName: 'Sharma' },
      storedName: 'vansh05',
      email: 'vansh@icloud.com',
    })).toBe('Vansh Sharma');
  });

  it('falls back to the stored profile name', () => {
    expect(greetingName({ appleName: null, storedName: 'Vansh', email: 'v@icloud.com' }))
      .toBe('Vansh');
  });

  it('then to the local part of the address', () => {
    expect(greetingName({ email: 'vansh@icloud.com' })).toBe('vansh');
  });

  /** The whole reason this module exists. */
  it('never greets somebody with the hex from a relay address', () => {
    expect(greetingName({ email: 'a4f9c2e1b8@privaterelay.appleid.com' })).toBe(FALLBACK_NAME);
  });

  it('ignores a stored name that is itself hex', () => {
    expect(greetingName({ storedName: 'a4f9c2e1b8', email: 'a4f9c2e1b8@privaterelay.appleid.com' }))
      .toBe(FALLBACK_NAME);
  });

  it('has something to say when it knows nothing', () => {
    expect(greetingName({})).toBe(FALLBACK_NAME);
    expect(greetingName({ appleName: null, storedName: null, email: null })).toBe(FALLBACK_NAME);
  });
});

describe('nameToStore', () => {
  it('stores the name on the first authorization', () => {
    expect(nameToStore({ givenName: 'Vansh', familyName: 'Sharma' }, null)).toBe('Vansh Sharma');
    expect(nameToStore({ givenName: 'Vansh', familyName: 'Sharma' }, '')).toBe('Vansh Sharma');
  });

  it('replaces hex that the signup trigger seeded from a relay address', () => {
    expect(nameToStore({ givenName: 'Vansh' }, 'a4f9c2e1b8')).toBe('Vansh');
  });

  /**
   * Apple sends the name once ever. Every later sign-in returns null, and the
   * profile is by then the only copy in existence — overwriting it would lose
   * the name permanently, with nothing able to put it back.
   */
  it('never overwrites on a later sign-in, when Apple sends nothing', () => {
    expect(nameToStore(null, 'Vansh Sharma')).toBeNull();
    expect(nameToStore({}, 'Vansh Sharma')).toBeNull();
    expect(nameToStore({ givenName: '  ' }, 'Vansh Sharma')).toBeNull();
  });

  it('leaves a name the user chose for themselves alone', () => {
    expect(nameToStore({ givenName: 'Vansh', familyName: 'Sharma' }, 'V')).toBeNull();
  });
});

describe('wasCancelled', () => {
  it('recognises both spellings of the cancel code', () => {
    expect(wasCancelled({ code: 'ERR_REQUEST_CANCELED' })).toBe(true);
    expect(wasCancelled({ code: 'ERR_CANCELED' })).toBe(true);
  });

  it('is false for a real failure', () => {
    expect(wasCancelled({ code: 'ERR_REQUEST_FAILED' })).toBe(false);
    expect(wasCancelled(new Error('boom'))).toBe(false);
    expect(wasCancelled(null)).toBe(false);
    expect(wasCancelled('ERR_REQUEST_CANCELED')).toBe(false);
  });
});

describe('describeAppleError', () => {
  it('names the ones a user can act on', () => {
    expect(describeAppleError({ code: 'ERR_APPLE_AUTHENTICATION_UNAVAILABLE' }))
      .toMatch(/not available on this device/);
    expect(describeAppleError({ code: 'ERR_REQUEST_NOT_HANDLED' })).toMatch(/Try again/);
  });

  it('sends configuration failures to support rather than blaming the user', () => {
    expect(describeAppleError({ code: 'ERR_INVALID_SCOPE' })).toMatch(/misconfigured/);
    expect(describeAppleError({ code: 'ERR_INVALID_RESPONSE' })).toMatch(/misconfigured/);
  });

  it('always says something, whatever it was handed', () => {
    expect(describeAppleError(undefined)).toBeTruthy();
    expect(describeAppleError({ code: 'ERR_SOMETHING_NEW' })).toBeTruthy();
    expect(describeAppleError(new Error('nope'))).toBeTruthy();
  });
});
