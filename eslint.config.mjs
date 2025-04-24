import { defineConfig } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([{
    extends: compat.extends("athom"),

    rules: {
        "node/no-extraneous-require": "off",
        indent: "off",
        "brace-style": "off",
        "function-paren-newline": ["error", "consistent"],
        "linebreak-style": ["error", "windows"],

        "no-tabs": ["error", {
            allowIndentationTabs: true,
        }],

        "object-curly-newline": ["error", {
            consistent: true,
        }],

        "max-len": ["error", {
            code: 300,
        }],
    },
}]);