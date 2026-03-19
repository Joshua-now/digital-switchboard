import { prisma } from './db.js';
/**
 * On startup, ensure a SUPER_ADMIN user exists using the legacy env-var
 * credentials (ADMIN_EMAIL + ADMIN_PASSWORD_HASH).  This makes the migration
 * seamless — Troy keeps the same login, the data just moves from env vars
 * into the users table.
 */
export async function seedSuperAdmin() {
    const email = process.env.ADMIN_EMAIL;
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    if (!email || !passwordHash) {
        console.warn('[seed] ADMIN_EMAIL or ADMIN_PASSWORD_HASH not set — skipping super-admin seed');
        return;
    }
    try {
        // Check if a user with the target email already exists
        const byEmail = await prisma.user.findUnique({ where: { email } });
        if (byEmail) {
            // Already on the right email — sync password hash if rotated
            if (byEmail.passwordHash !== passwordHash) {
                await prisma.user.update({ where: { email }, data: { passwordHash } });
                console.log('[seed] Super admin password hash updated');
            }
            else {
                console.log('[seed] Super admin already exists — no action needed');
            }
            return;
        }
        // No user with the new email — check if there's an existing SUPER_ADMIN to migrate
        const existingSuperAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
        if (existingSuperAdmin) {
            await prisma.user.update({
                where: { id: existingSuperAdmin.id },
                data: { email, passwordHash },
            });
            console.log(`[seed] Super admin email updated to ${email}`);
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
    }
    catch (err) {
        console.error('[seed] Failed to seed super admin:', err);
    }
}
