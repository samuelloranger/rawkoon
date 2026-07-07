import { PageLayout } from "@/components/PageLayout";
import { Loader } from "@/components/Loader";

export function LoadingState() {
  return (
    <PageLayout>
      <div className="flex items-center justify-center py-8">
        <Loader size="md" />
      </div>
    </PageLayout>
  );
}
