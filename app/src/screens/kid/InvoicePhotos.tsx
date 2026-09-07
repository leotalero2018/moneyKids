import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDownloadURL, ref } from 'firebase/storage';
import { useFirebase } from '../../firebase/FirebaseContext.js';
import { useDoc } from '../../hooks/useDoc.js';
import { uploadInvoicePhoto, removeInvoicePhoto, MAX_PHOTOS } from '../../lib/photos.js';
import { Button } from '../../components/Button.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import styles from './NewInvoice.module.css';

export function InvoicePhotos({ familyId, kidId, invoiceId, onCountChange }: {
  familyId: string; kidId: string; invoiceId: string;
  onCountChange?: (count: number) => void;
}) {
  const { t } = useTranslation();
  const fb = useFirebase();
  const invoice = useDoc<{ photoPaths: string[] }>(`families/${familyId}/invoices/${invoiceId}`);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const paths = invoice.data?.photoPaths ?? [];
  const key = paths.join('|');

  // the count drives the 5-8 send gate (Task 7), so it is reported upward
  // from the one place that actually knows it: the invoice document
  useEffect(() => { onCountChange?.(paths.length); }, [paths.length, onCountChange]);

  // thumbnails: resolve each path once, and forget any that has been removed
  useEffect(() => {
    let live = true;
    const current = key === '' ? [] : key.split('|');
    void Promise.all(current.map(async (path) => {
      const url = await getDownloadURL(ref(fb.storage, path)).catch(() => null);
      return [path, url] as const;
    })).then((pairs) => {
      if (!live) return;
      setUrls(Object.fromEntries(
        pairs.filter((pair): pair is readonly [string, string] => pair[1] !== null),
      ));
    });
    return () => { live = false; };
  }, [key, fb.storage]);

  async function add(file: File) {
    if (paths.length >= MAX_PHOTOS) {
      setError(t('kidNew.photoLimit'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadInvoicePhoto(fb, { familyId, kidId, invoiceId, file });
    } catch {
      setError(t('kidNew.photoFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(path: string) {
    setBusy(true);
    setError(null);
    try {
      await removeInvoicePhoto(fb, { familyId, invoiceId, path });
    } catch {
      setError(t('kidNew.photoFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>{t('kidNew.photos')} ({paths.length}/{MAX_PHOTOS})</h2>
      {error && <ErrorBanner message={error} />}
      <input
        ref={input} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void add(file);
          e.target.value = '';
        }}
      />
      <Button disabled={busy || paths.length >= MAX_PHOTOS} onClick={() => input.current?.click()}>
        {t('kidNew.addPhoto')}
      </Button>
      <ul className={styles.thumbs}>
        {paths.map((path) => (
          <li key={path}>
            {urls[path]
              ? <img src={urls[path]} alt="" data-testid="photo-thumb" />
              : <span data-testid="photo-thumb-pending" />}
            <Button variant="danger" disabled={busy} onClick={() => void remove(path)}>
              {t('kidNew.removePhoto')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
