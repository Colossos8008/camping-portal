// scripts/blocked-db-push.mjs
console.error("");
console.error("BLOCKED - prisma db push ist in diesem Projekt absichtlich deaktiviert.");
console.error("");
console.error("Nutze stattdessen:");
console.error("  - npm run db:migrate   (lokal Migration erzeugen und anwenden)");
console.error("  - npm run db:deploy    (Deploy-Migrations anwenden, z.B. in Vercel)");
console.error("");
console.error("Warum:");
console.error("  - db push umgeht Migrations und macht spätere Deploys instabil.");
console.error("");
process.exit(1);
