/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './content/**/*.{html,md}',
    './layouts/**/*.html',
  ],
  safelist: process.env.NODE_ENV === 'development' ? [
    { pattern: /^(w|h|p)-/ },
  ] : [],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
