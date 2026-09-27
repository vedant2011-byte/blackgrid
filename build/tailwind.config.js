/** BLACKGRID — Tailwind config.
 *  Mirrors the previous `tailwind.config` that was set inline for cdn.tailwindcss.com
 *  so the compiled stylesheet is visually identical to the old runtime-JIT output. */
module.exports = {
  content: ['../index.html', '../assets/app.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter Tight', 'sans-serif'] },
      colors: { 'brand-bg': '#122e58' },
    },
  },
  plugins: [],
};
