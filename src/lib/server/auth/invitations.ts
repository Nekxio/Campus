import type { Client } from '@libsql/client/web';

export type PrivateRole = 'teacher';
export interface Invitation {
	id: string;
	name: string;
	email: string;
	role: PrivateRole;
}

export class InvalidInvitationError extends Error {
	constructor() {
		super('Invitation invalide, expirée ou déjà utilisée.');
	}
}

export const invitationCookieName = 'coursely_invitation';

export function parseInvitation(value: string): Invitation {
	const data: unknown = JSON.parse(value);
	if (
		!data ||
		typeof data !== 'object' ||
		!('id' in data) ||
		typeof data.id !== 'string' ||
		!data.id ||
		!('name' in data) ||
		typeof data.name !== 'string' ||
		!('email' in data) ||
		typeof data.email !== 'string' ||
		!('role' in data) ||
		data.role !== 'teacher'
	)
		throw new InvalidInvitationError();
	return { id: data.id, name: data.name, email: data.email, role: data.role };
}

export async function invitationIdentifier(token: string | undefined) {
	if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new InvalidInvitationError();
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return 'coursely-invite:' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function invitationFromHeaders(headers?: Headers) {
	return headers
		?.get('cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(invitationCookieName + '='))
		?.slice(invitationCookieName.length + 1);
}

export async function readInvitation(client: Client, token: string | undefined, now = Date.now()) {
	const identifier = await invitationIdentifier(token);
	const row = (
		await client.execute({
			sql: 'SELECT value, expires_at FROM verification WHERE identifier = ? ORDER BY created_at DESC LIMIT 1',
			args: [identifier]
		})
	).rows[0];
	if (!row || Number(row.expires_at) <= now) throw new InvalidInvitationError();
	const invite = parseInvitation(String(row.value));
	const target = (await client.execute({ sql: 'SELECT role, email FROM user WHERE id = ?', args: [invite.id] }))
		.rows[0];
	if (!target || target.role !== 'teacher' || target.email !== invite.email) throw new InvalidInvitationError();
	return { ...invite, identifier };
}

// Only called by the operator CLI, never by an unauthenticated HTTP endpoint.
export const issueInvitation = async (client: Client, input: Omit<Invitation, 'id'>, now = Date.now()) => {
	const email = input.email.trim().toLowerCase();
	const name = input.name.trim();
	if (input.role !== 'teacher' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
		throw new Error('Indiquer un rôle enseignant, une adresse et un nom valides.');
	}
	const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
	const identifier = await invitationIdentifier(token);
	const expiresAt = now + 24 * 60 * 60 * 1000;
	const transaction = await client.transaction('write');
	try {
		const otherTeacher = (
			await transaction.execute({
				sql: "SELECT id FROM user WHERE role = 'teacher' AND email != ? LIMIT 1",
				args: [email]
			})
		).rows[0];
		if (otherTeacher) throw new Error('Cette instance possède déjà un compte enseignant distinct.');
		const existing = (await transaction.execute({ sql: 'SELECT id, role FROM user WHERE email = ?', args: [email] }))
			.rows[0];
		if (existing && existing.role !== input.role)
			throw new Error('Ce compte possède un autre rôle. Aucun droit modifié.');
		const invite: Invitation = {
			id: existing ? String(existing.id) : crypto.randomUUID(),
			name,
			email,
			role: input.role
		};
		if (!existing)
			await transaction.execute({
				sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role) VALUES (?, ?, ?, 0, ?, ?, ?)',
				args: [invite.id, name, email, now, now, input.role]
			});
		await transaction.execute({
			sql: "DELETE FROM verification WHERE identifier LIKE 'coursely-invite:%' AND json_extract(value, '$.id') = ?",
			args: [invite.id]
		});
		await transaction.execute({
			sql: 'INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
			args: [crypto.randomUUID(), identifier, JSON.stringify(invite), expiresAt, now, now]
		});
		await transaction.commit();
		return { token, expiresAt, ...invite };
	} catch (cause) {
		await transaction.rollback();
		throw cause;
	} finally {
		transaction.close();
	}
};
