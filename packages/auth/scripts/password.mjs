/**
 * Hash or verify a password using Better Auth's own functions.
 *
 * Development utility. Passwords are scrypt hashes and cannot be read back —
 * that is the point — so the two useful questions are "is this the password?"
 * and "give me a hash I can store".
 *
 * Uses better-auth/crypto rather than node:crypto directly so it cannot drift
 * from however the application hashes passwords. Lives in packages/auth
 * because that is where better-auth resolves under pnpm's isolated layout;
 * reading and writing the row is left to psql so this needs no database
 * driver.
 *
 *   node packages/auth/scripts/password.mjs hash   <password>
 *   node packages/auth/scripts/password.mjs verify <hash> <password>
 */

import { hashPassword, verifyPassword } from 'better-auth/crypto'

const [mode, ...rest] = process.argv.slice(2)

if (mode === 'hash') {
  const [password] = rest
  if (!password) throw new Error('usage: hash <password>')
  // Matches the sign-up rule in packages/auth/src/index.ts; a shorter one
  // would create an account the application itself would have rejected.
  if (password.length < 12) throw new Error('Password must be at least 12 characters')
  process.stdout.write(await hashPassword(password))
} else if (mode === 'verify') {
  const [hash, password] = rest
  if (!hash || !password) throw new Error('usage: verify <hash> <password>')
  const ok = await verifyPassword({ hash, password })
  console.log(ok ? 'MATCH' : 'NO MATCH')
  process.exit(ok ? 0 : 1)
} else {
  console.error('usage: password.mjs <hash|verify> ...')
  process.exit(2)
}
