/***********************************************
 * Tailwind CSS Configuration for Artisan Shelf *
 ***********************************************/
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx,jsx,js}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f8ff',
          100: '#e6effe',
          200: '#cddffd',
          300: '#a8c6fb',
          400: '#7ea6f7',
          500: '#5b86ef',
          600: '#476be3',
          700: '#3a56cc',
          800: '#3346a6',
          900: '#2d3b85',
        },
      },
    },
  },
  plugins: [],
}