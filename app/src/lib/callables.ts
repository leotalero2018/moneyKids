import { httpsCallable } from 'firebase/functions';
import type { DeductionRule } from '@money-kids/shared';
import { fns } from '../firebase.js';

/**
 * Every money mutation goes through here. Components never call httpsCallable
 * directly, and never write ledger, balances, or approved status to Firestore.
 */
export const createJoinCode =
  httpsCallable<{ familyId: string; kidId: string }, { code: string }>(fns, 'createJoinCode');

export const revokeKidAccess =
  httpsCallable<{ familyId: string; kidId: string }, void>(fns, 'revokeKidAccess');

export const approveInvoice =
  httpsCallable<{ familyId: string; invoiceId: string }, { approvedAmount: number; netAmount: number }>(
    fns, 'approveInvoice');

export const recordPayout =
  httpsCallable<{
    familyId: string; kidId: string; balance: 'spendable' | 'savings';
    amount: number; note: string; requestId: string;
  }, void>(fns, 'recordPayout');

export const setDeductionRules =
  httpsCallable<{ familyId: string; rules: DeductionRule[] }, void>(fns, 'setDeductionRules');
