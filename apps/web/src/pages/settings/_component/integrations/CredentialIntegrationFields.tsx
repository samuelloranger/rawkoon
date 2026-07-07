import { IntegrationUrlInput } from "@/pages/settings/_component/integrations/IntegrationUrlInput";

interface CredentialIntegrationFieldsProps {
  websiteUrlLabel: string;
  websiteUrl: string;
  onWebsiteUrlChange: (value: string) => void;
  websiteUrlPlaceholder: string;
  usernameLabel: string;
  username: string;
  onUsernameChange: (value: string) => void;
  passwordLabel: string;
  password: string;
  onPasswordChange: (value: string) => void;
  passwordPlaceholder: string;
}

export function CredentialIntegrationFields({
  websiteUrlLabel,
  websiteUrl,
  onWebsiteUrlChange,
  websiteUrlPlaceholder,
  usernameLabel,
  username,
  onUsernameChange,
  passwordLabel,
  password,
  onPasswordChange,
  passwordPlaceholder,
}: CredentialIntegrationFieldsProps) {
  return (
    <>
      <IntegrationUrlInput
        label={websiteUrlLabel}
        value={websiteUrl}
        onChange={onWebsiteUrlChange}
        placeholder={websiteUrlPlaceholder}
      />

      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-300">
          {usernameLabel}
        </label>
        <input
          type="text"
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          placeholder="admin"
          className="w-full rounded-lg border border-neutral-600 bg-neutral-900 px-4 py-2 text-white"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-300">
          {passwordLabel}
        </label>
        <input
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder={passwordPlaceholder}
          className="w-full rounded-lg border border-neutral-600 bg-neutral-900 px-4 py-2 font-mono text-white"
        />
      </div>
    </>
  );
}
