import type { ReactNode } from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Modal,
  ModalOverlay,
  type DialogProps as AriaDialogProps,
  type ModalOverlayProps,
} from "react-aria-components";
import { cn } from "../lib/utils";

export interface DialogProps extends AriaDialogProps {
  trigger?: ReactNode;
  isOpen?: ModalOverlayProps["isOpen"];
  onOpenChange?: ModalOverlayProps["onOpenChange"];
  className?: string;
}

export function Dialog({
  trigger,
  isOpen,
  onOpenChange,
  className,
  children,
  ...props
}: Readonly<DialogProps>) {
  const content = (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <Modal className="z-50 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl outline-none">
        <AriaDialog className={cn("outline-none", className)} {...props}>
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );

  if (trigger) {
    return (
      <DialogTrigger>
        {trigger}
        {content}
      </DialogTrigger>
    );
  }

  return content;
}

export { DialogTrigger };
