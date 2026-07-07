import { ReactNode } from "react";
import { usePWA } from "@/lib/sw/usePWA";

interface PageLayoutProps {
  children: ReactNode;
  className?: string;
  fullWidth?: boolean;
}

export function PageLayout({
  children,
  className = "",
  fullWidth = false,
}: PageLayoutProps) {
  const { isStandalone } = usePWA();
  return (
    <div
      className={`pt-8 w-full ${fullWidth ? "" : "max-w-7xl"} mx-auto px-4 ${isStandalone ? "pb-8" : "pb-4"} sm:px-6 lg:px-8 ${className}`}
    >
      {children}
    </div>
  );
}
