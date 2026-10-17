import { McpServer } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { z } from 'zod';
import { error, isHttpError } from '@sveltejs/kit';
import type { Database } from '../db/index.js';
import type { McpPrincipal } from './principal.js';
import type { McpScope } from '../../domain/remote-mcp.js';
import { idSchema } from '../../domain/contracts.js';
import { createModuleImportSchema, updateModuleImportSchema } from '../../domain/module-import.js';
import { patchModuleImportSchema } from '../../domain/module-patch.js';
import { createProposalSchema } from '../../domain/proposals.js';
import { readImportContext, importModule } from '../agent/import.js';
import { patchModule } from '../agent/patch.js';
import { getCorrectionContext, createCorrectionProposal } from '../teaching/proposals.js';

export const toolScopes: Record<string, McpScope[]> = {
	get_import_context: ['modules:read'],
	create_module_draft: ['modules:read', 'modules:create'],
	update_module_draft: ['modules:read', 'modules:update'],
	patch_module_draft: ['modules:read', 'modules:update'],
	get_correction_context: ['modules:read', 'corrections:read'],
	propose_correction: ['modules:read', 'corrections:read', 'corrections:propose']
};
export function requiredToolScopes(name: string, input: unknown): McpScope[] {
	const scopes = [...(toolScopes[name] ?? [])];
	if (
		['create_module_draft', 'update_module_draft', 'patch_module_draft'].includes(name) &&
		input &&
		typeof input === 'object'
	) {
		const value = input as Record<string, unknown>;
		const remove = value.remove;
		if (
			value.rubric ||
			(remove &&
				typeof remove === 'object' &&
				['assessments', 'groups', 'lines', 'results', 'deadlineAssessments'].some(
					(key) => key in remove
				))
		)
			scopes.push('modules:rubric');
	}
	return scopes;
}
export function createRemoteMcp(db: Database, principal: McpPrincipal) {
	const server = new McpServer(
		{ name: 'coursely', version: '1.0.0' },
		{ jsonSchemaValidator: new CfWorkerJsonSchemaValidator() }
	);
	const read = {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false
	};
	function tool<S extends z.ZodObject>(
		name: string,
		schema: S,
		description: string,
		operation: (input: z.output<S>) => Promise<unknown>,
		readOnly = false
	) {
		if (!toolScopes[name].every((scope) => principal.scopes.includes(scope))) return;
		server.registerTool(
			name,
			{
				description,
				inputSchema: z.strictObject(schema.shape),
				annotations: readOnly
					? read
					: {
							readOnlyHint: false,
							destructiveHint: true,
							idempotentHint: true,
							openWorldHint: true
						}
			},
			async (input) => {
				try {
					if (!requiredToolScopes(name, input).every((scope) => principal.scopes.includes(scope)))
						error(403, 'Droit supplémentaire requis.');
					const value = await operation(schema.parse(input));
					const text = JSON.stringify(value);
					if (new TextEncoder().encode(text).byteLength > 4 * 1024 * 1024)
						error(413, 'Réduisez le périmètre demandé.');
					return {
						content: [{ type: 'text' as const, text }],
						structuredContent: JSON.parse(text)
					};
				} catch (cause) {
					return {
						isError: true,
						content: [
							{
								type: 'text' as const,
								text: isHttpError(cause)
									? (cause.body.message ?? 'Opération refusée.')
									: 'Opération indisponible. Conservez les identifiants et réessayez la même commande.'
							}
						]
					};
				}
			}
		);
	}
	tool(
		'get_import_context',
		z.strictObject({ moduleId: idSchema.optional() }),
		'Lire les identifiants exacts, brouillons, classes et barèmes, sans étudiants ni notes. Aucun accès aux dossiers locaux.',
		({ moduleId }) => readImportContext(db, moduleId),
		true
	);
	tool(
		'create_module_draft',
		createModuleImportSchema,
		'Créer un brouillon privé avec des UUID durables et un requestId réutilisé pour une relance identique. Ne publie pas et ne copie aucun fichier. Lire le contexte avant la commande.',
		(input) => importModule(db, principal.teacherId, 'create', input)
	);
	tool(
		'update_module_draft',
		updateModuleImportSchema,
		'Mise à jour complète historique avec révision optimiste ; les éléments omis sont préservés. Préférer patch_module_draft. Un remplacement de barème doit être explicite. Ne publie pas.',
		(input) => importModule(db, principal.teacherId, 'update', input)
	);
	tool(
		'patch_module_draft',
		patchModuleImportSchema,
		'Modifier précisément le brouillon privé avec les IDs et révisions lus. Les champs et éléments omis sont préservés ; les suppressions sont explicites. Rejouer une requête identique après réponse perdue ; relire après HTTP 409. Ne publie pas.',
		(input) => patchModule(db, principal.teacherId, input)
	);
	tool(
		'get_correction_context',
		z.strictObject({ moduleId: idSchema, contextId: idSchema, studentId: idSchema.optional() }),
		'Lire la liste de la classe exacte et les résultats/commentaire privés d’un seul étudiant sélectionné. Ne jamais déduire un étudiant par son nom.',
		({ moduleId, contextId, studentId }) =>
			db.transaction((tx) => getCorrectionContext(tx, moduleId, contextId, studentId)),
		true
	);
	tool(
		'propose_correction',
		createProposalSchema,
		'Créer une proposition privée depuis le contexte exact sélectionné, avec les révisions et UUID de requête conservés. Seul l’enseignant peut décider ; aucun score final n’est écrit par cet outil.',
		(input) => createCorrectionProposal(db, principal.teacherId, input)
	);
	return server;
}
