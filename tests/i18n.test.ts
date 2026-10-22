import { describe, expect, it } from 'vitest';
import { DICTIONARIES, detectLang } from '../src/ui/i18n';

describe('detectLang', () => {
  it('takes ?lang= first, then the browser language, then English', () => {
    expect(detectLang(new URLSearchParams('lang=pl'), 'en-US')).toBe('pl');
    expect(detectLang(new URLSearchParams('lang=en'), 'pl-PL')).toBe('en');
    expect(detectLang(new URLSearchParams(''), 'pl-PL')).toBe('pl');
    expect(detectLang(new URLSearchParams('lang=de'), 'de-DE')).toBe('en');
    expect(detectLang(new URLSearchParams(''), undefined)).toBe('en');
  });
});

describe('UI dictionaries', () => {
  const keys = (o: object): string[] =>
    Object.entries(o)
      .flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v).map((sub) => `${k}.${sub}`) : [k]))
      .sort();

  it('have the same keys in English and Polish', () => {
    expect(keys(DICTIONARIES.pl)).toEqual(keys(DICTIONARIES.en));
  });

  it('have no empty strings', () => {
    for (const dict of Object.values(DICTIONARIES)) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === 'string') expect(value.trim(), key).not.toBe('');
      }
    }
  });
});
