/**
 * Seeds demo data into the running Firestore emulator for manual smoke tests.
 *
 * Why this exists: a kid creates invoices, and the kid app is Plan 3. Without
 * this, the parent inbox has nothing to review, so approve / counter / return
 * and payouts cannot be exercised by hand.
 *
 * Writes through the emulator REST API with the owner token, so it bypasses
 * security rules exactly the way the tests' seedDoc helper does.
 */
const PROJECT = 'money-kids-test';
const BASE = `http://127.0.0.1:8480/v1/projects/${PROJECT}/databases/(default)/documents`;
const HEAD = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

function toValue(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  switch (typeof v) {
    case 'string': return { stringValue: v };
    case 'boolean': return { booleanValue: v };
    case 'number': return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    default: return { mapValue: { fields: toFields(v) } };
  }
}
const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

async function put(path, data) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'PATCH', headers: HEAD, body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}

async function list(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: HEAD });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()).documents ?? [];
}

const families = await list('families');
if (families.length === 0) {
  console.error(
    'No family found. Sign in in the app and create your family first, then re-run this.',
  );
  process.exit(1);
}

// most recently created family wins, so re-running after a fresh signup works
const family = families.sort(
  (a, b) => new Date(b.createTime) - new Date(a.createTime),
)[0];
const familyId = family.name.split('/').pop();
const currency = family.fields.currency?.stringValue ?? 'COP';
const unit = ['COP', 'CLP', 'JPY'].includes(currency) ? 1 : 100; // minor units per major

let kids = await list(`families/${familyId}/kids`);
if (kids.length === 0) {
  await put(`families/${familyId}/kids/demo-kid`, {
    name: 'Mia (demo)', birthYear: 2016, deductionsEnabled: true,
    spendableBalance: 12000 * unit, savingsBalance: 3000 * unit,
  });
  kids = await list(`families/${familyId}/kids`);
}
const kidId = kids[0].name.split('/').pop();

const invoices = [
  {
    id: 'demo-inv-1',
    description: 'Leí "El principito" y te lo conté',
    requestedAmount: 5000 * unit,
  },
  {
    id: 'demo-inv-2',
    description: 'Pedí yo solo en la panadería aunque me daba pena',
    requestedAmount: 8000 * unit,
  },
];

for (const [i, inv] of invoices.entries()) {
  await put(`families/${familyId}/invoices/${inv.id}`, {
    kidId,
    activityId: null,
    description: inv.description,
    photoPaths: [],
    status: 'sent',
    requestedAmount: inv.requestedAmount,
    eventCount: 1,
    createdAt: new Date(Date.now() - i * 3600_000),
  });
  // the invoice's own history: one -> sent event, shaped exactly as the rules require
  await put(`families/${familyId}/invoices/${inv.id}/events/e1`, {
    from: 'draft', to: 'sent', actorUid: `kid_${familyId}_${kidId}`,
    at: new Date(Date.now() - i * 3600_000), kidId,
    requestedAmount: inv.requestedAmount,
  });
}

console.log(`Seeded family ${familyId}:`);
console.log(`  kid       ${kidId} with a spendable and a savings balance`);
console.log(`  invoices  ${invoices.length} pending, waiting in the inbox`);
