/**
 * Small line icons drawn as inline SVG (no emoji, no icon font).
 * All are decorative: aria-hidden, with the meaning carried by adjacent text.
 */
import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const icons = {
  plug: (
    <Icon>
      <path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0V8zM12 17v5" />
    </Icon>
  ),
  layers: (
    <Icon>
      <path d="M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 18l10 5 10-5" />
    </Icon>
  ),
  eye: (
    <Icon>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ),
  list: (
    <Icon>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Icon>
  ),
  shield: (
    <Icon>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  ),
  refresh: (
    <Icon>
      <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M21 4v5h-5M3 20v-5h5" />
    </Icon>
  ),
  truck: (
    <Icon>
      <path d="M2 6h12v10H2zM14 10h4l4 4v2h-8z" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </Icon>
  ),
  tag: (
    <Icon>
      <path d="M20 12 12 20 3 11V3h8l9 9z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </Icon>
  ),
  broom: (
    <Icon>
      <path d="M14 3 9 12M5 13h10l2 8H3l2-8zM8 17v4M12 17v4" />
    </Icon>
  ),
  pen: (
    <Icon>
      <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
    </Icon>
  ),
  type: (
    <Icon>
      <path d="M4 7V5h16v2M9 19h6M12 5v14" />
    </Icon>
  ),
  search: (
    <Icon>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </Icon>
  ),
  calculator: (
    <Icon>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h8" />
    </Icon>
  ),
  image: (
    <Icon>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5L5 20" />
    </Icon>
  ),
  message: (
    <Icon>
      <path d="M4 5h16v11H8l-4 4V5z" />
    </Icon>
  ),
  clipboard: (
    <Icon>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4h6v3H9zM9 12l2 2 4-4" />
    </Icon>
  ),
  chat: (
    <Icon>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </Icon>
  ),
  check: (
    <Icon width="20" height="20">
      <path d="m5 12 5 5 9-10" />
    </Icon>
  ),
  menu: (
    <Icon>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  ),
  close: (
    <Icon>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  ),
};

export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" className={className}>
      <rect width="28" height="28" rx="6" fill="#0B6B45" />
      <path d="M7 19 12 10l4 6 2-3 3 6" fill="none" stroke="#F2B33D" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
