/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './content/**/*.{html,md}',
    './layouts/**/*.html',
  ],
theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
