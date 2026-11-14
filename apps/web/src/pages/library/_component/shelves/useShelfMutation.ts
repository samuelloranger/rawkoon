import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ShelfDetail } from "@rawkoon/shared/types";
import { queryKeys } from "@/lib/queryKeys";

type DetailCache = { shelf: ShelfDetail };

/** The cached detail as it is now, so back-to-back edits build on each other, not on stale props. */
export const readShelfEntries = (
  queryClient: ReturnType<typeof useQueryClient>,
  shelfId: number,
) =>
  (
    queryClient.getQueryData<DetailCache>(queryKeys.shelves.detail(shelfId))
      ?.shelf.entries ?? []
  ).filter((entry) => !entry.excluded);

/** A mutation on one shelf's detail that shows its result at once and rolls back on error. */
export function useShelfMutation<V>({
  shelfId,
  mutationFn,
  apply,
  errorMessage,
}: {
  shelfId: number;
  mutationFn: (variables: V) => Promise<unknown>;
  apply: (shelf: ShelfDetail, variables: V) => ShelfDetail;
  errorMessage: string;
}) {
  const queryClient = useQueryClient();
  const key = queryKeys.shelves.detail(shelfId);
  const mutationKey = [...queryKeys.shelves.all, "edit", shelfId];

  return useMutation({
    mutationKey,
    mutationFn,
    onMutate: async (variables: V) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DetailCache>(key);
      queryClient.setQueryData<DetailCache>(key, (old) =>
        old ? { shelf: apply(old.shelf, variables) } : old,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(errorMessage);
    },
    onSettled: async () => {
      // The last edit to settle refetches; an earlier one would flash stale data over the later edit
      if (queryClient.isMutating({ mutationKey }) > 1) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.shelves.all });
    },
  });
}
