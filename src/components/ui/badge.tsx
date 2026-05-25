import * as React from "react";
import { cn } from "@/lib/utils";

const variantClasses = {
  default: "bg-maroon text-white",
  secondary: "bg-light-blue text-cool-gray",
  destructive: "bg-red-600/10 text-red-600",
  outline: "border-light-blue text-ink",
} as const;

type BadgeProps = React.ComponentProps<"span"> & {
  variant?: keyof typeof variantClasses;
};

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
