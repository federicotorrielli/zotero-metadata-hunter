import { execSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
} from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { renderTemplate } from "./templates.mjs";
import compressing from "compressing";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.resolve(__dirname, "..");
const buildPath = path.join(rootPath, "build");
const addonPath = path.join(buildPath, "addon");
const require = createRequire(import.meta.url);
const pkg = require(path.join(rootPath, "package.json"));

function copyFolder(src, dest) {
  const exists = existsSync(src);
  const stats = exists && statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    mkdirSync(dest, { recursive: true });
    readdirSync(src).forEach((childItemName) => {
      copyFolder(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    copyFileSync(src, dest);
  }
}

export async function build() {
  console.log(`Building version ${pkg.version}`);

  if (existsSync(buildPath)) {
    execSync(`rm -rf ${buildPath}`);
  }

  mkdirSync(addonPath, { recursive: true });

  copyFolder(path.join(rootPath, "addon"), addonPath);

  const values = {
    version: pkg.version,
    author: pkg.author.name || pkg.author,
    description: pkg.description,
    homepage: pkg.homepage,
    addonName: pkg.config.addonName,
    addonRef: pkg.config.addonRef,
  };
  for (const file of globSync("**/*.*", { cwd: addonPath })) {
    renderTemplate(path.join(addonPath, file), values, {
      readFileSync,
      writeFileSync,
    });
  }

  mkdirSync(path.join(addonPath, "content", "scripts"), { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(rootPath, "src", "index.ts")],
    bundle: true,
    format: "iife",
    target: "firefox128",
    outfile: path.join(addonPath, "content", "scripts", "index.js"),
  });

  if (process.env.NODE_ENV === "production") {
    console.log("Creating XPI file...");
    const xpiPath = path.join(
      buildPath,
      `${pkg.config.addonID}-${pkg.version}.xpi`,
    );
    await compressing.zip.compressDir(addonPath, xpiPath, {
      ignoreBase: true,
    });
    console.log(`XPI file created: ${xpiPath}`);
  }
}
