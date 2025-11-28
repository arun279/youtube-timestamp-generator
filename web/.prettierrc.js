module.exports = {
  printWidth: 100,
  tabWidth: 2,
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  endOfLine: 'lf',
  plugins: ['@ianvs/prettier-plugin-sort-imports', 'prettier-plugin-tailwindcss'],
  // Import sorting configuration
  importOrder: [
    '^(react|next)(.*)$', // React/Next.js first
    '<THIRD_PARTY_MODULES>', // External packages
    '',
    '^@/(.*)$', // Internal aliases (@/components, @/lib, etc.)
    '',
    '^[./]', // Relative imports
  ],
  importOrderParserPlugins: ['typescript', 'jsx', 'decorators-legacy'],
  importOrderTypeScriptVersion: '5.0.0',
};
