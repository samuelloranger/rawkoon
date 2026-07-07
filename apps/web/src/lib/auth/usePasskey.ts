import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth/betterAuthClient";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";

export function browserSupportsWebAuthn(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

interface PasskeyCredential {
  id: string;
  credentialID: string;
  name?: string | null;
  deviceType: string;
  backedUp: boolean;
  transports?: string | null;
  createdAt?: string | Date | null;
}

interface CredentialsResponse {
  credentials: Array<{
    id: string;
    credential_id: string;
    name: string | null;
    device_type: string;
    backed_up: boolean;
    transports: string[];
    created_at: string | null;
  }>;
}

function mapPasskey(passkey: PasskeyCredential) {
  return {
    id: passkey.id,
    credential_id: passkey.credentialID,
    name: passkey.name ?? null,
    device_type: passkey.deviceType,
    backed_up: passkey.backedUp,
    transports: passkey.transports ? passkey.transports.split(",") : [],
    created_at: passkey.createdAt
      ? new Date(passkey.createdAt).toISOString()
      : null,
  };
}

export function usePasskeyCredentials() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.auth.passkeyCredentials,
    queryFn: async (): Promise<CredentialsResponse> => {
      const passkeys = await fetcher<PasskeyCredential[]>(
        "/api/auth/passkey/list-user-passkeys",
      );
      return { credentials: passkeys.map(mapPasskey) };
    },
    staleTime: 5 * 60_000,
  });
}

export function usePasskeyRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name?: string) => {
      const result = await authClient.passkey.addPasskey({ name });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.auth.passkeyCredentials,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}

export function useDeletePasskey() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentialId: string) =>
      fetcher<{ success: boolean }>("/api/auth/passkey/delete-passkey", {
        method: "POST",
        body: { id: credentialId },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.auth.passkeyCredentials,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}

export function usePasskeyAuthenticate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.passkey();
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
    },
  });
}
