import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

// Use the exact runtime and bundler shipped with the project's installed Wrangler.
const require = createRequire(import.meta.url);
const wrangler = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare');
const { build } = wrangler('esbuild');
const feed = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'BEGIN:VEVENT',
	'UID:fictional-lesson',
	'SUMMARY:Demonstration course',
	'DTSTART:20261102T080000Z',
	'DTEND:20261102T100000Z',
	'END:VEVENT',
	'END:VCALENDAR'
].join('\r\n');

test('Worker downloads a calendar and refuses every redirect without contacting its destination', async () => {
	const bundled = await build({
		stdin: {
			contents: `
import { fetchCalendarFeed } from './src/lib/server/calendar/feed.ts';
export default {
	async fetch(request) {
		const scenario = new URL(request.url).pathname.slice(1);
		const source = new URL('https://fictional.pronote-campus.net/hp/Telechargements/ical/teacher.ics?icalsecurise=fictional');
		source.searchParams.set('scenario', scenario);
		try {
			return Response.json(await fetchCalendarFeed(source.toString(), new Date('2026-10-31T12:00:00Z')));
		} catch (cause) {
			return Response.json({ message: cause.message }, { status: 422 });
		}
	}
};`,
			resolveDir: process.cwd()
		},
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser'
	});
	const requests = [];
	const runtime = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			compatibilityDate: '2026-10-11',
			cf: false,
			script: bundled.outputFiles[0].text,
			outboundService: (request) => {
				const url = new URL(request.url);
				requests.push(url.hostname);
				assert.equal(url.hostname, 'fictional.pronote-campus.net');
				const status = Number(url.searchParams.get('scenario'));
				if (status)
					return new Response(null, {
						status,
						headers: { location: 'https://never-contact.invalid/private' }
					});
				return new Response(feed, { headers: { 'content-type': 'text/calendar' } });
			}
		})
	);
	try {
		const response = await runtime.dispatchFetch('http://localhost/success');
		assert.equal(response.status, 200, await response.clone().text());
		const lessons = await response.json();
		assert.equal(lessons.length, 1);
		assert.equal(lessons[0].startsAt, '2026-11-02T08:00:00.000Z');
		for (const status of [301, 302, 303, 307, 308]) {
			const response = await runtime.dispatchFetch(`http://localhost/${status}`);
			assert.equal(response.status, 422);
			const { message } = await response.json();
			assert.match(message, /redirige/);
			assert.doesNotMatch(message, /icalsecurise|never-contact/);
		}
		assert.equal(requests.length, 6);
	} finally {
		await runtime.dispose();
	}
});
