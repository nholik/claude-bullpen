// Compiles each borrowed npm library into one self-contained ES module under
// src/vendor/, which the mod imports by relative path. A mod (and its tests)
// can import only its own files and "claude-code", so packages are compiled
// in here instead of resolved at run time. Output is committed; versions are
// pinned in package.json. Run after changing a vendored dependency:
//
//   npm run vendor
//
// To borrow something new: add it to package.json "dependencies", add an
// entry below exporting only what we use, write a .d.ts beside the output
// that re-exports the package's types, and run this.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const VENDOR = {
	"wrap-ansi": {
		pkg: "wrap-ansi",
		source: `export { default as wrapAnsi } from "wrap-ansi";`,
	},
	pathe: { pkg: "pathe", source: `export { join } from "pathe";` },
	// Color math (OKLCH mixing) for the floor, glow and morale lighting.
	culori: {
		pkg: "culori",
		source: `export { formatHex, interpolate, modeOklch, modeRgb, useMode } from "culori/fn";`,
	},
	// Display width of text, so CJK and emoji don't break box borders.
	"string-width": {
		pkg: "string-width",
		source: `export { default } from "string-width";`,
	},
	// Schema validation for the journal, the profile file and gh output.
	valibot: {
		pkg: "valibot",
		source: `export {
			array, boolean, fallback, integer, literal, looseObject, minValue,
			nullable, number, object, optional, parse, picklist, pipe, record,
			safeParse, string, union,
		} from "valibot";`,
	},
};

const version = (pkg) =>
	JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, "utf8")).version;

const licenses = [];

for (const [name, { pkg, source }] of Object.entries(VENDOR)) {
	await esbuild.build({
		stdin: { contents: source, resolveDir: ".", loader: "js" },
		outfile: `src/vendor/${name}.js`,
		bundle: true,
		format: "esm",
		platform: "neutral",
		mainFields: ["module", "main"],
		target: "es2023",
		minify: false,
		legalComments: "eof",
		banner: {
			js: `// Vendored from ${pkg}@${version(pkg)} (MIT) by scripts/vendor.mjs. Do not edit; run \`npm run vendor\`.`,
		},
		logLevel: "info",
	});
}

// Every package that ended up in src/vendor/, with its license text.
const meta = await esbuild.build({
	stdin: {
		contents: Object.values(VENDOR)
			.map((v) => v.source)
			.join("\n"),
		resolveDir: ".",
		loader: "js",
	},
	bundle: true,
	write: false,
	metafile: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	logLevel: "silent",
});
const packages = new Set();
for (const input of Object.keys(meta.metafile.inputs)) {
	const match = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
	if (match) packages.add(match[1]);
}
for (const pkg of [...packages].sort()) {
	const dir = `node_modules/${pkg}`;
	const file = ["LICENSE", "license", "LICENSE.md", "license.md"].find((f) =>
		existsSync(`${dir}/${f}`),
	);
	const text = file
		? readFileSync(`${dir}/${file}`, "utf8").trim()
		: "(no license file found)";
	licenses.push(`## ${pkg}@${version(pkg)}\n\n\`\`\`\n${text}\n\`\`\`\n`);
}
writeFileSync(
	"src/vendor/LICENSES.md",
	`# Third-party licenses\n\nCode in this folder is compiled from these packages by scripts/vendor.mjs.\n\n${licenses.join("\n")}`,
);
