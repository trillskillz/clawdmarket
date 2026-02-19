export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div className={`skeleton-shimmer rounded-lg ${className}`} />
  );
}

export function SkeletonCard() {
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 skeleton-shimmer rounded-lg" />
        <div className="w-16 h-6 skeleton-shimmer rounded-full" />
      </div>
      <div className="h-5 skeleton-shimmer rounded w-3/4 mb-2" />
      <div className="h-4 skeleton-shimmer rounded w-full mb-1" />
      <div className="h-4 skeleton-shimmer rounded w-2/3 mb-4" />
      <div className="pt-4 border-t border-border flex justify-between">
        <div>
          <div className="h-3 skeleton-shimmer rounded w-10 mb-1" />
          <div className="h-6 skeleton-shimmer rounded w-20" />
        </div>
        <div className="text-right">
          <div className="h-3 skeleton-shimmer rounded w-10 mb-1 ml-auto" />
          <div className="h-5 skeleton-shimmer rounded w-16" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonListItem() {
  return (
    <div className="card flex justify-between items-center">
      <div>
        <div className="h-5 skeleton-shimmer rounded w-48 mb-2" />
        <div className="h-4 skeleton-shimmer rounded w-32" />
      </div>
      <div className="text-right">
        <div className="h-5 skeleton-shimmer rounded w-20 mb-2 ml-auto" />
        <div className="h-5 skeleton-shimmer rounded-full w-14 ml-auto" />
      </div>
    </div>
  );
}

export function SkeletonDetail() {
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 skeleton-shimmer rounded-lg" />
          <div>
            <div className="h-3 skeleton-shimmer rounded w-16 mb-2" />
            <div className="h-8 skeleton-shimmer rounded w-64" />
          </div>
        </div>
        <div className="w-16 h-6 skeleton-shimmer rounded-full" />
      </div>
      <div className="mb-8">
        <div className="h-5 skeleton-shimmer rounded w-28 mb-3" />
        <div className="h-4 skeleton-shimmer rounded w-full mb-2" />
        <div className="h-4 skeleton-shimmer rounded w-full mb-2" />
        <div className="h-4 skeleton-shimmer rounded w-3/4" />
      </div>
      <div className="skeleton-shimmer rounded-lg p-6 mb-6">
        <div className="flex justify-between mb-4">
          <div>
            <div className="h-3 skeleton-shimmer rounded w-10 mb-2" />
            <div className="h-10 skeleton-shimmer rounded w-32" />
          </div>
          <div className="text-right">
            <div className="h-3 skeleton-shimmer rounded w-10 mb-2 ml-auto" />
            <div className="h-6 skeleton-shimmer rounded w-24" />
          </div>
        </div>
      </div>
      <div className="h-14 skeleton-shimmer rounded-lg w-full" />
    </div>
  );
}
