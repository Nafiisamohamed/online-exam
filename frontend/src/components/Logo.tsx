/** Imtixaan logo mark: a checked answer sheet in the brand green. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <rect x="4" y="4" width="40" height="40" rx="10" fill="#0f5a35" />
      <rect x="13" y="11" width="22" height="27" rx="3" fill="#fff" />
      <path d="M17 19h14M17 24h10" stroke="#a5dcbc" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18 31l3 3 7-7" stroke="#1f8a52" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
