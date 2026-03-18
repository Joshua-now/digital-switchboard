/**
 * One-time migration: assign all unowned clients (agencyId = null)
 * to the "AI Teammates" agency.
 *
 * Run via Railway CLI:
 *   railway run npx tsx scripts/assign-clients-to-agency.ts
 *
 * Or locally (with DATABASE_URL set):
 *   npx tsx scripts/assign-clients-to-agency.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const agency = await prisma.agency.findFirst({
    where: { name: 'AI Teammates' },
  });

  if (!agency) {
    console.error('❌ Agency "AI Teammates" not found. Did you sign up at /signup first?');
    process.exit(1);
  }

  console.log(`✅ Found agency: ${agency.name} (${agency.id})`);

  const unowned = await prisma.client.findMany({
    where: { agencyId: null },
    select: { id: true, name: true },
  });

  if (unowned.length === 0) {
    console.log('ℹ️  No unowned clients found — nothing to migrate.');
    process.exit(0);
  }

  console.log(`📋 Clients to migrate:`);
  unowned.forEach(c => console.log(`   - ${c.name} (${c.id})`));

  const result = await prisma.client.updateMany({
    where: { agencyId: null },
    data: { agencyId: agency.id },
  });

  console.log(`✅ Migrated ${result.count} client(s) to AI Teammates.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
