import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ink scale — base background → surfaces → hover
        ink: {
          DEFAULT: "#07100E",
          50: "#142824", // hover surface
          100: "#0F201C", // panel header / nested
          200: "#0B1715", // card / panel base
        },
        // Paper / foreground text
        paper: {
          DEFAULT: "#F2EFE6",
          2: "#9AA6A2",
          3: "#5E6B68",
        },
        // Accent
        teal: {
          DEFAULT: "#00E5C3",
          dim: "rgba(0,229,195,0.13)",
        },
        // Lines / borders
        line: {
          DEFAULT: "rgba(242,239,230,0.07)",
          2: "rgba(242,239,230,0.12)",
        },
        // States
        warn: {
          DEFAULT: "#F2C14E",
          dim: "rgba(242,193,78,0.10)",
        },
        neg: {
          DEFAULT: "#E26D6D",
          dim: "rgba(226,109,109,0.10)",
        },
        info: {
          DEFAULT: "#A18EE8",
          dim: "rgba(161,142,232,0.10)",
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"DM Serif Display"', "ui-serif", "Georgia", "serif"],
        mono: ['"DM Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        // Tighter scale for operator-density UI
        "2xs": ["10px", "1.3"],
        xs: ["11px", "1.4"],
        sm: ["12px", "1.45"],
        base: ["13px", "1.45"],
        lg: ["15px", "1.4"],
        xl: ["18px", "1.3"],
        "2xl": ["22px", "1.2"],
        "3xl": ["28px", "1.15"],
        "4xl": ["36px", "1.1"],
      },
      letterSpacing: {
        cap: "0.08em",
        wide: "0.12em",
      },
      boxShadow: {
        "teal-glow": "0 0 6px rgba(0,229,195,0.8)",
      },
      animation: {
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
