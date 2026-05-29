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

interface SocraticSkeletonProps {
  approxN?: number;
}

export function SocraticSkeleton({ approxN = 4 }: SocraticSkeletonProps) {
  return (
    <div className="space-y-4">
      {Array.from({ length: approxN }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
          <SkeletonRow width="70%" />
          <SkeletonRow width="100%" className="h-12" />
        </div>
      ))}
    </div>
  );
}

export function AlternativesSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <SkeletonRow width="60%" />
          <div className="space-y-2">
            <SkeletonRow width="40%" className="h-3" />
            <SkeletonRow width="90%" className="h-3" />
            <SkeletonRow width="80%" className="h-3" />
          </div>
          <div className="space-y-2">
            <SkeletonRow width="40%" className="h-3" />
            <SkeletonRow width="85%" className="h-3" />
            <SkeletonRow width="75%" className="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

const ARTIFACT_HEADINGS = ["Needs", "Criteria", "Options", "Risks", "Open questions"];

export function ArtifactSkeleton() {
  return (
    <div className="space-y-5">
      <SkeletonRow width="65%" className="h-6" />
      {ARTIFACT_HEADINGS.map((heading) => (
        <div key={heading} className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wider text-white/60 uppercase">{heading}</h2>
          <SkeletonRow width="92%" className="h-3" />
          <SkeletonRow width="84%" className="h-3" />
          <SkeletonRow width="78%" className="h-3" />
        </div>
      ))}
    </div>
  );
}

export function AntiBiasSkeleton() {
  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-5">
      <SkeletonRow width="50%" className="h-5" />
      <SkeletonRow width="90%" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2 pt-2">
          <SkeletonRow width="35%" className="h-4" />
          <SkeletonRow width="95%" />
          <SkeletonRow width="85%" />
        </div>
      ))}
    </div>
  );
}
