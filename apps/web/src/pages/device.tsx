import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Tv, XCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { HttpError } from "@/lib/api/httpClient";
import { getCurrentUser } from "@/lib/auth";

type DeviceSearch = { user_code: string };

export const Route = createFileRoute("/device")({
  validateSearch: (search: Record<string, unknown>): DeviceSearch => ({
    user_code: typeof search.user_code === "string" ? search.user_code : "",
  }),
  beforeLoad: async ({ search }) => {
    const user = await getCurrentUser().catch(() => null);
    if (!user) {
      const back = search.user_code
        ? `/device?user_code=${encodeURIComponent(search.user_code)}`
        : "/device";
      throw redirect({ to: "/login", search: { redirect: back } });
    }
  },
  component: DevicePage,
});

const cleanCode = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");

function DevicePage() {
  const { t } = useTranslation("common");
  const fetcher = useFetcher();
  const { user_code: initialCode } = Route.useSearch();
  const [code, setCode] = useState(cleanCode(initialCode));
  const [result, setResult] = useState<"approved" | "denied" | null>(null);

  const decide = useMutation({
    mutationFn: async (action: "approve" | "deny") => {
      // Verifying first ties the pending code to this signed-in user.
      await fetcher(`/api/auth/device?user_code=${encodeURIComponent(code)}`);
      await fetcher(`/api/auth/device/${action}`, {
        method: "POST",
        body: { userCode: code },
      });
      return action;
    },
    onSuccess: (action) =>
      setResult(action === "approve" ? "approved" : "denied"),
  });

  if (result) {
    const approved = result === "approved";
    return (
      <div className="flex justify-center px-4 pt-8 pb-12 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-4 text-center">
          {approved ? (
            <CheckCircle2 className="mx-auto w-12 h-12 text-green-400" />
          ) : (
            <XCircle className="mx-auto w-12 h-12 text-neutral-400" />
          )}
          <h2 className="text-2xl font-bold text-white">
            {approved ? t("device.approvedTitle") : t("device.deniedTitle")}
          </h2>
          <p className="text-sm text-neutral-400">
            {approved ? t("device.approvedBody") : t("device.deniedBody")}
          </p>
        </div>
      </div>
    );
  }

  const error =
    decide.error instanceof HttpError
      ? decide.error.apiError() || t("device.invalidCode")
      : decide.error
        ? t("device.invalidCode")
        : null;

  return (
    <div className="flex justify-center px-4 pt-8 pb-12 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Tv className="mx-auto w-10 h-10 text-primary-400" />
          <h2 className="mt-6 text-3xl font-extrabold text-white">
            {t("device.title")}
          </h2>
          <p className="mt-2 text-sm text-neutral-400">
            {t("device.description")}
          </p>
        </div>
        <div className="space-y-4">
          <label htmlFor="user-code" className="sr-only">
            {t("device.codeLabel")}
          </label>
          <input
            id="user-code"
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            autoComplete="one-time-code"
            spellCheck={false}
            className="focus-ring block w-full rounded-md border border-neutral-600 bg-neutral-800 px-3 py-3 text-center font-mono text-2xl tracking-[0.3em] text-white"
            placeholder="ABCD1234"
          />
          <p className="text-center text-xs text-neutral-500">
            {t("device.warning")}
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={!code || decide.isPending}
              onClick={() => decide.mutate("deny")}
              className="focus-ring flex-1 rounded-md border border-neutral-600 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
            >
              {t("device.deny")}
            </button>
            <button
              type="button"
              disabled={!code || decide.isPending}
              onClick={() => decide.mutate("approve")}
              className="focus-ring flex-1 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {t("device.approve")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
