import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const generateIdentity = async () => {
	const css = await readFile(new URL('../src/routes/layout.css', import.meta.url), 'utf8');
	const tokens = css.match(/:root\s*\{[\s\S]*?\n\}/)?.[0];
	if (!tokens) throw new Error('The Campus color tokens are missing.');
	const iconSource = new URL('../src/lib/assets/favicon.svg', import.meta.url);
	const iconColors = ['--primary', '--primary-foreground'].map((name) => {
		const value = tokens.match(new RegExp(`${name}: ([^;]+);`))?.[1];
		if (!value) throw new Error(`The ${name} identity token is missing.`);
		return `${name}: ${value};`;
	});
	const svg = (await readFile(iconSource, 'utf8')).replace(/:root\s*\{[^}]*\}/, `:root { ${iconColors.join(' ')} }`);
	await writeFile(iconSource, svg);
	const font = await readFile(require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'));
	const iconDirectory = new URL('../static/icons/', import.meta.url);
	await mkdir(iconDirectory, { recursive: true });
	const browser = await chromium.launch({ channel: 'chrome' });
	try {
		const page = await browser.newPage({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 1 });
		await page.route('**/*', (route) => route.abort());
		await page.setContent(
			`<style>body { margin: 0; } svg { display: block; width: 100vw; height: 100vh; }</style>${svg}`
		);
		const smallIcons: Buffer[] = [];
		for (const size of [16, 32, 48, 180, 192, 512]) {
			await page.setViewportSize({ width: size, height: size });
			const png = await page.screenshot({
				path: new URL(`campus-${size}.png`, iconDirectory).pathname,
				omitBackground: true
			});
			if (size <= 48) smallIcons.push(png);
		}
		const header = Buffer.alloc(6 + smallIcons.length * 16);
		header.writeUInt16LE(1, 2);
		header.writeUInt16LE(smallIcons.length, 4);
		let offset = header.length;
		for (const [index, png] of smallIcons.entries()) {
			const entry = 6 + index * 16;
			header[entry] = header[entry + 1] = [16, 32, 48][index];
			header.writeUInt16LE(1, entry + 4);
			header.writeUInt16LE(32, entry + 6);
			header.writeUInt32LE(png.length, entry + 8);
			header.writeUInt32LE(offset, entry + 12);
			offset += png.length;
		}
		await writeFile(new URL('../static/favicon.ico', import.meta.url), Buffer.concat([header, ...smallIcons]));
		await page.setViewportSize({ width: 1200, height: 630 });
		await page.setContent(`<style>
			${tokens}
			@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font.toString('base64')}); font-weight: 100 900; }
			* { box-sizing: border-box; } body { margin: 0; background: var(--background); color: var(--foreground); font-family: Inter, sans-serif; }
			main { height: 630px; padding: 80px 96px; display: flex; flex-direction: column; justify-content: space-between; }
			header { display: flex; align-items: center; gap: 24px; color: var(--primary); font-size: 56px; font-weight: 600; letter-spacing: -0.025em; }
			svg { width: 64px; height: 64px; } p { margin: 0; font-size: 56px; line-height: 1.25; letter-spacing: -0.025em; font-weight: 400; }
		</style><main><header>${svg}<span>Campus</span></header><p>Préparer, évaluer,<br>partager les cours.</p></main>`);
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({ path: new URL('../static/campus-og.png', import.meta.url).pathname });
		console.log('Generated Campus icons and the 1200 × 630 sharing image.');
	} finally {
		await browser.close();
	}
};

await generateIdentity();
