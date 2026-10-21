import type { ReactNode } from "react";

export default function DisclosureSummary({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <summary className="disclosure-summary">
      <span className="disclosure-label">{children}</span>
      <svg
        className="disclosure-chevron"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
    </summary>
  );
}
