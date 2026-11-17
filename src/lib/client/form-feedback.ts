import { tick } from 'svelte';

export const focusFirstInvalidField = async (form: HTMLFormElement): Promise<void> => {
	await tick();
	// form.elements includes controls associated through a form attribute outside the form.
	for (const control of form.elements) {
		if (
			!(control instanceof HTMLElement) ||
			control.getAttribute('aria-invalid') !== 'true' ||
			control.matches(':disabled, input[type="hidden"]') ||
			control.closest('[hidden], [inert]')
		) {
			continue;
		}
		let details = control.closest('details');
		while (details) {
			details.open = true;
			details = details.parentElement?.closest('details') ?? null;
		}
		await tick();
		if (!control.getClientRects().length) continue;
		control.focus();
		return;
	}
};
