import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall } from 'firebase-functions/v2/https';
import { createJoinCodeCore, mintKidTokenCore, revokeKidAccessCore } from './joinCodes.js';
import { approveInvoiceCore } from './approval.js';

initializeApp();

export const createJoinCode = onCall(async (req) =>
  createJoinCodeCore(getFirestore(), req.auth, req.data));

export const mintKidToken = onCall({ invoker: 'public' }, async (req) =>
  mintKidTokenCore(getFirestore(), getAuth(), req.data));

export const revokeKidAccess = onCall(async (req) =>
  revokeKidAccessCore(getFirestore(), getAuth(), req.auth, req.data));

export const approveInvoice = onCall(async (req) =>
  approveInvoiceCore(getFirestore(), req.auth, req.data));
