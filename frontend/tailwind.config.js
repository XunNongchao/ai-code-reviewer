/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        appleGray: {
          50: '#f5f5f7',
          100: '#e8e8ed',
          800: '#1d1d1f',
          900: '#000000'
        },
        appleBlue: '#0066cc',
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
