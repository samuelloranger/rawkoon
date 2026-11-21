import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validatePasswordComplexity } from "@/lib/utils/passwordRules";

const MIN_LENGTH = 8;

interface Props {
  /** Email of the account being reset; the dialog is open while set. */
  email: string | null;
  isPending: boolean;
  onSubmit: (password: string) => void;
  onClose: () => void;
}

export function ResetPasswordDialog({
  email,
  isPending,
  onSubmit,
  onClose,
}: Props) {
  const { t } = useTranslation("common");
  const [password, setPassword] = useState("");
  // Same rules the server enforces, so a weak password is caught before submit.
  const complexity = validatePasswordComplexity(password, t);
  const problem =
    password.length === 0
      ? null
      : password.length < MIN_LENGTH
        ? t("settings.users.passwordMinLength")
        : complexity === true
          ? null
          : complexity;
  const valid = password.length >= MIN_LENGTH && complexity === true;

  const close = () => {
    setPassword("");
    onClose();
  };

  return (
    <Dialog
      isOpen={email !== null}
      onClose={close}
      title={t("settings.users.passwordResetTitle")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(password);
        }}
      >
        <label
          htmlFor="reset-password-input"
          className="mb-2 block text-sm text-neutral-400"
        >
          {t("settings.users.passwordResetPrompt", { email })}
        </label>
        <Input
          id="reset-password-input"
          type="password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {problem && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {problem}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!valid || isPending}>
            {t("settings.users.passwordResetTitle")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
