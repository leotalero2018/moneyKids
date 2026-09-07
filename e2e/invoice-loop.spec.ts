import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

// __dirname, not import.meta.url: Playwright loads specs as CommonJS, since
// the root package.json has no "type": "module"
const here = __dirname;
const PROJECT = 'money-kids-test';
const REST = `http://127.0.0.1:8480/v1/projects/${PROJECT}/databases/(default)/documents`;

async function wipe(): Promise<void> {
  for (const url of [
    `http://127.0.0.1:8480/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`,
  ]) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(`wipe failed: ${url} ${res.status}`);
  }
}

/** Reads the ids the cache probe needs, bypassing rules like the seeder does. */
async function ids(): Promise<{ familyId: string; firstKidId: string }> {
  const head = { Authorization: 'Bearer owner' };
  const families = (await (await fetch(`${REST}/families`, { headers: head })).json())
    .documents as { name: string }[];
  const familyId = families[0]!.name.split('/').pop()!;
  const kids = (await (await fetch(`${REST}/families/${familyId}/kids`, { headers: head }))
    .json()).documents as { name: string; createTime: string }[];
  const oldest = kids.sort(
    (a, b) => Date.parse(a.createTime) - Date.parse(b.createTime),
  )[0]!;
  return { familyId, firstKidId: oldest.name.split('/').pop()! };
}

async function signUpParent(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel(/correo/i).fill(`e2e-${Date.now()}@example.test`);
  await page.getByLabel(/contraseña/i).fill('test-password');
  await page.getByRole('button', { name: /crear cuenta/i }).click();
  await expect(page.getByLabel(/nombre de la familia/i)).toBeVisible();
}

/**
 * Creates the family and waits for the app to actually reach the parent
 * shell. Navigating straight after the click races the batch write: the page
 * reloads mid-flight and comes back on the create-family screen.
 */
async function createFamily(page: Page, currency?: string): Promise<void> {
  await page.getByLabel(/nombre de la familia/i).fill('Talero');
  if (currency) await page.getByLabel(/moneda/i).selectOption(currency);
  await page.getByRole('button', { name: /crear familia/i }).click();
  await expect(page.getByRole('heading', { name: /facturas pendientes/i })).toBeVisible();
}

async function addKid(page: Page, name: string): Promise<string> {
  // goto rather than clicking the tab: the tab bar re-renders whenever the
  // inbox badge listener fires, which detaches the link mid-click. What the
  // tabs render is a component-test concern; this suite is about the loop.
  await page.goto('/kids');
  await page.getByLabel(/^nombre$/i).fill(name);
  await page.getByLabel(/año de nacimiento/i).fill('2016');
  await page.getByRole('button', { name: /agregar niño/i }).click();
  const card = page.getByRole('group', { name: new RegExp(name) });
  await card.getByRole('button', { name: /mostrar código/i }).click();
  return (await card.getByTestId('join-code').textContent())!.trim();
}

test.beforeEach(async () => { await wipe(); });

test('the whole invoice loop, on a phone-sized screen', async ({ page }) => {
  // --- parent: sign up and create the family ---
  await signUpParent(page);
  await createFamily(page, 'COP');

  // --- parent: add a kid and take the join code ---
  const code = await addKid(page, 'Mia');
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

  // deductions are off PER KID by default — the spec's choice, so a young
  // kid starts with the simple version. Family rules alone change nothing
  // until this is on, which is exactly what the approval function checks.
  const miaCard = page.getByRole('group', { name: /Mia/ });
  await expect(miaCard).toBeVisible();
  // click, not check(): check() also waits for "no scheduled navigations",
  // and this screen re-renders from its live queries continuously
  await miaCard.getByRole('checkbox', { name: /deducciones/i }).click();
  await expect(miaCard.getByRole('checkbox', { name: /deducciones/i })).toBeChecked();

  // --- parent: turn deductions on, so the pay stub has something to show ---
  await page.goto('/settings');
  await page.getByRole('button', { name: /paquete inicial/i }).click();
  await expect(page.getByText(/20\.00%/)).toBeVisible();

  // --- kid: redeem the code in the SAME browser, on the kid instance ---
  await page.goto('/kid');
  await page.getByLabel(/código/i).fill(code);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: /Hola, Mia/ })).toBeVisible();

  // --- kid: build an invoice, with a real photo through real compression ---
  await page.goto('/kid/new');
  await page.getByRole('button', { name: /ayudar/i }).click();
  await page.getByLabel(/qué hiciste/i).fill('Leí El principito y te lo conté');
  await page.getByLabel(/cuánto/i).fill('5000');
  await page.getByRole('button', { name: /guardar/i }).click();
  await expect(page.getByText(/ahora puedes agregar fotos/i)).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /agregar foto/i }).click();
  await (await chooser).setFiles(resolve(here, 'fixtures/photo.png'));
  await expect(page.getByText('(1/8)')).toBeVisible();

  await page.getByRole('button', { name: /enviar/i }).click();

  // --- kid: the invoice shows as waiting ---
  // wait for the app's OWN navigation rather than forcing one: a goto here
  // races the send, tearing the page down before the batch is queued
  await expect(page).toHaveURL(/\/kid\/invoices/);
  await expect(page.getByText(/esperando respuesta/i)).toBeVisible();

  // --- parent: review it, photo and all ---
  await page.goto('/inbox');
  await page.getByRole('link', { name: /Mia/ }).click();
  // the kid's photo is readable by the parent
  await expect(page.locator('img').first()).toBeVisible();
  await page.getByRole('button', { name: /^aprobar$/i }).click();
  // wait for the approval to come back before navigating: it is a callable
  // round trip, and a goto here tears the page down mid-call
  await expect(page.getByText(/monto aprobado/i)).toBeVisible();

  // --- kid: the pay stub, gross to net, and the balance ---
  await page.goto('/kid/invoices');
  await expect(page.getByText(/aprobada/i)).toBeVisible();
  // the starter preset is savings 20% AND family tax 10%, so 5.000 gross
  // leaves 3.500 spendable, 1.000 in savings and 500 withheld
  const stub = page.getByTestId(/^paystub-/);
  await expect(stub).toContainText('5.000');   // gross, COP formatting
  await expect(stub).toContainText('1.000');   // to savings
  await expect(stub).toContainText('500');     // withheld
  await expect(stub).toContainText('3.500');   // net
  await page.goto('/kid');
  await expect(page.getByTestId('spendable')).toContainText('3.500');
  await expect(page.getByTestId('savings')).toContainText('1.000');

  // --- parent: pay it out ---
  await page.goto('/payouts');
  const payCard = page.getByRole('group', { name: /Mia/ });
  await payCard.getByLabel(/monto a pagar/i).fill('3500');
  await payCard.getByRole('button', { name: /registrar pago/i }).click();
  // the ledger entry appearing is the parent-side proof the callable returned
  await expect(payCard.getByText(/^Pago/)).toBeVisible();
  await page.goto('/kid');
  await expect(page.getByTestId('spendable')).toContainText('0');
});

