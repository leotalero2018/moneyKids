import { randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { validateId, validateJoinCode } from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_TTL_MS = 48 * 60 * 60 * 1000;

function randomCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function createJoinCodeCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string; kidId: string },
): Promise<{ code: string }> {
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.kidId, 'kidId');
  });
  await assertParentCaller(db, data.familyId, auth);
  const kid = await db.doc(`families/${data.familyId}/kids/${data.kidId}`).get();
  if (!kid.exists) throw new HttpsError('not-found', 'kid not found in this family');
  const code = randomCode();
  await db.doc(`joinCodes/${code}`).create({
    familyId: data.familyId,
    kidId: data.kidId,
    revoked: false,
    expiresAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MS),
    createdBy: auth!.uid,
  });
  return { code };
}

export async function mintKidTokenCore(
  db: Firestore,
  adminAuth: Auth,
  data: { code: string },
): Promise<{ token: string }> {
  // this callable is public/unauthenticated — the code is the only credential,
  // so its shape is validated before it reaches a document path
  const invalid = new HttpsError('permission-denied', 'invalid or expired code');
  let code: string;
  try {
    code = validateJoinCode(data.code);
  } catch {
    throw invalid; // never leak whether a malformed code could have existed
  }
  const snap = await db.doc(`joinCodes/${code}`).get();
  if (!snap.exists) throw invalid;
  const { familyId, kidId, revoked, expiresAt } = snap.data() as {
    familyId: string; kidId: string; revoked: boolean; expiresAt: Timestamp;
  };
  if (revoked || expiresAt.toMillis() < Date.now()) throw invalid;
  // UID is family-namespaced: kid doc IDs are only unique within a family
  const token = await adminAuth.createCustomToken(`kid_${familyId}_${kidId}`, { familyId, kidId, role: 'kid' });
  return { token };
}

export async function revokeKidAccessCore(
  db: Firestore,
  adminAuth: Auth,
  auth: CallerAuth | undefined,
  data: { familyId: string; kidId: string },
): Promise<void> {
  checked(() => {
    validateId(data.familyId, 'familyId');
    validateId(data.kidId, 'kidId');
  });
  await assertParentCaller(db, data.familyId, auth);
  const kid = await db.doc(`families/${data.familyId}/kids/${data.kidId}`).get();
  if (!kid.exists) throw new HttpsError('not-found', 'kid not found in this family');
  const codes = await db.collection('joinCodes')
    .where('familyId', '==', data.familyId)
    .where('kidId', '==', data.kidId)
    .get();
  const batch = db.batch();
  for (const c of codes.docs) batch.update(c.ref, { revoked: true });
  await batch.commit();
  await adminAuth.revokeRefreshTokens(`kid_${data.familyId}_${data.kidId}`).catch((e: { code?: string }) => {
    if (e.code !== 'auth/user-not-found') throw e; // kid may never have signed in
  });
}
