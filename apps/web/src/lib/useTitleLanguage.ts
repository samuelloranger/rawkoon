import { useTranslation } from "react-i18next";
import {
  normalizeTitleLanguage,
  type TitleLanguage,
} from "@rawkoon/shared/constants";

/** The active UI locale, narrowed to a language the API stores titles for. */
export function useTitleLanguage(): TitleLanguage {
  const { i18n } = useTranslation();
  return normalizeTitleLanguage(i18n.language);
}
