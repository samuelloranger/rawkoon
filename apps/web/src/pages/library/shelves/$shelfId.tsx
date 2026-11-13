import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentUser } from "@/lib/auth";
import { ShelfEditorPage } from "@/pages/library/_component/shelves/ShelfEditorPage";

export const Route = createFileRoute("/library/shelves/$shelfId")({
  beforeLoad: async () => {
    try {
      const user = await getCurrentUser();
      if (!user) throw redirect({ to: "/login" });
      return { user };
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 429) return { user: null };
      throw e;
    }
  },
  component: ShelfEditorRoute,
});

function ShelfEditorRoute() {
  const { shelfId } = Route.useParams();
  return <ShelfEditorPage shelfId={Number(shelfId)} />;
}
