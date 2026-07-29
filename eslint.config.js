import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const commonRules = {
  "no-console": "off",
  "no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      caughtErrors: "none",
      varsIgnorePattern: "^_",
    },
  ],
};

export default [
  {
    ignores: [
      "backups/**",
      "csv/**",
      "data/**",
      "dist/**",
      "miniprogram/**",
      "node_modules/**",
      "outputs/**",
      "public/**",
      "recovery/**",
      "scripts/codex-fill-*.mjs",
      "scripts/fill-*.mjs",
      "scripts/repair-*.mjs",
      "scripts/rewrite-*.mjs",
      "scripts/supabase-*.mjs",
      "scripts/verify-paintings-*.mjs",
      "test-results/**",
      "tmp/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["src/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: commonRules,
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...commonRules,
      "no-unused-vars": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
    },
  },
  {
    files: ["*.config.{js,ts}", "tests/**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: commonRules,
  },
  {
    files: ["miniapp/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.commonjs,
        App: "readonly",
        Behavior: "readonly",
        Component: "readonly",
        Page: "readonly",
        console: "readonly",
        getApp: "readonly",
        getCurrentPages: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        wx: "readonly",
      },
    },
    rules: {
      ...commonRules,
      "no-control-regex": "off",
    },
  },
  {
    files: ["miniapp/cloudfunctions/**/*.js", "miniapp/**/*.test.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: commonRules,
  },
  {
    files: ["src/app.js"],
    rules: {
      "no-unused-vars": "off",
    },
  },
  {
    files: ["scripts/data-governance/smoke-wechat-devtools-recommendation-v1.mjs"],
    languageOptions: {
      globals: {
        wx: "readonly",
      },
    },
  },
];
