/**
 * One-time fix: ensure jbbrown09@gmail.com exists as AGENCY_ADMIN
 * under the AI Teammates agency with the correct password hash.
 *
 * Run via Railway CLI:
 *   railway run npx tsx scripts/fix-agency-user.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_EMAIL = 'jbbrown09@gmail.com';
const TARGET_HASH  = '$2b$10$uZjjlN4xRf7n0VgrzstFB.jd2Rzut1i6bYDsNwbFph/D9lg54I.J.'; // BobDog11$$
const AGENCY_NAME  = 'AI Teammates';

async function main() {
  const agency = await prisma.agency.findFirst({ where: { name: AGENCY_NAME } });
  if (!agency) {
    console.error(`❌ Agency "${AGENCY_NAME}" not found`);
    process.exit(1);
  }
  console.log(`✅ Found agency: ${agency.name} (${agency.id})`);

  const existing = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });

  if (existing) {
    // Update password hash and make sure agencyId is set correctly
    await prisma.user.update({
      where: { email: TARGET_EMAIL },
      data: {
        passwordHash: TARGET_HASH,
        agencyId: agency.id,
        role: 'AGENCY_ADMIN',
      },
    });
    console.log(`✅ Updated user ${TARGET_EMAIL} → AI Teammates agency admin`);
  } else {
    await prisma.user.create({
      data: {
        email: TARGET_EMAIL,
        passwordHash: TARGET_HASH,
        name: 'Joshua Brown',
        role: 'AGENCY_ADMIN',
        agencyId: agency.id,
      },
    });
    console.log(`✅ Created user ${TARGET_EMAIL} as AI Teammates agency admin`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
