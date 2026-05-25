"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";

const DialogContext = React.createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
}>({ open: false, setOpen: () => {} });

function Dialog({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      {children}
    </DialogContext.Provider>
  );
}

function DialogTrigger({
  children,
  render,
  ...props
}: React.ComponentProps<"button"> & { render?: React.ReactElement }) {
  const { setOpen } = React.useContext(DialogContext);
  if (render) {
    const renderProps = render.props as Record<string, unknown>;
    return React.cloneElement(
      render,
      { onClick: () => setOpen(true) } as Record<string, unknown>,
      (children ?? renderProps.children) as React.ReactNode,
    );
  }
  return (
    <button onClick={() => setOpen(true)} {...props}>
      {children}
    </button>
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  const { open, setOpen } = React.useContext(DialogContext);
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onClose = () => setOpen(false);
    el.addEventListener("close", onClose);
    return () => el.removeEventListener("close", onClose);
  }, [setOpen]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-auto w-full max-w-[calc(100%-2rem)] rounded-xl bg-white p-0 text-sm text-ink ring-1 ring-ink/10 backdrop:bg-black/10 backdrop:backdrop-blur-sm sm:max-w-sm"
    >
      <div className={cn("relative grid gap-4 p-4", className)} {...props}>
        {children}
        {showCloseButton && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md text-cool-gray transition-colors hover:bg-paper hover:text-ink"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </button>
        )}
      </div>
    </dialog>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-paper/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-base leading-none font-medium text-ink", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-cool-gray", className)} {...props} />;
}

function DialogClose(props: React.ComponentProps<"button">) {
  const { setOpen } = React.useContext(DialogContext);
  return <button onClick={() => setOpen(false)} {...props} />;
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
