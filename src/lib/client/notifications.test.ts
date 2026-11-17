import { afterEach, describe, expect, it, vi } from 'vitest';
import { notify, notifyAfterNavigation, consumeNavigationNotice, dismissNotification } from './notifications.js';

const calls = vi.hoisted(() => ({
	success: vi.fn(),
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn(),
	dismiss: vi.fn()
}));
vi.mock('svelte-sonner', () => ({ toast: calls }));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('action notifications', () => {
	it('does not enqueue notifications during SSR or for empty feedback', () => {
		notify('Enregistré');
		vi.stubGlobal('window', {});
		notify('  ');
		expect(calls.success).not.toHaveBeenCalled();
	});
	it('keeps error feedback longer and replaces an existing scoped notification', () => {
		vi.stubGlobal('window', {});
		notify('Vos saisies sont conservées.', 'error', 'form-1');
		notify('Enregistré.', 'success', 'form-1');
		expect(calls.error).toHaveBeenCalledWith('Vos saisies sont conservées.', {
			id: 'form-1',
			duration: 8000
		});
		expect(calls.success).toHaveBeenCalledWith('Enregistré.', { id: 'form-1', duration: 5000 });
	});
	it('allows an explicitly persistent error and dismisses only its scoped ID', () => {
		dismissNotification('sign-out');
		expect(calls.dismiss).not.toHaveBeenCalled();
		vi.stubGlobal('window', {});
		notify('Déconnexion non confirmée.', 'error', 'sign-out', { duration: Infinity });
		expect(calls.error).toHaveBeenCalledExactlyOnceWith('Déconnexion non confirmée.', {
			id: 'sign-out',
			duration: Infinity
		});
		dismissNotification('sign-out');
		expect(calls.dismiss).toHaveBeenCalledExactlyOnceWith('sign-out');
	});
	it('does not globally silence errors or change the default warning duration', () => {
		vi.stubGlobal('window', {});
		notify('À vérifier', 'warning');
		notify('Erreur locale', 'error');
		expect(calls.warning).toHaveBeenCalledWith('À vérifier', { id: undefined, duration: 8000 });
		expect(calls.error).toHaveBeenCalledWith('Erreur locale', { id: undefined, duration: 8000 });
	});
	it('delivers only allowlisted navigation feedback once and stores no private content', () => {
		vi.stubGlobal('window', {});
		const values = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => values.get(key),
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key)
		});
		notifyAfterNavigation('signed-in');
		expect([...values.values()]).toEqual(['signed-in']);
		consumeNavigationNotice();
		consumeNavigationNotice();
		expect(calls.success).toHaveBeenCalledExactlyOnceWith('Connexion réussie.', {
			id: undefined,
			duration: 5000
		});
		values.set('campus-action-notice', 'Untrusted message');
		consumeNavigationNotice();
		expect(calls.success).toHaveBeenCalledTimes(1);
		expect(values.size).toBe(0);
	});
	it('does not break navigation when browser storage is disabled', () => {
		vi.stubGlobal('window', {});
		vi.stubGlobal('sessionStorage', {
			setItem: () => {
				throw new Error('Storage disabled');
			},
			getItem: () => {
				throw new Error('Storage disabled');
			}
		});
		notifyAfterNavigation('signed-out');
		consumeNavigationNotice();
		expect(calls.success).toHaveBeenCalledWith('Vous êtes déconnecté.', {
			id: undefined,
			duration: 5000
		});
	});
});
