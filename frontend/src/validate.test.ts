import { describe, expect, it } from 'vitest';
import { looksLikeEmail } from './validate';

describe('looksLikeEmail', () => {
  it('accepts an ordinary address', () => {
    expect(looksLikeEmail('someone@example.com')).toBe(true);
  });

  /**
   * The failures that matter. Every address below belongs to somebody, and
   * rejecting one means that person cannot create an account at all — with an
   * error blaming them for typing their own email wrongly.
   */
  it.each([
    ['plus tag', 'taskteamprosupport+store@gmail.com'],
    ['dots in the local part', 'first.last@example.com'],
    ['subdomain', 'someone@mail.example.co.in'],
    ['long TLD', 'someone@example.technology'],
    ['apostrophe', "o'brien@example.ie"],
    ['digits', 'user123@example.com'],
    ['hyphenated domain', 'someone@my-company.com'],
    ['single-letter local part', 'a@example.com'],
    ['uppercase', 'Someone@Example.COM'],
  ])('accepts %s', (_label, address) => {
    expect(looksLikeEmail(address)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['no at sign', 'someone.example.com'],
    ['no domain', 'someone@'],
    ['no local part', '@example.com'],
    ['no dot in domain', 'someone@example'],
    ['a space inside', 'some one@example.com'],
    ['two at signs', 'some@one@example.com'],
  ])('rejects %s', (_label, address) => {
    expect(looksLikeEmail(address)).toBe(false);
  });

  it('ignores surrounding whitespace, which phone keyboards add', () => {
    expect(looksLikeEmail('  someone@example.com  ')).toBe(true);
  });

  it('does not accept an address that is only whitespace-padded rubbish', () => {
    expect(looksLikeEmail('   @   ')).toBe(false);
  });
});
