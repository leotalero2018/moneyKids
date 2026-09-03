import { randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { validateId, validateJoinCode } from '@money-kids/shared';
import { checked, assertParentCaller, type CallerAuth } from './auth.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function randomCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function createParentInviteCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { familyId: string },
): Promise<{ code: string }> {
  checked(() => validateId(data.familyId, 'familyId'));
  await assertParentCaller(db, data.familyId, auth);
  const code = randomCode();
  const now = Timestamp.now();
  const batch = db.batch();
  batch.create(db.doc(`parentInvites/${code}`), {
    familyId: data.familyId,
    createdBy: auth!.uid,
    expiresAt: Timestamp.fromMillis(now.toMillis() + INVITE_TTL_MS),
    usedBy: null,
    usedAt: null,
  });
  // the log is what Settings shows; the invite doc itself is never
  // client-readable, which is what keeps the code a credential
  batch.create(db.doc(`families/${data.familyId}/inviteLog/${code}`), {
    createdBy: auth!.uid, createdAt: now, usedBy: null, usedAt: null,
  });
  await batch.commit();
  return { code };
}

export async function acceptParentInviteCore(
  db: Firestore,
  auth: CallerAuth | undefined,
  data: { code: string },
): Promise<{ familyId: string }> {
  if (!auth) throw new HttpsError('unauthenticated', 'sign in required');
  // a kid session must never become a parent, whatever code it holds
  if (auth.token.role === 'kid') throw new HttpsError('permission-denied', 'parent account required');

  const invalid = new HttpsError('permission-denied', 'invalid or expired invite');
  let code: string;
  try {
    code = validateJoinCode(data.code);
  } catch {
    throw invalid; // malformed and wrong must be indistinguishable
  }

  return db.runTransaction(async (tx) => {
    const inviteRef = db.doc(`parentInvites/${code}`);
    const invite = await tx.get(inviteRef);
    if (!invite.exists) throw invalid;
    const familyId = invite.get('familyId') as string;
    const expiresAt = invite.get('expiresAt') as Timestamp;
    if (invite.get('usedBy') !== null || expiresAt.toMillis() < Date.now()) throw invalid;

    const pointerRef = db.doc(`parentIndex/${auth.uid}`);
    const pointer = await tx.get(pointerRef);
    if (pointer.exists && pointer.get('familyId') !== familyId) {
      throw new HttpsError('failed-precondition', 'this account already belongs to another family');
    }

    tx.update(inviteRef, { usedBy: auth.uid, usedAt: FieldValue.serverTimestamp() });
    tx.update(db.doc(`families/${familyId}/inviteLog/${code}`), {
      usedBy: auth.uid, usedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.doc(`families/${familyId}/members/${auth.uid}`), {
      role: 'parent',
      displayName: (auth.token.name as string | undefined) ?? 'Parent',
    });
    tx.set(pointerRef, { familyId });
    return { familyId };
  });
}
