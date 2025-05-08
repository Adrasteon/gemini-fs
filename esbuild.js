// c:\Users\marti\gemini-fs\esbuild.js
const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const extensionConfig = {
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'out/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	};

	const webviewConfig = {
		entryPoints: [
			'src/webview/script.js'
		],
		bundle: true,
		format: 'esm',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'out/webview.js',
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	};

	if (watch) {
		const extensionCtx = await esbuild.context(extensionConfig);
		const webviewCtx = await esbuild.context(webviewConfig);

		await extensionCtx.watch();
		await webviewCtx.watch();

		console.log('[watch] Watching for changes in extension and webview source files...');
		// In watch mode, the contexts keep the process alive.
	} else {
		await Promise.all([
			esbuild.build(extensionConfig),
			esbuild.build(webviewConfig)
		]);
		console.log('Build finished for extension and webview.');
		// For non-watch mode, the script will exit after builds complete.
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
