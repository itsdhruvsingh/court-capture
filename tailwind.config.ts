import type { Config } from "tailwindcss";

/**
 * Every colour reads a theme token (an "R G B" triplet in globals.css), so
 * opacity modifiers work (bg-accent/12) and light/dark is one attribute flip.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Satoshi", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        accent: "rgb(var(--accent) / <alpha-value>)",
        accentInk: "rgb(var(--accent-ink) / <alpha-value>)",
        accentHover: "rgb(var(--accent-hover) / <alpha-value>)",
        accentActive: "rgb(var(--accent-active) / <alpha-value>)",
        accentSoft: "rgb(var(--accent-soft) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        dangerSoft: "rgb(var(--danger-soft) / <alpha-value>)",
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        overlay: "rgb(var(--overlay) / <alpha-value>)",
        foreground: "rgb(var(--text) / <alpha-value>)",
        dim: "rgb(var(--dim) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        hairline: "var(--hairline)",
        hairlineStrong: "var(--hairline-strong)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        tint: "rgb(var(--tint-1) / var(--tint-1-a))",
        tint2: "rgb(var(--tint-1) / var(--tint-2-a))",
        tint3: "rgb(var(--tint-1) / var(--tint-3-a))",
        sunken: "rgb(var(--sunken) / var(--sunken-a))",
        scrim: "rgb(var(--scrim) / var(--scrim-a))",
      },
    },
  },
  plugins: [],
};

export default config;
