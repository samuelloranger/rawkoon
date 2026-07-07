import { useState, useCallback, useEffect, useRef } from "react";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { MigrateJobStatus } from "@rawkoon/shared/types";

const MIGRATE_STATUS_DEFAULT: MigrateJobStatus = {
  job_id: null,
  state: "unknown",
  progress: null,
  result: null,
  error: null,
  started_at: null,
  finished_at: null,
};

export function useMigrateStatus() {
  const [status, setStatus] = useState<MigrateJobStatus>(
    MIGRATE_STATUS_DEFAULT,
  );
  const sourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
    }
    const es = new EventSource(LIBRARY_ENDPOINTS.MIGRATE_STATUS, {
      withCredentials: true,
    });
    sourceRef.current = es;

    es.onmessage = (e) => {
      try {
        setStatus(JSON.parse(e.data) as MigrateJobStatus);
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // SSE will auto-reconnect; no action needed
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      sourceRef.current?.close();
    };
  }, [connect]);

  return status;
}
