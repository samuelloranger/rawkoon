// Safety guard: the e2e harness runs destructive resets, so it must only ever
// point at a throwaway database whose name ends in _e2e or _test — never dev/prod.
export function assertE2eDatabase(url: string): void {
  if (!url) throw new Error("DATABASE_URL is required for the e2e harness");
  const name = url.split("/").pop()?.split("?")[0] ?? "";
  if (!/_(e2e|test)$/.test(name)) {
    throw new Error(
      `e2e harness refuses to run against database "${name}" — name must end in _e2e or _test`,
    );
  }
}
