import { collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { FirebaseBundle } from '../firebase.js';

const MAX_DESCRIPTION = 1000;
const KID_EDITABLE = ['draft', 'returned', 'countered'] as const;
type KidEditable = typeof KID_EDITABLE[number];

export type Pillar = 'learn' | 'courage' | 'ideas' | 'help';

export interface DraftInput {
  familyId: string;
  kidId: string;
  activityId: string | null;
  description: string;
  requestedAmount: number;
  /** free-form invoices carry their own pillar; activity-backed ones inherit it */
  category?: Pillar | null;
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amount must be a positive integer in minor units');
  }
}

function assertDescription(description: string): void {
  if (description.length > MAX_DESCRIPTION) {
    throw new Error(`description must be at most ${MAX_DESCRIPTION} characters`);
  }
}

/**
 * A draft is a real document, written before any photo upload: the Storage
 * rules authorize an upload by reading the linked invoice, and a draft that
 * only lived in component state would vanish with the device.
 *
 * The keys here are exactly the rules' whitelist. Adding one outside it —
 * even a harmless one — makes every create fail.
 */
export async function createDraft(fb: FirebaseBundle, input: DraftInput): Promise<string> {
  assertAmount(input.requestedAmount);
  assertDescription(input.description);
  const ref = doc(collection(fb.db, `families/${input.familyId}/invoices`));
  await setDoc(ref, {
    kidId: input.kidId,
    activityId: input.activityId,
    description: input.description,
    photoPaths: [],
    status: 'draft',
    requestedAmount: input.requestedAmount,
    eventCount: 0,
    createdAt: serverTimestamp(),
    // omitted entirely when absent: `category: undefined` would be rejected,
    // and the field is optional in the rules
    ...(input.category ? { category: input.category } : {}),
  });
  return ref.id;
}

export async function updateDraft(fb: FirebaseBundle, args: {
  familyId: string;
  invoiceId: string;
  status: string;
  fields: {
    description?: string;
    requestedAmount?: number;
    activityId?: string | null;
    category?: Pillar | null;
  };
}): Promise<void> {
  if (!KID_EDITABLE.includes(args.status as KidEditable)) {
    throw new Error(`status ${args.status} is not kid-editable`);
  }
  const patch: Record<string, unknown> = {};
  if (args.fields.description !== undefined) {
    assertDescription(args.fields.description);
    patch.description = args.fields.description;
  }
  if (args.fields.requestedAmount !== undefined) {
    assertAmount(args.fields.requestedAmount);
    patch.requestedAmount = args.fields.requestedAmount;
  }
  // activityId is editable ONLY in draft. Sending it later would fail the
  // whole update and lose the kid's text, so drop it instead.
  if (args.fields.activityId !== undefined && args.status === 'draft') {
    patch.activityId = args.fields.activityId;
  }
  if (args.fields.category !== undefined && args.fields.category !== null) {
    patch.category = args.fields.category;
  }
  if (Object.keys(patch).length === 0) return;
  await updateDoc(doc(fb.db, `families/${args.familyId}/invoices/${args.invoiceId}`), patch);
}

/** Only a draft is deletable, and only by its owner — the rules enforce both. */
export async function deleteDraft(
  fb: FirebaseBundle, familyId: string, invoiceId: string,
): Promise<void> {
  await deleteDoc(doc(fb.db, `families/${familyId}/invoices/${invoiceId}`));
}
