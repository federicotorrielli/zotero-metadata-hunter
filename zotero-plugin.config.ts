import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
 name: pkg.config.addonName,
 id: pkg.config.addonID,
 namespace: pkg.config.addonRef,
 
 build: {
   assets: "addon/**/*",
   esbuildOptions: [
     {
       entryPoints: ["src/index.ts"],
       bundle: true,
       format: "iife",
       target: "firefox128",
       outfile: "addon/content/scripts/index.js",
     },
   ],
 },
});

// Working version - DOI and Abstract Finder functional
