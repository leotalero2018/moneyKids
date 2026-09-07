import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { minorDigits } from '@money-kids/shared';
import type { FirebaseBundle } from '../firebase.js';

export type Pillar = 'learn' | 'courage' | 'ideas' | 'help';

export interface CatalogEntry {
  titleEs: string;
  titleEn: string;
  descriptionEs: string;
  descriptionEn: string;
  /** in whole major units of whatever currency the family uses */
  suggestedMajor: number;
  category: Pillar;
  repeatable: boolean;
}

/**
 * A catalog price is currency-agnostic, so it scales at seed time. The entry
 * field is `suggestedMajor`; the Firestore field is `suggestedPrice` and is
 * always minor units. Conflating them is a 100x money bug.
 */
export function catalogPriceInMinor(major: number, currency: string): number {
  return major * 10 ** minorDigits(currency);
}

export const STARTER_CATALOG: readonly CatalogEntry[] = [
  {
    titleEs: 'Lee un libro y cuéntamelo',
    titleEn: 'Read a book and tell me about it',
    descriptionEs: 'Lee un libro o un capítulo y explícame de qué se trata con tus palabras.',
    descriptionEn: 'Read a book or a chapter and explain what it was about in your own words.',
    suggestedMajor: 5, category: 'learn', repeatable: true,
  },
  {
    titleEs: 'Enséñame algo que aprendiste',
    titleEn: 'Teach me something you learned',
    descriptionEs: 'Explícame algo nuevo que aprendiste esta semana, como si yo no supiera nada.',
    descriptionEn: 'Explain something new you learned this week, as if I knew nothing about it.',
    suggestedMajor: 4, category: 'learn', repeatable: true,
  },
  {
    titleEs: 'Haz algo que te daba miedo',
    titleEn: 'Do something that scared you',
    descriptionEs: 'Cuéntame qué te daba miedo, qué hiciste y cómo te sentiste después.',
    descriptionEn: 'Tell me what scared you, what you did, and how you felt afterwards.',
    suggestedMajor: 8, category: 'courage', repeatable: true,
  },
  {
    titleEs: 'Habla en público o pide algo tú solo',
    titleEn: 'Speak up in public or ask for something yourself',
    descriptionEs: 'Pide algo en una tienda, saluda a alguien nuevo o habla frente al grupo.',
    descriptionEn: 'Order something in a shop, greet someone new, or speak in front of a group.',
    suggestedMajor: 6, category: 'courage', repeatable: true,
  },
  {
    titleEs: 'Trae una idea pensada',
    titleEn: 'Bring a thought-through idea',
    descriptionEs: 'Una idea útil para la casa o la familia, con el por qué y cómo se haría.',
    descriptionEn: 'A useful idea for the home or the family, with why it helps and how it would work.',
    suggestedMajor: 7, category: 'ideas', repeatable: true,
  },
  {
    titleEs: 'Resuelve un problema que viste',
    titleEn: 'Solve a problem you noticed',
    descriptionEs: 'Encuentra algo que no funciona bien en casa y propón cómo arreglarlo.',
    descriptionEn: 'Find something that does not work well at home and propose how to fix it.',
    suggestedMajor: 7, category: 'ideas', repeatable: true,
  },
  {
    titleEs: 'Ayuda con la cocina',
    titleEn: 'Help with a meal',
    descriptionEs: 'Ayuda a preparar o a recoger, y déjalo mejor de como lo encontraste.',
    descriptionEn: 'Help cook or clean up, and leave it better than you found it.',
    suggestedMajor: 3, category: 'help', repeatable: true,
  },
  {
    titleEs: 'Cuida a tu hermano o hermana',
    titleEn: 'Look after your brother or sister',
    descriptionEs: 'Juega, ayuda con la tarea o acompáñalo un rato sin que nadie te lo pida.',
    descriptionEn: 'Play, help with homework, or keep them company without being asked.',
    suggestedMajor: 5, category: 'help', repeatable: true,
  },
];

/** Writes the whole catalog in one batch, scaled to the family currency. */
export async function seedCatalog(
  fb: FirebaseBundle, familyId: string, currency: string, uid: string,
): Promise<void> {
  const { db } = fb;
  const batch = writeBatch(db);
  for (const entry of STARTER_CATALOG) {
    batch.set(doc(collection(db, `families/${familyId}/activities`)), {
      titleEs: entry.titleEs,
      titleEn: entry.titleEn,
      descriptionEs: entry.descriptionEs,
      descriptionEn: entry.descriptionEn,
      suggestedPrice: catalogPriceInMinor(entry.suggestedMajor, currency),
      category: entry.category,
      repeatable: entry.repeatable,
      active: true,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}
