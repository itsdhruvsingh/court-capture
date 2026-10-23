import { Gavel } from "lucide-react";
import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <span className={cn("flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent text-accentInk", className)}>
      <Gavel className="h-4 w-4" />
    </span>
  );
}
