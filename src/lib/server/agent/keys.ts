import { proposalAgentPermissions, type ProposalAgentAction } from '../../domain/proposals.js';
import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { Client } from '@libsql/client/web';
import type { Auth } from '../auth.js';
import { createDatabase } from '../db/index.js';
import { apikey, user } from '../db/schema.js';
import { agentConfigId, agentPermissions, type AgentAction } from '../../domain/module-import.js';

export async function issueAgentKey(
	auth: Auth,
	client: Client,
	email: string,
	name = 'Codex',
	days = 30,
	withCorrections = false
) {
	if (!Number.isInteger(days) || days < 1 || days > 90 || !name.trim() || name.length > 64)
		throw new Error('Use a name and a key duration between 1 and 90 days.');
	const db = createDatabase(client);
	const [teacher] = await db.select().from(user).where(eq(user.email, email.trim().toLowerCase()));
	if (!teacher || teacher.role !== 'teacher')
		throw new Error('An existing teacher account is required.');
	return auth.api.createApiKey({
		body: {
			configId: agentConfigId,
			userId: teacher.id,
			name: name.trim(),
			expiresIn: days * 86400,
			permissions: withCorrections
				? { ...agentPermissions, ...proposalAgentPermissions }
				: agentPermissions
		}
	});
}
export async function revokeAgentKey(client: Client, email: string, keyId: string) {
	const db = createDatabase(client);
	const [teacher] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email.trim().toLowerCase()));
	if (!teacher) throw new Error('Teacher account not found.');
	const removed = await db
		.delete(apikey)
		.where(
			and(
				eq(apikey.id, keyId),
				eq(apikey.referenceId, teacher.id),
				eq(apikey.configId, agentConfigId)
			)
		)
		.returning({ id: apikey.id });
	return removed.length === 1;
}
export function agentBearer(request: Request) {
	const match = /^Bearer ([A-Za-z\d_]{64,200})$/.exec(request.headers.get('authorization') ?? '');
	if (!match) error(401, 'Une clé agent valide est nécessaire.');
	return match[1];
}
export async function authenticateAgent(
	auth: Auth,
	client: Client,
	key: string,
	action: AgentAction | ProposalAgentAction
) {
	const verified = await auth.api.verifyApiKey({
		body: {
			configId: agentConfigId,
			key,
			permissions: action.startsWith('proposal_')
				? { 'correction-proposals': [action === 'proposal_read' ? 'read' : 'create'] }
				: { 'module-drafts': [action] }
		}
	});
	if (!verified.valid || !verified.key) {
		const limited = ['RATE_LIMITED', 'RATE_LIMIT_EXCEEDED', 'USAGE_EXCEEDED'].includes(
			verified.error?.code ?? ''
		);
		error(
			limited ? 429 : 401,
			limited
				? 'Trop de requêtes agent. Réessayez dans une minute.'
				: 'Clé agent invalide, expirée, révoquée ou sans ce droit.'
		);
	}
	if (!verified.key.expiresAt) error(401, 'Une clé agent à durée limitée est nécessaire.');
	const [teacher] = await createDatabase(client)
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(user.id, verified.key.referenceId));
	if (!teacher || teacher.role !== 'teacher') error(403, 'Accès enseignant requis.');
	return { teacherId: teacher.id, permissions: verified.key.permissions };
}
export function requireRubricPermission(permissions: unknown) {
	const parsed = typeof permissions === 'string' ? JSON.parse(permissions) : permissions;
	if (
		!parsed ||
		typeof parsed !== 'object' ||
		!('module-drafts' in parsed) ||
		!Array.isArray(parsed['module-drafts']) ||
		!parsed['module-drafts'].includes('rubric')
	)
		error(403, 'Cette clé ne peut remplacer les barèmes.');
}
