/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./grading.html", "./index.html", "./assets/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        primary: "#137fec",
        "background-light": "#f6f7f8", "background-dark": "#101922",
        // The following are for compatibility with existing classes, but we will phase them out.
        "surface-light": "#ffffff",
        "surface-dark": "#1f2937",
        "border-light": "#e5e7eb",
        "border-dark": "#374151",
        "text-light": "#111827",
        "text-dark": "#f9fafb",
        "text-muted-light": "#6b7280",
        "text-muted-dark": "#9ca3af",
        "ai-high-confidence": "#34d399",
        "ai-medium-confidence": "#fbbf24", // amber-400
        "ai-low-confidence": "#ef4444", // red-500
        "ai-comment": "#3b82f6", // blue-500
        "ai-high-confidence-status": "#2dd4bf", // teal-400
        "success": "#22c55e",
        "success-dark": "#16a34a",
        "success-light": "#4ade80",
      },
      animation: {
        'pulse-light': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      fontFamily: {
        display: ["Inter", "sans-serif"],
        sans: ["Inter", "sans-serif"], // Changed from Roboto to Inter
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
  ],
}