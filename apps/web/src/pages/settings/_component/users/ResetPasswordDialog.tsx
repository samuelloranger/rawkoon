import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const tooShort = password.length > 0 && password.length < MIN_LENGTH;

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
          if (password.length >= MIN_LENGTH) onSubmit(password);
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
        {tooShort && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {t("settings.users.passwordMinLength")}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={password.length < MIN_LENGTH || isPending}
          >
            {t("settings.users.passwordResetTitle")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
