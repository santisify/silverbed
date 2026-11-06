/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        "paper-2": "var(--paper-2)",
        "paper-3": "var(--paper-3)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        rule: "var(--rule)",
        "rule-strong": "var(--rule-strong)",
        safelight: "var(--safelight)",
        "safelight-soft": "var(--safelight-soft)",
        kept: "var(--kept)",
        mark: "var(--mark)",
      },
      fontFamily: {
        ui: ['"Archivo Variable"', "Archivo", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1.15", letterSpacing: "0.02em" }],
        meta: ["0.75rem", { lineHeight: "1.25" }],
        label: ["0.8125rem", { lineHeight: "1.35" }],
        body: ["0.9375rem", { lineHeight: "1.55" }],
        lead: ["1.0625rem", { lineHeight: "1.5" }],
        title: ["1.375rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
        display: ["2rem", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        poster: ["clamp(2.5rem, 6vw, 4.25rem)", { lineHeight: "0.98", letterSpacing: "-0.03em" }],
      },
      borderRadius: { none: "0", frame: "2px" },
      boxShadow: { frame: "0 0 0 1px var(--rule)" },
    },
  },
  plugins: [],
};
