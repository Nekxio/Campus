import type { PageServerLoad } from './$types';
import { authConfigurationReady } from '#lib/server/auth/runtime.js';
import { redirectSignedInTeacher } from '#lib/server/auth/page-access.js';

export const load: PageServerLoad = ({ locals }) => {
	redirectSignedInTeacher(locals);
	return {
		authReady: authConfigurationReady(),
		serviceUnavailable: locals.authUnavailable ?? false
	};
};
