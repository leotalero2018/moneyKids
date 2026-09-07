import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { arrayRemove, arrayUnion, doc, updateDoc } from 'firebase/firestore';
import type { FirebaseBundle } from '../firebase.js';

export const MAX_EDGE = 1200;                    // the spec's ~1200px
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // the Storage rule's cap
export const MAX_PHOTOS = 8;                     // the Firestore rule's cap
const QUALITY = 0.8;

/**
 * Resizes on a canvas and re-encodes as JPEG. A phone photo is several
 * megabytes; the Storage rule rejects anything over 5 MB, and a kid on a
 * home connection should not be uploading that anyway.
 */
export async function compressImage(file: File, maxEdge = MAX_EDGE): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('only image files can be attached');

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('that image could not be read'));
      img.src = url;
    });

    const longEdge = Math.max(image.width, image.height);
    // never upscale: enlarging a small photo only wastes bytes
    const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('that image could not be processed');
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', QUALITY);
    });
    if (!blob) throw new Error('that image could not be processed');
    if (blob.size > MAX_UPLOAD_BYTES) {
      // fail here rather than let Storage reject the upload after the wait
      throw new Error('that photo is too large, even after shrinking');
    }
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Uploads one photo and records its path on the invoice.
 *
 * The Storage rule reads the linked invoice and requires it to exist, to be
 * in a kid-editable status, and to belong to the kid in the path — so this
 * only works on a draft that has already reached the server.
 */
export async function uploadInvoicePhoto(fb: FirebaseBundle, args: {
  familyId: string; kidId: string; invoiceId: string; file: File;
}): Promise<string> {
  const blob = await compressImage(args.file);
  // a RANDOM name, never the array length: after a removal the length repeats
  // an index that is still in use, and the next upload would silently
  // overwrite an existing photo
  const path = `families/${args.familyId}/kids/${args.kidId}/invoices/${args.invoiceId}`
    + `/${crypto.randomUUID()}.jpg`;
  await uploadBytes(ref(fb.storage, path), blob, { contentType: 'image/jpeg' });
  try {
    await updateDoc(doc(fb.db, `families/${args.familyId}/invoices/${args.invoiceId}`), {
      photoPaths: arrayUnion(path),
    });
  } catch (e) {
    // the object is up but unreferenced, and nothing else will ever find it.
    // Best-effort clean-up, then report the failure: an orphan the user
    // cannot see is worse than a retry they can.
    await deleteObject(ref(fb.storage, path)).catch(() => undefined);
    throw e;
  }
  return path;
}

/**
 * Detaches first, then deletes.
 *
 * That order matters: if the delete fails, the invoice no longer points at a
 * missing object, and the leftover file is invisible rather than broken. The
 * reverse order would leave a path on the invoice with nothing behind it, and
 * every reader — including the parent's review screen — would show a gap.
 */
export async function removeInvoicePhoto(fb: FirebaseBundle, args: {
  familyId: string; invoiceId: string; path: string;
}): Promise<void> {
  await updateDoc(doc(fb.db, `families/${args.familyId}/invoices/${args.invoiceId}`), {
    photoPaths: arrayRemove(args.path),
  });
  await deleteObject(ref(fb.storage, args.path)).catch(() => undefined);
}
