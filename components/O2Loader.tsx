"use client";

interface O2LoaderProps {
  size?: "sm" | "md" | "lg";
}

export default function O2Loader({ size = "md" }: O2LoaderProps) {
  const sizes = {
    sm: { logo: "text-xl", bar: "w-16" },
    md: { logo: "text-2xl", bar: "w-20" },
    lg: { logo: "text-3xl", bar: "w-24" },
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      {/* O2 CMS Logo - static, black */}
      <div className={`${sizes[size].logo} font-bold tracking-tight text-[var(--text-primary)]`}>
        O2 CMS
      </div>

      {/* Loading bar - black */}
      <div className={`${sizes[size].bar} h-1 bg-gray-200 rounded-full overflow-hidden`}>
        <div className="h-full bg-[var(--text-primary)] rounded-full animate-loading-bar" />
      </div>
    </div>
  );
}

