import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

const storybookI18n = createInstance();
let initialization: Promise<void> | null = null;

async function loadLocale(language: string) {
  const response = await fetch(`/locales/${language}/common.json`);
  if (!response.ok) {
    throw new Error(`Unable to load Storybook locale: ${language}`);
  }
  return response.json();
}

export function initializeStorybookI18n() {
  if (!initialization) {
    initialization = Promise.all([loadLocale("en"), loadLocale("es"), loadLocale("fr")])
      .then(([en, es, fr]) =>
        storybookI18n.use(initReactI18next).init({
          resources: {
            en: { common: en },
            es: { common: es },
            fr: { common: fr },
          },
          lng: "en",
          fallbackLng: "en",
          defaultNS: "common",
          interpolation: { escapeValue: false },
          react: { useSuspense: false },
        })
      )
      .then(() => undefined);
  }
  return initialization;
}

export default storybookI18n;
