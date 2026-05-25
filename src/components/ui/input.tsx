import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-light-blue bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-cool-gray/60 focus-visible:border-maroon focus-visible:ring-2 focus-visible:ring-maroon/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
