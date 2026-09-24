/**
 * Memoized date formatting utility.
 * Reuses Intl.DateTimeFormat instance and maintains a LRU/Map cache
 * for formatted date strings to avoid GC pressure and date parsing overhead.
 */

let memoizedFormatter: Intl.DateTimeFormat | null = null;
let currentLocale: string | null = null;

const dateCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;

/**
 * Format a date string, number, or Date instance into a localized string.
 * Results are memoized by input string and locale.
 */
export function formatDate(dateInput?: string | number | Date | null, localeStr?: string): string {
  if (!dateInput) return '';

  const key = `${localeStr || ''}:${String(dateInput)}`;
  const cached = dateCache.get(key);
  if (cached) return cached;

  if (dateCache.size >= MAX_CACHE_SIZE) {
    dateCache.clear();
  }

  try {
    let dateObj: Date;
    if (dateInput instanceof Date) {
      dateObj = dateInput;
    } else if (typeof dateInput === 'number') {
      dateObj = new Date(dateInput);
    } else {
      const raw = dateInput.trim();
      const isoLike = raw.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
      dateObj = new Date(isoLike);
      if (isNaN(dateObj.getTime())) {
        const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          const [, y, m, d] = match;
          dateObj = new Date(Number(y), Number(m) - 1, Number(d));
        }
      }
    }

    if (isNaN(dateObj.getTime())) {
      const strVal = String(dateInput);
      dateCache.set(key, strVal);
      return strVal;
    }

    if (!memoizedFormatter || currentLocale !== (localeStr || null)) {
      currentLocale = localeStr || null;
      memoizedFormatter = new Intl.DateTimeFormat(localeStr || undefined);
    }

    const formatted = memoizedFormatter.format(dateObj);
    dateCache.set(key, formatted);
    return formatted;
  } catch {
    const strVal = String(dateInput);
    dateCache.set(key, strVal);
    return strVal;
  }
}

/**
 * Clear the date formatting memoization cache.
 */
export function clearDateCache(): void {
  dateCache.clear();
  memoizedFormatter = null;
  currentLocale = null;
}
