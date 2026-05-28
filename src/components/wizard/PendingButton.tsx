import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  pending: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  pendingText?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}

export function PendingButton({ pending, onClick, children, icon, pendingText, disabled, type = "button" }: Props) {
  const isDisabled = pending || disabled;
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          {pendingText ?? "Working…"}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {icon}
          {children}
        </span>
      )}
    </Button>
  );
}
