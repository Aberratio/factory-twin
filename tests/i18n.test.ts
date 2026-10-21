import { describe, expect, it } from 'vitest';
import { detectLang } from '../src/ui/i18n';

describe('detectLang', () => {
  it('takes ?lang= first, then the browser language, then English', () => {
    expect(detectLang(new URLSearchParams('lang=pl'), 'en-US')).toBe('pl');
    expect(detectLang(new URLSearchParams('lang=en'), 'pl-PL')).toBe('en');
    expect(detectLang(new URLSearchParams(''), 'pl-PL')).toBe('pl');
    expect(detectLang(new URLSearchParams('lang=de'), 'de-DE')).toBe('en');
    expect(detectLang(new URLSearchParams(''), undefined)).toBe('en');
  });
});
