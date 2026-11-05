/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        aem: {
          blue: "#3D8BCD",
          "blue-light": "#5BA4E5",
          "blue-dark": "#2B6CA8",
          "blue-tint": "#EBF4FC",
          coral: "#D94E28",
          "coral-tint": "#FDF0EC",
          gold: "#EAB308",
          canvas: "#F4F7FB",
        },
      },
      fontFamily: {
        sans: [
          "Plus Jakarta Sans",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
