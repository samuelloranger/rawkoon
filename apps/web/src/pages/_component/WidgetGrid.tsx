import { CardErrorBoundary } from "@/components/ErrorBoundary";
import { NowWatchingWidget } from "@/pages/_component/NowWatchingWidget";
import { DownloadsPanel } from "@/pages/_component/DownloadsPanel";
import { LibraryAttentionPanel } from "@/pages/_component/LibraryAttentionPanel";
import { RssStatusPanel } from "@/pages/_component/RssStatusPanel";
import { ContinueListeningWidget } from "@/features/continue/ContinueListeningWidget";

export function WidgetGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <CardErrorBoundary>
        <ContinueListeningWidget />
      </CardErrorBoundary>
      <CardErrorBoundary>
        <NowWatchingWidget />
      </CardErrorBoundary>
      <CardErrorBoundary>
        <DownloadsPanel />
      </CardErrorBoundary>
      <CardErrorBoundary>
        <LibraryAttentionPanel />
      </CardErrorBoundary>
      <CardErrorBoundary>
        <RssStatusPanel />
      </CardErrorBoundary>
    </div>
  );
}
