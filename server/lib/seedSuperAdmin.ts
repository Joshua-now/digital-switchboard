import { prisma } from './db.js';

/**
 * On startup, ensure a SUPER_ADMIN user exists using the legacy env-var
 * credentials (ADMIN_EMAIL + ADMIN_PASSWORD_HASH).  This makes the migration
 * seamless — Troy keeps the same login, the data just moves from env vars
 * into the users table.
 */
export async function seedSuperAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!email || !passwordHash) {
    console.warn('[seed] ADMIN_EMAIL or ADMIN_PASSWORD_HASH not set — skipping super-admin seed');
    return;
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      // Keep password hash in sync in case it was rotated via env var
      if (existing.passwordHash !== passwordHash) {
        await prisma.user.update({
          where: { email },
          data: { passwordHash },
        });
        console.log('[seed] Super admin password hash updated from env var');
      } else {
        console.log('[seed] Super admin already exists — no action needed');
      }
      return;
    }

    await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: 'Super Admin',
        role: 'SUPER_ADMIN',
        agencyId: null,
      },
    });

    console.log(`[seed] Super admin created: ${email}`);
  } catch (err) {
    console.error('[seed] Failed to seed super admin:', err);
  }
}
