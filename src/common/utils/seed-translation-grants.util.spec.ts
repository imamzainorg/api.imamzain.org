import { planTranslationWrite } from './seed-translation-grants.util';

const DESIRED = { title: 'Add Daily Hadiths', description: "Add hadiths and set which day they're shown" };

describe('planTranslationWrite', () => {
  it('leaves an existing (possibly CMS-customized) translation alone on a normal reseed', () => {
    const result = planTranslationWrite({
      existing: { title: 'Custom title', description: 'Custom description an admin wrote' },
      desired: DESIRED,
      isNewRow: false,
    });

    expect(result).toBeNull();
  });

  it('overwrites an existing translation when SEED_RESET_ROLE_GRANTS=true', () => {
    const result = planTranslationWrite({
      existing: { title: 'Custom title', description: 'Custom description an admin wrote' },
      desired: DESIRED,
      isNewRow: false,
      reset: true,
    });

    expect(result).toEqual(DESIRED);
  });

  it('always writes the translation for a permission/role this run just created, regardless of reset', () => {
    const result = planTranslationWrite({
      existing: null,
      desired: DESIRED,
      isNewRow: true,
    });

    expect(result).toEqual(DESIRED);
  });

  it('fills in a translation for an existing permission/role that never had one for this language', () => {
    const result = planTranslationWrite({
      existing: null,
      desired: DESIRED,
      isNewRow: false,
    });

    expect(result).toEqual(DESIRED);
  });
});
