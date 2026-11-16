import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('teacher and public navigation responses expose bounded timings without changing access or caching', async ({
	page,
	app
}) => {
	await activate(page, app);
	const grading = new URLSearchParams({
		annee: '2026-2027',
		classe: app.ids.currentClass,
		module: app.ids.module,
		contexte: app.ids.currentContext
	});
	const routes = [
		{ path: '/enseignant/vue-etudiante', teacher: true, budget: 7 },
		{
			path: `/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`,
			teacher: true,
			budget: 11
		},
		{ path: `/enseignant/notation?${grading}`, teacher: true },
		{ path: `/modules/${app.ids.publicationContext}`, teacher: false, budget: 8 },
		{ path: `/classes/${app.ids.currentClass}`, teacher: false, budget: 6 }
	];
	for (const route of routes) {
		for (const data of [false, true]) {
			const url = new URL(route.path, app.origin);
			if (data) url.pathname += '/__data.json';
			const response = await page.request.get(url.href);
			expect(response.status(), `Navigation status: teacher=${route.teacher}, data=${data}`).toBe(200);
			const headers = response.headers();
			const timing = headers['server-timing'];
			expect(timing).toBeDefined();
			const entries = new Map(
				timing.split(', ').map((entry) => {
					const match = /^(app|auth|resolve|data|db);dur=(\d+\.\d)(?:;desc="(\d+) calls")?$/.exec(entry);
					expect(match, 'Fixed metric names and numeric durations only').not.toBeNull();
					return [match![1], match!] as const;
				})
			);
			expect([...entries.keys()]).toEqual(expect.arrayContaining(['app', 'resolve', 'data', 'db']));
			expect(entries.has('auth')).toBe(route.teacher);
			const calls = Number(entries.get('db')![3]);
			expect(calls).toBeGreaterThan(0);
			if (route.budget) expect(calls).toBeLessThanOrEqual(route.budget);
			expect(headers['cache-control']).toBe(route.teacher ? 'private, no-store' : 'no-store');
			if (!route.teacher) expect(headers['x-robots-tag']).toBe('noindex, nofollow');
		}
	}
});
