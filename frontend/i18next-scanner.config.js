/**
 * i18next-scanner.config.js
 * Configuration for i18next-scanner to extract and validate translation keys.
 *
 * Usage: npx i18next-scanner --config i18next-scanner.config.js
 *
 * In CI, this runs as "npm run i18n:check" to ensure all translation keys
 * used in the codebase have corresponding entries in the locale files.
 */
module.exports = {
  input: [
    "pages/**/*.{js,jsx,ts,tsx}",
    "components/**/*.{js,jsx,ts,tsx}",
    "lib/**/*.{js,jsx,ts,tsx}",
  ],
  output: "./",
  options: {
    debug: false,
    removeUnusedKeys: false,
    sort: true,
    func: {
      list: ["t", "i18next.t"],
      extensions: [".js", ".jsx", ".ts", ".tsx"],
    },
    lngs: ["en", "es", "fr"],
    ns: ["common"],
    defaultLng: "en",
    defaultNs: "common",
    defaultValue: "__MISSING_TRANSLATION__",
    resource: {
      loadPath: "public/locales/{{lng}}/{{ns}}.json",
      savePath: "public/locales/{{lng}}/{{ns}}.json",
      jsonIndent: 2,
      lineEnding: "\n",
    },
    nsSeparator: ":",
    keySeparator: ".",
    interpolation: {
      prefix: "{{",
      suffix: "}}",
    },
    metadata: {},
    allowDynamicKeys: true,
  },
};
