import { prisma } from './db.js';

// AI Teammates agency owner — fixed credentials bootstrapped on startup
const AI_TEAMMATES_EMAIL = 'jbbrown09@gmail.com';
const AI_TEAMMATES_HASH  = '$2b$10$uZjjlN4xRf7n0VgrzstFB.jd2Rzut1i6bYDsNwbFph/D9lg54I.J.'; // BobDog11$$

/**
 * On startup, ensure a SUPER_ADMIN user exists using the env-var credentials
 * and that the AI Teammates agency owner account is set up correctly.
 */
export async function seedSuperAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!email || !passwordHash) {
    console.warn('[seed] ADMIN_EMAIL or ADMIN_PASSWORD_HASH not set — skipping super-admin seed');
    return;
  }

  try {
    // Always find or update the SUPER_ADMIN role user first
    const existingSuperAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });

    if (existingSuperAdmin) {
      // Update email + password hash regardless of what email was previously set
      const needsUpdate = existingSuperAdmin.email !== email || existingSuperAdmin.passwordHash !== passwordHash;
      if (needsUpdate) {
        await prisma.user.update({
          where: { id: existingSuperAdmin.id },
          data: { email, passwordHash },
        });
        console.log(`[seed] Super admin updated → ${email}`);
      } else {
        console.log('[seed] Super admin already up to date');
      }
      return;
    }

    // No SUPER_ADMIN exists — create one (handle email collision with existing non-admin user)
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      // Promote the existing user to super admin and clear agency
      await prisma.user.update({
        where: { email },
        data: { role: 'SUPER_ADMIN', agencyId: null, passwordHash },
      });
      console.log(`[seed] Promoted existing user to super admin: ${email}`);
      return;
    }

    await prisma.user.create({
      data: { email, passwordHash, name: 'Super Admin', role: 'SUPER_ADMIN', agencyId: null },
    });
    console.log(`[seed] Super admin created: ${email}`);
  } catch (err) {
    console.error('[seed] Failed to seed super admin:', err);
  }

  // --- AI Teammates agency owner ---
  try {
    const agency = await prisma.agency.findFirst({ where: { name: 'AI Teammates' } });
    if (!agency) {
      console.log('[seed] AI Teammates agency not found — skipping agency user seed');
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email: AI_TEAMMATES_EMAIL } });

    if (existingUser) {
      // Ensure password hash and agencyId are correct
      await prisma.user.update({
        where: { email: AI_TEAMMATES_EMAIL },
        data: { passwordHash: AI_TEAMMATES_HASH, agencyId: agency.id, role: 'AGENCY_ADMIN' },
      });
      console.log(`[seed] AI Teammates user updated: ${AI_TEAMMATES_EMAIL}`);
    } else {
      await prisma.user.create({
        data: {
          email: AI_TEAMMATES_EMAIL,
          passwordHash: AI_TEAMMATES_HASH,
          name: 'Joshua Brown',
          role: 'AGENCY_ADMIN',
          agencyId: agency.id,
        },
      });
      console.log(`[seed] AI Teammates user created: ${AI_TEAMMATES_EMAIL}`);
    }
  } catch (err) {
    console.error('[seed] Failed to seed AI Teammates user:', err);
  }
}
