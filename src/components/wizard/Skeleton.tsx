import { cn } from "@/lib/utils";

interface RowProps {
  width?: string;
  className?: string;
}

export function SkeletonRow({ width = "100%", className }: RowProps) {
  return <div className={cn("h-4 animate-pulse rounded bg-white/10", className)} style={{ width }} />;
}

interface CardProps {
  rows?: number;
  className?: string;
}

export function SkeletonCard({ rows = 3, className }: CardProps) {
  return (
    <div className={cn("space-y-3 rounded-xl border border-white/10 bg-white/5 p-4", className)}>
      <SkeletonRow width="60%" />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} width={`${80 - i * 10}%`} />
      ))}
    </div>
  );
}

interface BlockProps {
  heading?: string;
}

export function SkeletonBlock({ heading }: BlockProps) {
  return (
    <div className="space-y-2">
      {heading ? <h2 className="text-lg font-semibold text-white/80">{heading}</h2> : <SkeletonRow width="40%" />}
      <SkeletonRow width="90%" />
      <SkeletonRow width="80%" />
      <SkeletonRow width="70%" />
    </div>
  );
}
