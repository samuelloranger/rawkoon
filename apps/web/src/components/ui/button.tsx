import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary-600 text-neutral-950 hover:bg-primary-500",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        outline:
          "border border-neutral-700 bg-neutral-800 text-neutral-100 hover:bg-neutral-700 hover:text-neutral-50",
        secondary: "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
        ghost: "text-neutral-100 hover:bg-neutral-800 hover:text-neutral-50",
        link: "text-primary-400 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * No `asChild`. This component renders a real <button> and nothing else —
 * an earlier version advertised the prop without implementing Radix Slot, so
 * it silently reached the DOM and any <a> passed as a child lost every style.
 * For a link that looks like a button, style the anchor or Link directly.
 */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
