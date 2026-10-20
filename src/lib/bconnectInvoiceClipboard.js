/**
 * Copies only the B-Connect invoice number, never labels, currency or a
 * supplier invoice reference. Returns false when the browser blocks copying.
 */
export async function copyBConnectInvoiceNumber(number, clipboard, legacyCopy) {
  const value = number === null || number === undefined ? '' : String(number).trim();
  if (!value) return false;

  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Permission not available: attempt a legacy selection-based fallback.
    }
  }
  if (typeof legacyCopy === 'function') {
    try { return legacyCopy(value) === true; } catch { return false; }
  }
  return false;
}
