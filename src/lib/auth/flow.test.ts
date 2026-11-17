import { describe, expect, it } from 'vitest';
import { readInvitationToken, authIssue, InvitationPreparationError, invitationIdentitySchema } from './flow.js';
import { getInitials } from '../profile.js';

describe('Access flow safety and recovery', () => {
	it('reads only a complete invitation fragment, never a query or an additional redirect', () => {
		const token = 'a'.repeat(64);
		expect(readInvitationToken('#' + token)).toBe(token);
		expect(readInvitationToken('#token=' + token)).toBe(token);
		for (const input of ['', '?token=' + token, '#token=' + token + '&next=https://hostile.test', '#short'])
			expect(readInvitationToken(input)).toBeUndefined();
	});
	it('allows cancellation and throttling retries, but rejects unusable invitations', () => {
		expect(authIssue({ code: 'AUTH_CANCELLED', status: 400 }, 'activation').retry).toBe(true);
		expect(authIssue({ code: 'ERROR_CEREMONY_ABORTED' }, 'activation').title).toBe('Demande interrompue');
		expect(authIssue({ status: 429 }, 'activation').retry).toBe(true);
		expect(authIssue(new InvitationPreparationError(400), 'activation').retry).toBe(false);
		expect(authIssue({ status: 403 }, 'activation').title).toBe('Invitation indisponible');
		expect(authIssue({ status: 503 }, 'activation').retry).toBe(true);
	});
	it('does not render server or provider error text', () => {
		const issue = authIssue({ status: 500, message: 'PRIVATE TOKEN AND SQL DETAILS' }, 'sign-in');
		expect(JSON.stringify(issue)).not.toContain('PRIVATE');
		expect(issue.title).toBe('Connexion indisponible');
		expect(authIssue({ name: 'NotSupportedError' }, 'sign-in').retry).toBe(false);
	});
	it('validates invitation identity independently of raw JSON', () => {
		expect(invitationIdentitySchema.safeParse({ name: 'Demo', email: 'demo@example.test' }).success).toBe(true);
		expect(invitationIdentitySchema.safeParse({ name: '', email: 'invalid' }).success).toBe(false);
		expect(
			invitationIdentitySchema.safeParse({
				name: 'Demo',
				email: 'demo@example.test',
				token: 'secret'
			}).success
		).toBe(false);
	});
	it.each([
		['Léo Hilaire', 'LH'],
		['Jean Pierre Dupont', 'JD'],
		['Élodie Martin', 'ÉM'],
		['Léo', 'L'],
		['', '?'],
		['  Jean-Pierre   Dupont  ', 'JD']
	])('keeps the initials of %s as %s', (name, expected) => {
		expect(getInitials(name)).toBe(expected);
	});
});
