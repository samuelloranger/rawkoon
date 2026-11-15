import { useAddFlow } from "@/features/add/useAddFlow";

/** Adds a TMDB title (dialog, or instantly when the dialog is off); null when skipped, cancelled or failed. */
export function useAddTitle() {
  const { add, isAdding } = useAddFlow();
  return { addTitle: add, isAdding };
}
