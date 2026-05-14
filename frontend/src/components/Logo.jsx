/**
 * AI Code Reviewer Logo
 * 盾牌 + 代码符号 + AI 星标
 */
export default function Logo({ size = 28, className = '' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      width={size}
      height={size}
      className={className}
    >
      {/* 盾牌外形 */}
      <path
        d="M16 2L4 7v9c0 7.73 5.12 14.48 12 16 6.88-1.52 12-8.27 12-16V7L16 2z"
        fill="currentColor"
        opacity="0.12"
      />
      <path
        d="M16 2L4 7v9c0 7.73 5.12 14.48 12 16 6.88-1.52 12-8.27 12-16V7L16 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      {/* 代码符号 </> */}
      <path
        d="M12 13l-3 3 3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 13l3 3-3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 11l-2 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* AI 星标 */}
      <circle cx="24" cy="8" r="2" fill="currentColor" />
      <path
        d="M24 6v4M22 8h4"
        stroke="white"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
