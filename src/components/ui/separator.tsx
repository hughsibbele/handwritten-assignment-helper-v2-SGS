import * as React from "react";
import { cn } from "@/lib/utils";

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<"hr"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <hr
      className={cn(
        "shrink-0 border-0 bg-light-blue",
        orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
