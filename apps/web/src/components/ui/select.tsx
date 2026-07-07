import * as React from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = RadixSelect.Root;
const SelectValue = RadixSelect.Value;

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof RadixSelect.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <RadixSelect.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md px-3 py-2 text-sm",
      "border border-neutral-700 border-l-2 border-l-neutral-700 bg-neutral-800 text-neutral-100",
      "focus:outline-none focus:border-l-primary-400 focus:shadow-[0_0_0_3px_rgba(232,160,106,0.12)]",
      "transition-all duration-150",
      "disabled:cursor-not-allowed disabled:opacity-40",
      className,
    )}
    {...props}
  >
    {children}
    <RadixSelect.Icon asChild>
      <ChevronDown className="size-4 shrink-0 text-neutral-400" />
    </RadixSelect.Icon>
  </RadixSelect.Trigger>
));
SelectTrigger.displayName = RadixSelect.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof RadixSelect.Content>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <RadixSelect.Portal>
    <RadixSelect.Content
      ref={ref}
      className={cn(
        "relative z-[var(--z-popover)] overflow-hidden rounded-md",
        "border border-neutral-700 bg-neutral-800 shadow-[0_8px_32px_rgba(0,0,0,0.6)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
        className,
      )}
      position={position}
      {...props}
    >
      <RadixSelect.Viewport
        className={cn(
          "p-1",
          position === "popper" && "min-w-[var(--radix-select-trigger-width)]",
        )}
      >
        {children}
      </RadixSelect.Viewport>
    </RadixSelect.Content>
  </RadixSelect.Portal>
));
SelectContent.displayName = RadixSelect.Content.displayName;

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof RadixSelect.Item>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Item>
>(({ className, children, ...props }, ref) => (
  <RadixSelect.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-3 text-sm",
      "text-neutral-100 outline-none",
      "hover:bg-neutral-700 hover:text-neutral-50",
      "data-[state=checked]:text-primary-400",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      "transition-colors duration-100",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <RadixSelect.ItemIndicator>
        <Check className="size-3 text-primary-500" />
      </RadixSelect.ItemIndicator>
    </span>
    <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
  </RadixSelect.Item>
));
SelectItem.displayName = RadixSelect.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof RadixSelect.Separator>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Separator>
>(({ className, ...props }, ref) => (
  <RadixSelect.Separator
    ref={ref}
    className={cn("my-1 h-px bg-neutral-700", className)}
    {...props}
  />
));
SelectSeparator.displayName = RadixSelect.Separator.displayName;

export { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
