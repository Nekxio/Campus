import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { teacherFormAction } from './form-actions.js';

const origin = 'https://campus.example.test';
const event = (body: FormData | string, authenticated = true, headers: HeadersInit = {}) => {
	const request = new Request(origin + '/enseignant/compte?/updateProfile', {
		method: 'POST',
		body,
		headers: { origin, ...headers }
	});
	return {
		request,
		url: new URL(request.url),
		params: {},
		locals: authenticated
			? {
					user: { id: 'teacher', role: 'teacher' },
					session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) }
				}
			: { user: null, session: null }
	} as unknown as RequestEvent;
};
const nativeData = (name = 'Fictional teacher') => {
	const data = new FormData();
	data.set('name', name);
	return data;
};
describe('teacher form actions', () => {
	it('authenticates before consuming malformed input', async () => {
		const operation = vi.fn();
		const incoming = event('broken', false);
		const parse = vi.spyOn(incoming.request, 'formData');
		const result = await teacherFormAction(z.strictObject({ name: z.string() }), operation, { native: true })(incoming);
		expect(result).toMatchObject({ status: 401 });
		expect(parse).not.toHaveBeenCalled();
		expect(operation).not.toHaveBeenCalled();
	});
	it('validates native input and returns a confirmed receipt', async () => {
		const action = teacherFormAction(z.strictObject({ name: z.string().trim().min(1) }), async (input) => input, {
			native: true
		});
		expect(await action(event(nativeData('  Teacher  ')))).toMatchObject({
			receipt: { name: 'Teacher' },
			form: { valid: true }
		});
		expect(await action(event(nativeData(' ')))).toMatchObject({ status: 422 });
	});
	it('rejects duplicated scalars, unknown keys and files', async () => {
		const operation = vi.fn();
		const action = teacherFormAction(z.strictObject({ name: z.string() }), operation, { native: true });
		for (const extra of ['name', 'role', '__superform_unknown']) {
			const data = nativeData();
			data.append(extra, 'unexpected');
			expect(await action(event(data))).toMatchObject({ status: 400 });
		}
		const data = nativeData();
		data.set('name', new File(['private'], 'name.txt'));
		expect(await action(event(data))).toMatchObject({ status: 400 });
		expect(operation).not.toHaveBeenCalled();
	});
	it('rejects permissive boolean coercion while accepting repeated array fields', async () => {
		const action = teacherFormAction(
			z.strictObject({ accept: z.boolean(), scopes: z.array(z.string()) }),
			async (input) => input,
			{ native: true }
		);
		const data = new FormData();
		data.set('accept', 'nonsense');
		data.append('scopes', 'modules:read');
		expect(await action(event(data))).toMatchObject({ status: 400 });
		data.set('accept', 'false');
		data.append('scopes', 'modules:create');
		expect(await action(event(data))).toMatchObject({
			receipt: { accept: false, scopes: ['modules:read', 'modules:create'] }
		});
	});
	it('accepts strict structured commands but rejects malformed JSON fallback', async () => {
		const action = teacherFormAction(z.strictObject({ name: z.string() }), async (input) => input);
		const data = new FormData();
		data.set('__superform_json', '[{"name":1},"Teacher"]');
		expect(await action(event(data))).toMatchObject({ receipt: { name: 'Teacher' } });
		data.set('__superform_json', 'broken');
		data.set('name', 'fallback');
		expect(await action(event(data))).toMatchObject({ status: 400 });
	});
	it('enforces streamed limits and same-origin boundaries', async () => {
		const action = teacherFormAction(z.strictObject({ name: z.string() }), async (input) => input, {
			native: true,
			maxBytes: 1024
		});
		expect(await action(event(nativeData('x'.repeat(1200))))).toMatchObject({ status: 413 });
		expect(await action(event(nativeData(), true, { origin: 'https://other.test' }))).toMatchObject({ status: 403 });
		expect(
			await action(
				event(nativeData(), true, {
					origin: 'null',
					'sec-fetch-site': 'same-origin',
					'sec-fetch-mode': 'navigate',
					'sec-fetch-dest': 'document'
				})
			)
		).toHaveProperty('receipt');
	});
});
