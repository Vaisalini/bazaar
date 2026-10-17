import 'dotenv/config';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp(); // uses ADC on Cloud Run, GOOGLE_APPLICATION_CREDENTIALS locally
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;

export async function getShopsByCategory(category) {
  const snap = await db.collection('shops').where('category', '==', category).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getAllShops() {
  const snap = await db.collection('shops').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createRequest(rawText, parsed) {
  const ref = await db.collection('requests').add({
    rawText,
    parsed,
    status: 'negotiating',
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function logEvent(requestId, event) {
  await db
    .collection('requests')
    .doc(requestId)
    .collection('events')
    .add({ ...event, ts: FieldValue.serverTimestamp() });
}

export async function finishRequest(requestId, deal) {
  await db.collection('requests').doc(requestId).update({
    status: deal ? 'completed' : 'no_deal',
    deal: deal || null,
    completedAt: FieldValue.serverTimestamp(),
  });
}
