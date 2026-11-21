import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs. The previous FlatCompat
// wrapper crashes on load ("Converting circular structure to JSON").
const eslintConfig = [...nextVitals, ...nextTs];

export default eslintConfig;
