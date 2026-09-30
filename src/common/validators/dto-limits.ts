/**
 * Length / size caps for free-text request fields. Every free-text column is
 * unbounded `text`, so without a cap one 95 KB title inflates every public
 * list, the RSS feed and the trigram indexes. The numbers sit far above the
 * longest legacy row (longest post slug 197, longest title 231, longest
 * abstract 2 356) so editors can always PATCH an existing row back unchanged.
 *
 * The CMS forms mirror these numbers — keep them in sync with the CMS docs.
 */
export const DTO_LIMITS = {
  /** title / name / heading / series / publication venue */
  title: 500,
  slug: 200,
  /** summary / description / abstract / excerpt */
  summary: 5000,
  /** alt_text / caption */
  caption: 500,
  /** author / publisher / one entry of an authors[] list */
  person: 300,
  url: 2048,
  email: 254,
  /** isbn / publish year and similar short free-form identifiers */
  code: 64,
  /** one entry of a tags[] / keywords[] / locations[] list */
  label: 200,
  filename: 255,
  mimeType: 127,
  /** object-storage key (R2 keys may be up to 1024 bytes) */
  storageKey: 1024,
  settingKey: 100,
  /** translations[], tags[], keywords[], authors[], document_languages[] ... */
  listItems: 50,
  /** id arrays and other batch-shaped arrays */
  ids: 200,
} as const;

/**
 * `@ArrayUnique` identity for UUID arrays. Postgres compares uuids
 * case-insensitively, so "AB…" and "ab…" would still collide on the primary
 * key even though they differ as strings.
 */
export const uuidIdentity = (id: unknown): string => String(id).toLowerCase();
