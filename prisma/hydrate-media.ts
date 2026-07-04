/**
 * Hydrate media metadata + verify R2 state.
 *
 * Two phases, both run HEAD requests in parallel and never modify R2:
 *
 *   1. Hydrate
 *      For every `media` row still flagged with the sentinel `file_size = 1`
 *      (set by the seeder when the real size wasn't known), HEAD the URL and
 *      fill in `file_size` + `mime_type` from the response. Rows that 404 or
 *      time out stay at the sentinel and are reported, not modified.
 *
 *   2. Verify variants
 *      Walk every `media_variants` row and HEAD its URL to confirm the file
 *      exists in R2. A variant row whose R2 object is missing is a broken
 *      state — usually from a failed mid-upload during `backfill-variants` or
 *      a manual R2 deletion. We only report; the operator decides whether to
 *      delete the DB rows and re-run backfill, or to fix R2 manually.
 *
 * Exit code is non-zero if any media failed to hydrate or any variant is
 * missing, so this script is safe to wire into CI / a verify step.
 *
 * Usage:
 *   npm run prisma:hydrate-media
 *
 * Env:
 *   HYDRATE_CONCURRENCY  — max concurrent HEADs (default 20).
 */

import { PrismaClient } from "@prisma/client";
import pLimit from "p-limit";

const prisma = new PrismaClient();
const CONCURRENCY = parseInt(process.env.HYDRATE_CONCURRENCY ?? "20", 10);
// A stalled connection would otherwise pin a worker for undici's ~300 s default.
const HEAD_TIMEOUT_MS = 15_000;

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const run = pLimit(limit);
  await Promise.all(items.map((item) => run(() => fn(item))));
}

async function hydrateMedia(): Promise<{ hydrated: number; missing: number; errored: number }> {
  const records = await prisma.media.findMany({
    where: { file_size: BigInt(1) },
    select: { id: true, url: true, mime_type: true },
  });

  if (records.length === 0) {
    console.log("Media: nothing to hydrate.");
    return { hydrated: 0, missing: 0, errored: 0 };
  }

  console.log(`Media: hydrating ${records.length} record(s) (concurrency=${CONCURRENCY})…`);

  let hydrated = 0;
  let missing = 0;
  let errored = 0;

  await mapWithConcurrency(records, CONCURRENCY, async (m) => {
    try {
      const res = await fetch(m.url, { method: "HEAD", signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
      if (!res.ok) {
        missing++;
        console.warn(`  ✗ HTTP ${res.status}  ${m.url}`);
        return;
      }
      const size = parseInt(res.headers.get("content-length") ?? "0", 10);
      const mime = res.headers.get("content-type")?.split(";")[0] ?? m.mime_type;
      if (size > 1) {
        await prisma.media.update({
          where: { id: m.id },
          data: { file_size: BigInt(size), mime_type: mime },
        });
        hydrated++;
      } else {
        missing++;
        console.warn(`  ✗ empty body  ${m.url}`);
      }
    } catch (e) {
      errored++;
      console.warn(`  ✗ ${m.url} — ${(e as Error).message}`);
    }
  });

  console.log(`  ✓ ${hydrated} hydrated, ${missing} missing/empty, ${errored} errored`);
  return { hydrated, missing, errored };
}

async function verifyVariants(): Promise<{ ok: number; missing: number; errored: number; missingIds: string[] }> {
  const variants = await prisma.media_variants.findMany({
    select: { id: true, media_id: true, url: true, width: true },
  });

  if (variants.length === 0) {
    console.log("Variants: nothing to verify.");
    return { ok: 0, missing: 0, errored: 0, missingIds: [] };
  }

  console.log(`Variants: verifying ${variants.length} URL(s) (concurrency=${CONCURRENCY})…`);

  let ok = 0;
  let missing = 0;
  let errored = 0;
  const missingIds: string[] = [];

  await mapWithConcurrency(variants, CONCURRENCY, async (v) => {
    try {
      const res = await fetch(v.url, { method: "HEAD", signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
      if (res.ok) {
        ok++;
      } else {
        missing++;
        missingIds.push(v.id);
        console.warn(`  ✗ HTTP ${res.status}  ${v.media_id}@${v.width}w  ${v.url}`);
      }
    } catch (e) {
      errored++;
      missingIds.push(v.id);
      console.warn(`  ✗ ${v.media_id}@${v.width}w  ${v.url} — ${(e as Error).message}`);
    }
  });

  console.log(`  ✓ ${ok} present, ${missing} missing, ${errored} errored`);
  return { ok, missing, errored, missingIds };
}

async function main() {
  const media = await hydrateMedia();
  const variants = await verifyVariants();

  const mediaProblems = media.missing + media.errored;
  const variantProblems = variants.missing + variants.errored;

  if (variantProblems > 0) {
    console.warn(
      `\n  ⚠ ${variantProblems} variant(s) have DB rows but no R2 object. ` +
        `\`backfill-variants\` skips media that already have any variant row, ` +
        `so it will not regenerate these. Either delete the broken rows and ` +
        `re-run backfill, or restore the files in R2 directly.`,
    );
    if (variants.missingIds.length > 0) {
      const sample = variants.missingIds.slice(0, 20).join(", ");
      const more = variants.missingIds.length > 20 ? ` (+${variants.missingIds.length - 20} more)` : "";
      console.warn(`  Sample variant ids: ${sample}${more}`);
    }
  }

  if (mediaProblems > 0 || variantProblems > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Hydrate failed:", err);
    // exitCode (not exit()) so the .finally disconnect below still runs.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
