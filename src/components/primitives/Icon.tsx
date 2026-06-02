import type { SVGProps } from "react";

/**
 * Single SVG icon library — keeps the bundle lean (no lucide/heroicons dep).
 * Add a new icon by adding a name to the union + a case in `paths`.
 *
 * All icons designed on a 24x24 grid with stroke-based rendering.
 */

export type IconName =
  // nav
  | "home"
  | "board"
  | "chat"
  | "campaign"
  | "users"
  | "library"
  | "ops"
  | "money"
  // controls
  | "search"
  | "bell"
  | "plus"
  | "settings"
  | "filter"
  | "more"
  | "x"
  | "check"
  | "arrow-right"
  | "arrow-left"
  | "chevron-down"
  | "chevron-right"
  // triage kinds
  | "reply-arrow"
  | "alert-circle"
  | "check-square"
  | "clock"
  | "warning"
  // misc
  | "external"
  | "download"
  | "send"
  | "paperclip"
  | "phone"
  | "mail"
  | "calendar"
  | "tag"
  | "trending-up"
  | "trending-down"
  | "circle";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, JSX.Element> = {
  // nav
  home: (
    <>
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="5" width="4" height="14" rx="1" />
      <rect x="10" y="9" width="4" height="10" rx="1" />
      <rect x="17" y="13" width="4" height="6" rx="1" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 1 1-3.2-6.4L21 4l-1.4 3.4A8 8 0 0 1 21 12z" />,
  campaign: (
    <>
      <path d="M4 14V8a3 3 0 0 1 3-3h7l6 4v6l-6 4H7a3 3 0 0 1-3-3z" />
      <path d="M14 5v14" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M21 18c0-2.2-1.8-4-4-4" />
    </>
  ),
  library: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 14h4" />
    </>
  ),
  ops: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  money: (
    <>
      <path d="M3 12h18M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),

  // controls
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v6M12 17v6M4.2 4.2l4.3 4.3M15.5 15.5l4.3 4.3M1 12h6M17 12h6M4.2 19.8l4.3-4.3M15.5 8.5l4.3-4.3" />
    </>
  ),
  filter: <path d="M3 6h18M6 12h12M10 18h4" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  x: <path d="M18 6L6 18M6 6l12 12" />,
  check: <path d="M20 6L9 17l-5-5" />,
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  "arrow-left": <path d="M19 12H5M11 6l-6 6 6 6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,

  // triage kinds
  "reply-arrow": <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v2" />,
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  "check-square": (
    <>
      <path d="M9 11l3 3 8-8" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),

  // misc
  external: (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6M10 14L21 3" />
    </>
  ),
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  paperclip: (
    <path d="M21.4 11l-9.2 9.2a6 6 0 0 1-8.5-8.5L13 2.5a4 4 0 0 1 5.7 5.7L9.4 17.5a2 2 0 0 1-2.8-2.8L15 6.3" />
  ),
  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 3a2 2 0 0 1-.5 2.1L8 10.1a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c1 .3 2 .6 3 .7a2 2 0 0 1 1.7 2z" />
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  tag: (
    <>
      <path d="M20.6 13.4L12 22l-9-9V3h10l8.6 8.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="0.5" />
    </>
  ),
  "trending-up": <path d="M23 6l-9.5 9.5-5-5L1 18M17 6h6v6" />,
  "trending-down": <path d="M23 18l-9.5-9.5-5 5L1 6M17 18h6v-6" />,
  circle: <circle cx="12" cy="12" r="10" />,
};

export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
