import type { AuthSession } from '#lib/server/auth.js';
import type { ServerTiming } from '#lib/server/server-timing.js';

declare global {
	namespace App {
		interface PageState {
			createdModuleId?: string;
		}
		interface Locals {
			serverTiming?: ServerTiming;
			user: AuthSession['user'] | null;
			session: AuthSession['session'] | null;
			authUnavailable?: boolean;
			publicClassId?: string | null;
		}
		interface Error {
			publicClassId?: string | null;
		}
	}
}

export {};
