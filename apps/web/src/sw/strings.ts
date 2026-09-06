export type SwUiStrings = {
  open: string;
  close: string;
  fallbackBody: string;
};

// English until the page posts the active locale's strings.
let strings: SwUiStrings = {
  open: "Open",
  close: "Close",
  fallbackBody: "You have a new notification",
};

export function setSwStrings(next: Partial<SwUiStrings>): void {
  strings = { ...strings, ...next };
}

export function getSwStrings(): SwUiStrings {
  return strings;
}
