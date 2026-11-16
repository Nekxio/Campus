import { toast } from 'svelte-sonner';

export type NotificationKind = 'success' | 'info' | 'warning' | 'error';

/** Keep the toast queue client-only, including when a component is rendered on the server. */
export function notify(
	message: string,
	kind: NotificationKind = 'success',
	id?: string,
	options: { duration?: number } = {}
) {
	if (typeof window === 'undefined' || !message.trim()) return;
	return toast[kind](message, {
		id,
		duration: options.duration ?? (kind === 'error' || kind === 'warning' ? 8000 : 5000)
	});
}

/** Dismiss only the explicit global exception, never the whole action queue. */
export function dismissNotification(id: string) {
	if (typeof window !== 'undefined') toast.dismiss(id);
}

const navigationMessages = {
	'signed-in': 'Connexion réussie.',
	activated: 'Votre clé d’accès a été créée. Vous êtes connecté.',
	'signed-out': 'Vous êtes déconnecté.'
} as const;
const navigationKey = 'campus-action-notice';

/** Only fixed, non-sensitive messages cross a full document navigation. */
export function notifyAfterNavigation(action: keyof typeof navigationMessages) {
	try {
		sessionStorage.setItem(navigationKey, action);
	} catch {
		notify(navigationMessages[action]);
	}
}

export function consumeNavigationNotice() {
	try {
		const action = sessionStorage.getItem(navigationKey);
		sessionStorage.removeItem(navigationKey);
		if (action && Object.hasOwn(navigationMessages, action))
			notify(navigationMessages[action as keyof typeof navigationMessages]);
	} catch {
		// Storage may be disabled; it must never prevent access to the application.
	}
}
