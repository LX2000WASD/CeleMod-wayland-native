import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';

export type TranslationValue = string | number | boolean | null | undefined;
export type TranslateFn = (
  key: string,
  slots?: Record<string, TranslationValue>,
) => string;

type TranslationMessages = Record<string, string>;

type TranslationPack = {
  code: string;
  label: string;
  path: string;
  messages: TranslationMessages;
};

type TranslationPackLoadError = {
  path: string;
  message: string;
};

type TranslationCatalog = {
  directory: string;
  packs: TranslationPack[];
  errors: TranslationPackLoadError[];
};

type LanguageOption = {
  code: string;
  label: string;
  path: string;
  builtIn: boolean;
};

const LANGUAGE_STORAGE_KEY = 'celemod-wayland-native.language';

const builtInPacks: TranslationPack[] = [
  {
    code: 'zh-CN',
    label: '简体中文',
    path: 'builtin:zh-CN',
    messages: zhCN,
  },
  {
    code: 'en-US',
    label: 'English',
    path: 'builtin:en-US',
    messages: enUS,
  },
];

export function detectPreferredLanguage() {
  if (typeof window === 'undefined') return 'zh-CN';
  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

function loadStoredLanguage() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

function normalizeLanguageCode(value: string | null | undefined) {
  if (!value) return detectPreferredLanguage();
  const normalized = value.trim();
  if (!normalized) return detectPreferredLanguage();
  if (normalized.toLowerCase().startsWith('zh')) return 'zh-CN';
  if (normalized.toLowerCase().startsWith('en')) return 'en-US';
  return normalized;
}

function interpolate(
  template: string,
  slots: Record<string, TranslationValue> = {},
) {
  return Object.entries(slots).reduce((current, [slot, value]) => {
    return current.replaceAll(`{${slot}}`, value == null ? '' : String(value));
  }, template);
}

function mergeTranslationPacks(customPacks: TranslationPack[]) {
  const merged = new Map<string, TranslationPack>();

  for (const pack of builtInPacks) {
    merged.set(pack.code, pack);
  }

  for (const pack of customPacks) {
    const existing = merged.get(pack.code);
    merged.set(pack.code, {
      code: pack.code,
      label: pack.label || existing?.label || pack.code,
      path: pack.path,
      messages: {
        ...(existing?.messages ?? {}),
        ...pack.messages,
      },
    });
  }

  const ordered = [...merged.values()];
  ordered.sort((left, right) => {
    const leftIndex = builtInPacks.findIndex((pack) => pack.code === left.code);
    const rightIndex = builtInPacks.findIndex((pack) => pack.code === right.code);
    if (leftIndex >= 0 || rightIndex >= 0) {
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }
    return left.label.toLowerCase().localeCompare(right.label.toLowerCase());
  });
  return ordered;
}

export function useI18n() {
  const [catalog, setCatalog] = useState<TranslationCatalog>({
    directory: '',
    packs: [],
    errors: [],
  });
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [currentLanguage, setCurrentLanguageState] = useState(() =>
    normalizeLanguageCode(loadStoredLanguage()),
  );

  useEffect(() => {
    let active = true;

    const loadCatalog = async () => {
      try {
        const nextCatalog = await invoke<TranslationCatalog>('get_translation_catalog');
        if (active) {
          setCatalog(nextCatalog);
        }
      } catch (error) {
        if (active) {
          setCatalog({
            directory: '',
            packs: [],
            errors: [
              {
                path: 'get_translation_catalog',
                message: String(error),
              },
            ],
          });
        }
      } finally {
        if (active) {
          setCatalogLoaded(true);
        }
      }
    };

    void loadCatalog();
    return () => {
      active = false;
    };
  }, []);

  const packs = useMemo(() => mergeTranslationPacks(catalog.packs), [catalog.packs]);
  const currentPack = useMemo(
    () => packs.find((pack) => pack.code === currentLanguage) ?? null,
    [currentLanguage, packs],
  );

  useEffect(() => {
    if (!catalogLoaded) return;
    if (packs.some((pack) => pack.code === currentLanguage)) return;
    setCurrentLanguageState(detectPreferredLanguage());
  }, [catalogLoaded, currentLanguage, packs]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);
    document.documentElement.lang = currentLanguage;
  }, [currentLanguage]);

  const setCurrentLanguage = useCallback((language: string) => {
    setCurrentLanguageState(normalizeLanguageCode(language));
  }, []);

  const t = useCallback<TranslateFn>(
    (key, slots) => {
      const translated = currentPack?.messages[key] ?? key;
      return interpolate(translated, slots);
    },
    [currentPack],
  );

  const languageOptions = useMemo<LanguageOption[]>(
    () =>
      packs.map((pack) => ({
        code: pack.code,
        label: pack.label,
        path: pack.path,
        builtIn: pack.path.startsWith('builtin:'),
      })),
    [packs],
  );

  return {
    t,
    currentLanguage,
    setCurrentLanguage,
    languageOptions,
    translationPackDirectory: catalog.directory,
    translationPackErrors: catalog.errors,
  };
}
