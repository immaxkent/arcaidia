/**
 * The Arcaidia icon mark — an arcade-token diamond with an arc bridging a
 * pink node to a gold node. Kept in sync by hand with public/favicon.svg,
 * which is the same shape rasterised for the browser tab / home screen icon.
 */
export function ArcaidiaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Arcaidia">
      <polygon
        points="50,8 92,50 50,92 8,50"
        fill="#07090b"
        stroke="#e9ff3f"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path d="M34,62 Q42,36 50,34" fill="none" stroke="#ff2b93" strokeWidth="6" strokeLinecap="round" />
      <path d="M50,34 Q58,36 66,62" fill="none" stroke="#ffb627" strokeWidth="6" strokeLinecap="round" />
      <circle cx="34" cy="62" r="7" fill="#ff2b93" />
      <circle cx="66" cy="62" r="7" fill="#ffb627" />
      <circle cx="50" cy="33" r="5" fill="#e9ff3f" />
    </svg>
  );
}
