import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { jellyfinErrorKey } from "@/lib/auth/useJellyfinSignIn";

interface Props {
  /** Throws on failure; the form maps the status to a message. */
  onSubmit: (credentials: {
    username: string;
    password: string;
  }) => Promise<unknown>;
  onBack: () => void;
  submitLabel: string;
  pending: boolean;
}

const INPUT =
  "focus-ring appearance-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 rounded-md focus:border-primary-500 sm:text-sm";

export function JellyfinSignInForm({
  onSubmit,
  onBack,
  submitLabel,
  pending,
}: Props) {
  const { t } = useTranslation("common");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorKey(null);
    try {
      await onSubmit({ username: username.trim(), password });
    } catch (error: unknown) {
      setErrorKey(jellyfinErrorKey(error));
    }
  };

  return (
    <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="jellyfin-username" className="sr-only">
          {t("login.jellyfin.username")}
        </label>
        <input
          id="jellyfin-username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("login.jellyfin.username")}
          className={INPUT}
        />
      </div>
      <div>
        <label htmlFor="jellyfin-password" className="sr-only">
          {t("login.password")}
        </label>
        <input
          id="jellyfin-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("login.password")}
          className={INPUT}
        />
      </div>
      <p className="text-xs text-neutral-400">{t("login.jellyfin.hint")}</p>
      {errorKey && (
        <p role="alert" className="text-sm text-red-400">
          {t(errorKey)}
        </p>
      )}
      <div className="space-y-3">
        <button
          type="submit"
          disabled={pending || !username.trim() || !password}
          className="focus-ring w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? t("login.loading") : submitLabel}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="focus-ring w-full flex justify-center py-2 px-4 border border-neutral-600 text-sm font-medium rounded-md text-neutral-300 bg-neutral-800 hover:bg-neutral-700"
        >
          {t("login.jellyfin.back")}
        </button>
      </div>
    </form>
  );
}
