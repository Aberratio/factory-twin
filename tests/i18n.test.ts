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

  // every string, nested dictionaries such as `tools` included, as [path, value]
  const strings = (o: object, prefix = ''): [string, string][] =>
    Object.entries(o).flatMap(([k, v]): [string, string][] => {
      if (typeof v === 'string') return [[`${prefix}${k}`, v]];
      if (v && typeof v === 'object') return strings(v, `${prefix}${k}.`);
      return [];
    });

  it('have no empty strings, nested dictionaries included', () => {
    for (const [lang, dict] of Object.entries(DICTIONARIES)) {
      const all = strings(dict);
      expect(all.some(([key]) => key.startsWith('tools.'))).toBe(true);
      for (const [key, value] of all) expect(value.trim(), `${lang}: ${key}`).not.toBe('');
    }
  });
});
