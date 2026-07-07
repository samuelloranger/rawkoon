import { createContext, useContext, useRef } from "react";
import type { ReactNode } from "react";

interface LibraryNavigationContextValue {
  /** The search params active when the user was last on /library. */
  librarySearch: Record<string, unknown> | null;
  saveLibrarySearch: (search: Record<string, unknown>) => void;
}

const LibraryNavigationContext = createContext<LibraryNavigationContextValue>({
  librarySearch: null,
  saveLibrarySearch: () => {},
});

export function LibraryNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  // A ref avoids unnecessary re-renders — consumers only read this on back navigation.
  const searchRef = useRef<Record<string, unknown> | null>(null);

  return (
    <LibraryNavigationContext.Provider
      value={{
        get librarySearch() {
          return searchRef.current;
        },
        saveLibrarySearch(search) {
          searchRef.current = search;
        },
      }}
    >
      {children}
    </LibraryNavigationContext.Provider>
  );
}

export function useLibraryNavigation() {
  return useContext(LibraryNavigationContext);
}
