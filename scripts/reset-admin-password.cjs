require("dotenv").config();

const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function run() {
  const email = "PUT_ADMIN_EMAIL_HERE";
  const newPassword = "BobDog11$$";

  console.log("DATABASE_URL =", process.env.DATABASE_URL);

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.log("❌ User not found:", email);
    process.exit(1);
  }

  console.log("✅ User found, id:", user.id);

  const hash = bcrypt.hashSync(newPassword, 10);

  await prisma.user.update({
    where: { email },
    data: { passwordHash: hash }, // change field name if your schema differs
  });

  console.log("✅ Password updated successfully");
  console.log("Hash length:", hash.length);
  console.log("Hash prefix:", hash.slice(0, 15));

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error("❌ ERROR:", err);
  process.exit(1);
});
