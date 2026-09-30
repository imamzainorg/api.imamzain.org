import {
  FALLBACK_LANG,
  isActiveLanguage,
  onlyActiveTranslations,
  resolveTranslation,
  setActiveLanguages,
} from './translation.util';

const t = (lang: string, is_default?: boolean) => ({ lang, title: `title-${lang}`, ...(is_default === undefined ? {} : { is_default }) });

describe('translation.util', () => {
  afterEach(() => setActiveLanguages(null));

  describe('resolveTranslation without a language snapshot (cold start)', () => {
    it('returns null for an empty or missing list', () => {
      expect(resolveTranslation(null, 'ar')).toBeNull();
      expect(resolveTranslation(undefined, 'ar')).toBeNull();
      expect(resolveTranslation([], 'ar')).toBeNull();
    });

    it('prefers the requested language', () => {
      expect(resolveTranslation([t('ar', true), t('en')], 'en')?.lang).toBe('en');
    });

    it('falls back to the is_default row when the requested language is missing', () => {
      expect(resolveTranslation([t('ar'), t('fa', true)], 'en')?.lang).toBe('fa');
      expect(resolveTranslation([t('ar'), t('fa', true)], null)?.lang).toBe('fa');
    });

    it('does not filter anything until a snapshot is loaded', () => {
      expect(onlyActiveTranslations([t('xx'), t('yy')])).toHaveLength(2);
      expect(isActiveLanguage('xx')).toBe(true);
    });
  });

  describe('deterministic fallback for tables with no is_default column (Q7)', () => {
    it('picks the site language when the requested one is missing, whatever the row order', () => {
      expect(FALLBACK_LANG).toBe('ar');
      expect(resolveTranslation([t('fa'), t('en'), t('ar')], 'fr')?.lang).toBe('ar');
      expect(resolveTranslation([t('ar'), t('en'), t('fa')], 'fr')?.lang).toBe('ar');
    });

    it('picks the lowest language code when the site language is absent', () => {
      expect(resolveTranslation([t('fa'), t('en')], 'fr')?.lang).toBe('en');
      expect(resolveTranslation([t('en'), t('fa')], null)?.lang).toBe('en');
    });

    it('returns the same row for every permutation of the input', () => {
      const rows = [t('fa'), t('en'), t('tr')];
      const picks = [rows, [...rows].reverse(), [rows[1]!, rows[2]!, rows[0]!]].map((r) => resolveTranslation(r, 'de')?.lang);
      expect(new Set(picks)).toEqual(new Set(['en']));
    });

    it('keeps input order when the rows carry no language at all', () => {
      const rows: { lang?: string; title: string }[] = [{ title: 'first' }, { title: 'second' }];
      expect(resolveTranslation(rows, 'ar')?.title).toBe('first');
    });

    it('is_default still outranks the site language', () => {
      expect(resolveTranslation([t('ar', false), t('fa', true)], 'fr')?.lang).toBe('fa');
    });
  });

  describe('language snapshot (S24)', () => {
    it('never selects a translation in a retired language, even when it is requested', () => {
      setActiveLanguages(['ar', 'en']);
      expect(resolveTranslation([t('ar', true), t('fa')], 'fa')?.lang).toBe('ar');
    });

    it('falls back past an inactive default to the next live language', () => {
      setActiveLanguages(['en']);
      expect(resolveTranslation([t('ar', true), t('en')], 'fr')?.lang).toBe('en');
    });

    it('returns null when no translation is in a live language', () => {
      setActiveLanguages(['en']);
      expect(resolveTranslation([t('ar', true), t('fa')], 'ar')).toBeNull();
    });

    it('filters lists and reports activity per code', () => {
      setActiveLanguages(['ar']);
      expect(onlyActiveTranslations([t('ar'), t('en')]).map((x) => x.lang)).toEqual(['ar']);
      expect(isActiveLanguage('ar')).toBe(true);
      expect(isActiveLanguage('en')).toBe(false);
    });

    it('treats a row without a lang as servable (cannot tell)', () => {
      setActiveLanguages(['ar']);
      expect(onlyActiveTranslations<{ lang?: string; title: string }>([{ title: 'x' }])).toHaveLength(1);
    });

    it('an empty snapshot means "not loaded", not "hide everything"', () => {
      setActiveLanguages([]);
      expect(resolveTranslation([t('ar', true)], 'ar')?.lang).toBe('ar');
    });

    it('admin paths can opt out: includeInactive still resolves a retired-language row', () => {
      setActiveLanguages(['ar']);
      expect(resolveTranslation([t('fa', true)], 'fa')).toBeNull();
      expect(resolveTranslation([t('fa', true)], 'fa', { includeInactive: true })?.lang).toBe('fa');
      expect(resolveTranslation([t('fa'), t('en')], 'fr', { includeInactive: true })?.lang).toBe('en');
      expect(resolveTranslation(null, 'fa', { includeInactive: true })).toBeNull();
    });

    it('is unfiltered again once the snapshot is cleared', () => {
      setActiveLanguages(['ar']);
      setActiveLanguages(null);
      expect(resolveTranslation([t('fa', true)], 'fa')?.lang).toBe('fa');
    });
  });
});
