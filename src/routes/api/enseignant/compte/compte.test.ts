import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('#lib/server/auth/runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from '#lib/server/auth/runtime.js';
import { POST } from './+server.js';
import { actions, load } from '../../../enseignant/compte/+page.server.js';

const origin = 'https://campus.example';
const user = { id: 'teacher', name: 'Léo Hilaire', email: 'leo@example.test', role: 'teacher' };
const updateUser = vi.fn();

function event(
	value: unknown = { name: 'Léo Hilaire' },
	options: {
		authenticated?: boolean;
		origin?: string;
		fetchSite?: string;
		contentType?: string;
	} = {}
) {
	const request = new Request(origin + '/api/enseignant/compte', {
		method: 'POST',
		headers: {
			origin: options.origin ?? origin,
			'Sec-Fetch-Site': options.fetchSite ?? 'same-origin',
			'Content-Type': options.contentType ?? 'application/json',
			cookie: 'coursely.session_token=fictional'
		},
		body: JSON.stringify(value)
	});
	return {
		request,
		url: new URL(request.url),
		locals:
			options.authenticated === false
				? { user: null, session: null }
				: {
						user,
						session: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) }
					}
	} as unknown as RequestEvent;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(withAuth).mockImplementation(async (operation) =>
		operation({ api: { updateUser } } as never, {} as never, origin)
	);
});

describe('teacher account', () => {
	it('saves a native profile command and refreshes the same-request display name', async () => {
		const body = new FormData();
		body.set('name', '  Fictional teacher  ');
		const request = new Request(origin + '/enseignant/compte?/updateProfile', {
			method: 'POST',
			body,
			headers: { origin, cookie: 'coursely.session_token=fictional' }
		});
		const incoming = { ...event(), request, url: new URL(request.url) };
		incoming.locals.user = { ...user } as typeof incoming.locals.user;
		expect(await actions.updateProfile(incoming as never)).toMatchObject({ receipt: { name: 'Fictional teacher' } });
		expect(await load(incoming as never)).toEqual({ name: 'Fictional teacher', email: user.email });
	});
	it('keeps the page private and exposes only profile display fields', async () => {
		await expect(
			Promise.resolve().then(() => load(event({}, { authenticated: false }) as never))
		).rejects.toMatchObject({ status: 303, location: '/connexion' });
		expect(await load(event() as never)).toEqual({ name: user.name, email: user.email });
	});

	it('authorizes before decoding and rejects cross-site or form writes', async () => {
		expect((await POST(event({}, { authenticated: false }) as never)).status).toBe(401);
		expect((await POST(event({}, { origin: 'https://other.example' }) as never)).status).toBe(403);
		expect((await POST(event({}, { origin: 'null', fetchSite: 'cross-site' }) as never)).status).toBe(403);
		expect((await POST(event({}, { fetchSite: 'cross-site' }) as never)).status).toBe(403);
		expect((await POST(event({}, { contentType: 'text/plain' }) as never)).status).toBe(415);
		expect(withAuth).not.toHaveBeenCalled();
	});

	it('rejects invalid names and extra identity fields', async () => {
		const blank = await POST(event({ name: '   ' }) as never);
		expect(blank.status).toBe(422);
		expect(await blank.json()).toEqual({ fieldError: 'Indiquez votre nom et prénom.' });
		expect((await POST(event({ name: 'Valid', email: 'other@example.test' }) as never)).status).toBe(422);
		expect(withAuth).not.toHaveBeenCalled();
	});

	it('bounds the request body before updating the account', async () => {
		const response = await POST(event({ name: 'A'.repeat(1500) }) as never);
		expect(response.status).toBe(413);
		expect(withAuth).not.toHaveBeenCalled();
	});

	it('accepts the browser null origin only with same-origin fetch metadata', async () => {
		const response = await POST(event({ name: '  Léo Nouveau  ' }, { origin: 'null' }) as never);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ name: 'Léo Nouveau' });
		expect(updateUser).toHaveBeenCalledWith({
			body: { name: 'Léo Nouveau' },
			headers: expect.any(Headers)
		});
		expect(updateUser.mock.calls[0][0].headers.get('origin')).toBe(origin);
	});

	it('reports an unavailable save without echoing private data', async () => {
		updateUser.mockRejectedValueOnce(new Error('unavailable'));
		const response = await POST(event({ name: 'Nom conservé' }) as never);
		expect(response.status).toBe(503);
		expect(await response.json()).toHaveProperty('message');
	});
});
