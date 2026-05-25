import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-light-blue bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-cool-gray/60 focus-visible:border-maroon focus-visible:ring-2 focus-visible:ring-maroon/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
