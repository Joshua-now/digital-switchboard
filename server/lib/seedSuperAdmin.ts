import { prisma } from './db.js';

const AI_TEAMMATES_EMAIL = 'jbbrown09@gmail.com';
const AI_TEAMMATES_HASH  = '$2b$10$uZjjlN4xRf7n0VgrzstFB.jd2Rzut1i6bYDsNwbFph/D9lg54I.J.'; // BobDog11$$

async function seedSuperAdminUser(email: string, passwordHash: string): Promise<void> {
  const existingSuperAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  const byEmail = await prisma.user.findUnique({ where: { email } });

  if (existingSuperAdmin && existingSuperAdmin.email === email) {
    if (existingSuperAdmin.passwordHash !== passwordHash) {
      await prisma.user.update({ where: { id: existingSuperAdmin.id }, data: { passwordHash } });
      console.log('[seed] Super admin password updated');
    } else {
      console.log('[seed] Super admin already up to date');
    }
    return;
  }

  if (byEmail && byEmail.role !== 'SUPER_ADMIN') {
    if (existingSuperAdmin) {
      await prisma.user.delete({ where: { id: existingSuperAdmin.id } });
      console.log('[seed] Removed old super admin record');
    }
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { role: 'SUPER_ADMIN', agencyId: null, passwordHash },
    });
    console.log(`[seed] Promoted ${email} to super admin`);
    return;
  }

  if (existingSuperAdmin) {
    await prisma.user.update({
      where: { id: existingSuperAdmin.id },
      data: { email, passwordHash },
    });
    console.log(`[seed] Super admin email updated to ${email}`);
    return;
  }

  await prisma.user.create({
    data: { email, passwordHash, name: 'Super Admin', role: 'SUPER_ADMIN', agencyId: null },
  });
  console.log(`[seed] Super admin created: ${email}`);
}

async function seedAITeammatesUser(): Promise<void> {
  const agency = await prisma.agency.findFirst({ where: { name: { contains: 'AI Teammate' } } });
  if (!agency) {
    console.log('[seed] AI Teammates agency not found — skipping');
    return;
  }

  const existingUser = await prisma.user.findUnique({ where: { email: AI_TEAMMATES_EMAIL } });

  if (existingUser) {
    await prisma.user.update({
      where: { email: AI_TEAMMATES_EMAIL },
      data: { passwordHash: AI_TEAMMATES_HASH, agencyId: agency.id, role: 'AGENCY_ADMIN' },
    });
    console.log(`[seed] AI Teammates user synced: ${AI_TEAMMATES_EMAIL}`);
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
}

export async function seedSuperAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!email || !passwordHash) {
    console.warn('[seed] ADMIN_EMAIL or ADMIN_PASSWORD_HASH not set — skipping');
    return;
  }

  try {
    await seedSuperAdminUser(email, passwordHash);
  } catch (err) {
    console.error('[seed] Failed to seed super admin:', err);
  }

  try {
    await seedAITeammatesUser();
  } catch (err) {
    console.error('[seed] Failed to seed AI Teammates user:', err);
  }
}
