import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Smooth-scroll to the discover anchor only when the **page** changes while
 * filters (service, genre, sort, language, media type, locale) stay the same.
 * Filter changes do not scroll; neither does the first paint or Strict Mode
 * duplicate passes.
 */
export function useDiscoverScrollToAnchor(
  topRef: RefObject<HTMLDivElement | null>,
  filterSignature: string,
  page: number,
) {
  const prevRef = useRef<{
    filterSignature: string;
    page: number;
  } | null>(null);

  useLayoutEffect(() => {
    const prev = prevRef.current;
    if (prev === null) {
      prevRef.current = { filterSignature, page };
      return;
    }

    const onlyPagination =
      prev.filterSignature === filterSignature && prev.page !== page;

    prevRef.current = { filterSignature, page };

    if (!onlyPagination) return;

    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [filterSignature, page, topRef]);
}
