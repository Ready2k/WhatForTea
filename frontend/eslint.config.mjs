import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Dynamic API responses and catch clauses legitimately need `any`; track as warnings.
      "@typescript-eslint/no-explicit-any": "warn",
      // Recipe images are served from an external NAS path; next/image doesn't support arbitrary origins.
      "@next/next/no-img-element": "warn",
    },
  },
];

export default eslintConfig;
