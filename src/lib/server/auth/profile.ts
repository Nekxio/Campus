import type { RequestEvent } from '@sveltejs/kit';
import type { ProfileInput } from '#lib/domain/profile.js';
import { requireTeacher } from './access.js';
import { withAuth } from './runtime.js';

export const updateTeacherProfile = async (input: ProfileInput, event: Pick<RequestEvent, 'locals' | 'request'>) => {
	const teacher = requireTeacher(event.locals);
	await withAuth((auth, _client, trustedOrigin) =>
		auth.api.updateUser({
			body: input,
			headers: new Headers({ cookie: event.request.headers.get('cookie') ?? '', origin: trustedOrigin })
		})
	);
	teacher.name = input.name;
	return { name: input.name };
};
