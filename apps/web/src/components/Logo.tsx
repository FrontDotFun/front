import { type FC } from 'react';

/**
 * The FRONT mark — a phosphor cursor block with the F knocked out.
 * Pure SVG, tinted by the active theme via var(--primary), so the
 * brand degausses with the rest of the tube.
 */
export const Logo: FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    aria-label="FRONT"
    style={{ display: 'block', filter: 'drop-shadow(0 0 6px rgba(var(--primary-rgb), 0.6))' }}
  >
    <defs>
      <pattern id="front-scan" width="4" height="18" patternUnits="userSpaceOnUse">
        <rect width="4" height="6" fill="rgba(0,0,0,0.14)" />
      </pattern>
    </defs>
    <rect x="72" y="72" width="368" height="368" fill="var(--primary, #ffb300)" />
    <rect x="72" y="72" width="368" height="368" fill="url(#front-scan)" />
    <g fill="var(--bg-0, #060605)">
      <rect x="196" y="160" width="52" height="192" />
      <rect x="196" y="160" width="136" height="46" />
      <rect x="196" y="256" width="108" height="42" />
    </g>
  </svg>
);
