import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getCurrentUser } from "@/lib/auth";
import { useBook } from "@/pages/books/_hooks/useBooks";
import { useBookManifest } from "@/features/books/useBookReading";
import { ReaderShell } from "@/features/reader/ReaderShell";

export const Route = createFileRoute("/books/$bookId/read")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { user };
  },
  component: ReadRoute,
});

function ReadRoute() {
  const { bookId } = Route.useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const { data: book } = useBook(Number(bookId));
  const edition = book?.item.editions.find(
    (edition) => edition.kind === "ebook",
  );
  const { data, isPending, isError } = useBookManifest(edition?.id ?? null);

  const close = () =>
    void navigate({ to: "/books/$bookId", params: { bookId } });

  if (isPending || !data) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface-base text-sm text-text-muted">
        {isError ? t("books.reader.openFailed") : t("books.reader.opening")}
      </div>
    );
  }

  return <ReaderShell manifest={data.manifest} onClose={close} />;
}
