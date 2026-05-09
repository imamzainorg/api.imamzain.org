type TranslationLike = { lang?: string; is_default?: boolean };

export function resolveTranslation<T extends TranslationLike>(
  translations: T[] | null | undefined,
  lang: string | null,
): T | null {
  if (!translations || translations.length === 0) return null;
  if (lang) {
    const match = translations.find((t) => t.lang === lang);
    if (match) return match;
  }
  return translations.find((t) => t.is_default === true) ?? translations[0] ?? null;
}
