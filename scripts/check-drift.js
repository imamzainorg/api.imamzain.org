#!/usr/bin/env node
// Local convenience wrapper for the CI drift check (see .github/workflows/ci.yml
// and prisma/INTENTIONAL_DRIFT.md). Plain Node instead of `"$DATABASE_URL"`
// shell-interpolation in package.json, because that syntax only expands in a
// POSIX shell — it silently breaks under npm's default Windows shell (cmd.exe)
// and under PowerShell, both of which use different env-var syntax.
const { execSync } = require('child_process');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('check:drift needs DATABASE_URL set to a scratch database with every migration applied.');
  process.exit(1);
}

// execSync (not execFileSync) because this genuinely is "run one shell
// command" — npx resolves to npx.cmd on Windows and needs a shell either way.
// A Postgres URL never contains a double quote, so wrapping it is enough;
// everything else here is a fixed literal, never user input.
const command = `npx prisma migrate diff --from-url "${url}" --to-schema-datamodel prisma/schema.prisma --exit-code`;

try {
  execSync(command, { stdio: 'inherit' });
} catch (err) {
  process.exit(err.status ?? 1);
}
