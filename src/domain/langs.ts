import type { Lang } from './types';

export const LANGS: readonly Lang[] = ['en', 'pl'];

export function isLang(value: unknown): value is Lang {
  return LANGS.includes(value as Lang);
}
