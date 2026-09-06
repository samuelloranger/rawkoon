import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import commonEn from "@/locales/en/common.json";
import commonFr from "@/locales/fr/common.json";

function applyDocumentLang(lng: string): void {
  if (typeof document === "undefined") return;
  const lang = lng.split("-")[0] || "en";
  document.documentElement.lang = lang;
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: commonEn,
      },
      fr: {
        common: commonFr,
      },
    },
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common"],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

applyDocumentLang(i18n.resolvedLanguage ?? i18n.language);
i18n.on("languageChanged", applyDocumentLang);

export default i18n;
