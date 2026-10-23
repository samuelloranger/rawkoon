/** Bundled so the login page makes no third-party request. */
export function JellyfinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .002C8.826.002-1.398 18.537.16 21.666c1.56 3.129 22.14 3.094 23.68 0C25.38 18.573 15.177 0 12 0zm7.76 18.949c-1.008 2.028-14.493 2.05-15.514 0C3.224 16.9 9.92 4.755 12.003 4.755c2.081 0 8.77 12.166 7.759 14.196z" />
      <path d="M12 9.236c-1.06 0-4.48 6.18-3.96 7.22.52 1.04 7.4 1.04 7.92 0 .52-1.04-2.9-7.22-3.96-7.22z" />
    </svg>
  );
}
