/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                surface: Object.fromEntries([50,100,200,300,400,500,600,700,800,850,900,950].map((n) => [n, `rgb(var(--surface-${n}) / <alpha-value>)`])),
                accent: Object.fromEntries([50,100,200,300,400,500,600,700,800,900].map((n) => [n, `rgb(var(--accent-${n}) / <alpha-value>)`])),
                success: {
                    400: "rgb(var(--status-success) / <alpha-value>)",
                    500: "#22c55e",
                    600: "#16a34a",
                },
                warning: {
                    400: "rgb(var(--status-warning) / <alpha-value>)",
                    500: "#eab308",
                    600: "#ca8a04",
                },
                danger: {
                    400: "rgb(var(--status-danger) / <alpha-value>)",
                    500: "#ef4444",
                    600: "#dc2626",
                },
            },
            fontFamily: {
                sans: [
                    "-apple-system",
                    "BlinkMacSystemFont",
                    "system-ui",
                    "sans-serif",
                ],
                mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
            },
            animation: {
                "fade-in": "fadeIn 0.3s ease-out",
                "slide-up": "slideUp 0.3s ease-out",
                "slide-down": "slideDown 0.3s ease-out",
                "slide-right": "slideRight 0.3s ease-out",
                pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                shimmer: "shimmer 2s linear infinite",
                "spin-slow": "spin 3s linear infinite",
            },
            keyframes: {
                fadeIn: {
                    "0%": { opacity: "0" },
                    "100%": { opacity: "1" },
                },
                slideUp: {
                    "0%": { opacity: "0", transform: "translateY(10px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" },
                },
                slideDown: {
                    "0%": { opacity: "0", transform: "translateY(-10px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" },
                },
                slideRight: {
                    "0%": { opacity: "0", transform: "translateX(-10px)" },
                    "100%": { opacity: "1", transform: "translateX(0)" },
                },
                shimmer: {
                    "0%": { backgroundPosition: "-200% 0" },
                    "100%": { backgroundPosition: "200% 0" },
                },
            },
            backdropBlur: {
                xs: "2px",
            },
        },
    },
    plugins: [],
};
