// prisma/hydrate-media.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const records = await prisma.media.findMany({
    where: { file_size: BigInt(1) },
  });
  console.log(`Hydrating ${records.length} media records…`);

  for (const m of records) {
    try {
      const res = await fetch(m.url, { method: "HEAD" });
      const size = parseInt(res.headers.get("content-length") ?? "0", 10);
      const mime =
        res.headers.get("content-type")?.split(";")[0] ?? m.mime_type;
      if (size > 1) {
        await prisma.media.update({
          where: { id: m.id },
          data: { file_size: BigInt(size), mime_type: mime },
        });
      }
    } catch (e) {
      console.warn(`  ⚠ ${m.url}`, e);
    }
  }
  console.log("Done.");
}

main().finally(() => prisma.$disconnect());
