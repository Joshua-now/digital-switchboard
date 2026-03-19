// One-time script: seeds Telnyx phone/app IDs into routing configs
// Run with: railway run node scripts/seed-telnyx.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const updates = [
  {
    clientId: '8193d202-e65b-4b1b-9add-332f09e219b9', // Speed to Lead
    telnyxPhoneNumber: '+13217324521',
    telnyxAppId: '2917724292919592884',
    telnyxAssistantId: 'assistant-76aa79cf-b607-4642-89d9-ce8142d7d21d',
  },
  {
    clientId: '26507fe6-ac87-41e7-b1db-edfb27ebe1d2', // Complete Package
    telnyxPhoneNumber: '+13217325443',
    telnyxAppId: '2919319730848269936',
    telnyxAssistantId: 'assistant-7b0b4f79-acf6-4d86-a642-cf80be82b472',
  },
  {
    clientId: '8573c54b-c173-4356-8d9d-68afde288d8f', // After Hours
    telnyxPhoneNumber: '+13217325253',
    telnyxAppId: '2919319820849645212',
    telnyxAssistantId: 'assistant-5b358ddc-9166-4f69-b6ea-ac75a0df4fee',
  },
];

for (const { clientId, ...data } of updates) {
  const result = await prisma.routingConfig.updateMany({ where: { clientId }, data });
  console.log(`Updated ${clientId.substring(0, 8)}: ${result.count} row(s) — ${data.telnyxPhoneNumber}`);
}

const configs = await prisma.routingConfig.findMany({
  select: { clientId: true, telnyxPhoneNumber: true, telnyxAppId: true, telnyxAssistantId: true },
});
console.log('\nCurrent state:');
configs.forEach(c => console.log(` ${c.clientId.substring(0,8)} | ${c.telnyxPhoneNumber || 'NULL'} | ${c.telnyxAppId || 'NULL'}`));

await prisma.$disconnect();