test('a second kid on the same device cannot read the first kid’s cache', async ({ page }) => {
  // the whole reason Task 11 destroys the cache on identity change: real
  // IndexedDB, real reload, two kids, one browser profile
  await signUpParent(page);
  await createFamily(page);

  const codes = [await addKid(page, 'Mia'), await addKid(page, 'Sib')];
  const { familyId, firstKidId } = await ids();

  // kid one signs in and reads their own balance, warming the cache
  await page.goto('/kid');
  await page.getByLabel(/código/i).fill(codes[0]!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: /Hola, Mia/ })).toBeVisible();

  // hand the device over: the switcher ends the session and clears the cache.
  // Wait for the parent view before navigating — a goto here races the
  // teardown (terminate, clear, deleteApp, rebuild) it just kicked off.
  await page.getByRole('button', { name: /volver con un adulto/i }).click();
  await expect(page.getByRole('heading', { name: /facturas pendientes/i })).toBeVisible();
  await page.goto('/kid');
  await page.getByLabel(/código/i).fill(codes[1]!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: /Hola, Sib/ })).toBeVisible();

  await page.reload();
  // the second kid is still signed in after a reload — this is what the
  // stable app name buys; a generation-suffixed name would fail here
  await expect(page.getByRole('heading', { name: /Hola, Sib/ })).toBeVisible();
  await expect(page.getByText(/Hola, Mia/)).toHaveCount(0);

  // and the real question: can anything still READ the first kid's document?
  // Asserting on IndexedDB database NAMES cannot answer that — Firestore
  // names its store `firestore/<appName>/<project>/main`, so a name check is
  // both implementation-coupled and, for a stable app name, always true.
  const kidPath = `families/${familyId}/kids/${firstKidId}`;
  const leaked = await page.evaluate(async (path) =>
    (window as unknown as { __mk: { cachedRead(p: string): Promise<boolean> } })
      .__mk.cachedRead(path), kidPath);
  expect(leaked, 'the first kid’s document was still served from cache').toBe(false);

  const denied = await page.evaluate(async (path) =>
    (window as unknown as { __mk: { serverRead(p: string): Promise<string> } })
      .__mk.serverRead(path), kidPath);
  // rules deny it too: cache isolation is the fix, not the only guard
  expect(denied).toMatch(/permission-denied/);
});

test('a draft written offline survives a reload and syncs', async ({ page, context }) => {
  await signUpParent(page);
  await createFamily(page);
  const code = await addKid(page, 'Mia');

  await page.goto('/kid');
  await page.getByLabel(/código/i).fill(code);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page.getByRole('heading', { name: /Hola, Mia/ })).toBeVisible();

  // load the builder BEFORE cutting the network: setOffline disconnects the
  // whole context, so even fetching the dev server would fail. In production
  // the service worker serves the shell; in dev it is switched off.
  await page.goto('/kid/new');
  await context.setOffline(true);

  await page.getByRole('button', { name: /ayudar/i }).click();
  await page.getByLabel(/qué hiciste/i).fill('Sin internet');
  await page.getByLabel(/cuánto/i).fill('3000');
  await page.getByRole('button', { name: /guardar/i }).click();
  // the builder moves on without waiting for a server that is not there —
  // this is the whole point of createDraft returning the id immediately
  await expect(page.getByText(/ahora puedes agregar fotos/i)).toBeVisible();

  // in-app navigation needs no network: the draft is already readable from
  // the kid's own cache
  await page.getByRole('link', { name: /mis facturas/i }).click();
  await expect(page.getByText(/Sin internet/)).toBeVisible();
  await expect(page.getByText(/sin enviar/i)).toBeVisible();

  // back online, a real reload: the draft survived IndexedDB and synced
  await context.setOffline(false);
  await page.reload();
  await page.goto('/kid/invoices');
  await expect(page.getByText(/Sin internet/)).toBeVisible();
});
