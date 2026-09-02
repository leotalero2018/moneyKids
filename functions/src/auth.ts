import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';

export interface CallerAuth {
  uid: string;
  // index signature so firebase-functions' AuthData (whose token is a
  // DecodedIdToken carrying arbitrary custom claims) is assignable here;
  // without it TS's weak-type check rejects the onCall wrappers
  token: { [claim: string]: unknown; role?: string; familyId?: string; kidId?: string };
}

/**
 * Runs shared validators (which throw plain Errors) and rethrows as a callable
 * `invalid-argument`. Every callable validates its payload BEFORE using any
 * field in a document path — authorization is not validation.
 */
export function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new HttpsError('invalid-argument', (e as Error).message);
  }
}

export async function assertParentCaller(
  db: Firestore,
  familyId: string,
  auth: CallerAuth | undefined,
): Promise<void> {
  if (!auth) throw new HttpsError('unauthenticated', 'sign in required');
  if (auth.token.role === 'kid') throw new HttpsError('permission-denied', 'parent role required');
  const member = await db.doc(`families/${familyId}/members/${auth.uid}`).get();
  if (!member.exists) throw new HttpsError('permission-denied', 'not a member of this family');
  // callable functions bypass Firestore rules — role must be checked here too
  if (member.get('role') !== 'parent') throw new HttpsError('permission-denied', 'parent role required');
}

export function assertKidCaller(familyId: string, auth: CallerAuth | undefined): string {
  if (!auth || auth.token.role !== 'kid' || auth.token.familyId !== familyId || !auth.token.kidId) {
    throw new HttpsError('permission-denied', 'kid session for this family required');
  }
  return auth.token.kidId;
}
