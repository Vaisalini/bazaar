import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, FieldValue } from '../src/firestore.js';

const shops = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'shops.json'), 'utf8'));

// Wipes and re-seeds demo shops (idempotent: safe to rerun to reset demo state)
async function seed() {
  const existing = await db.collection('shops').get();
  const batch = db.batch();
  existing.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log(`Deleted ${existing.size} existing shops`);

  for (const shop of shops) {
    await db.collection('shops').add({ ...shop, onboardedVia: 'seed', createdAt: FieldValue.serverTimestamp() });
    console.log(`Seeded: ${shop.name}`);
  }
  console.log(`Done - ${shops.length} shops seeded`);
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
