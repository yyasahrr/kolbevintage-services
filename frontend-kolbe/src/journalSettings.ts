import { articles, type Article } from "./siteData";

export const ADMIN_ARTICLES_KEY = "kv_admin_articles";
export const HOMEPAGE_JOURNAL_PINS_KEY = "kv_homepage_journal_pins";
const JOURNAL_SETTINGS_EVENT = "kv:journal-settings-change";

function notifyJournalSettingsChanged() {
  window.dispatchEvent(new Event(JOURNAL_SETTINGS_EVENT));
}

export function loadManagedArticles(): Article[] {
  try {
    const value = localStorage.getItem(ADMIN_ARTICLES_KEY);
    return value ? JSON.parse(value) as Article[] : articles;
  } catch { return articles; }
}

export function saveManagedArticles(items: Article[]) {
  localStorage.setItem(ADMIN_ARTICLES_KEY, JSON.stringify(items));
  notifyJournalSettingsChanged();
}

export function loadHomepageJournalPins(): string[] {
  try {
    const value = localStorage.getItem(HOMEPAGE_JOURNAL_PINS_KEY);
    return value ? JSON.parse(value) as string[] : articles.slice(0, 4).map((article) => article.slug);
  } catch { return articles.slice(0, 4).map((article) => article.slug); }
}

export function saveHomepageJournalPins(slugs: string[]) {
  localStorage.setItem(HOMEPAGE_JOURNAL_PINS_KEY, JSON.stringify(slugs));
  notifyJournalSettingsChanged();
}

export function loadHomepageArticles(): Article[] {
  const map = new Map(loadManagedArticles().map((article) => [article.slug, article]));
  return loadHomepageJournalPins().flatMap((slug) => {
    const article = map.get(slug);
    return article ? [article] : [];
  });
}

export function subscribeToJournalSettings(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ADMIN_ARTICLES_KEY || event.key === HOMEPAGE_JOURNAL_PINS_KEY) onChange();
  };
  window.addEventListener(JOURNAL_SETTINGS_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(JOURNAL_SETTINGS_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
