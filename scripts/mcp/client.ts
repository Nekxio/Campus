import {
	createAgentClassSchema,
	addAgentStudentsSchema,
	classRosterSchema
} from '../../src/lib/domain/roster-agent.js';
import { idSchema } from '../../src/lib/domain/contracts.js';
import { correctionContextSchema, proposalReceiptSchema, type CreateProposal } from '../../src/lib/domain/proposals.js';
import { z } from 'zod';
import { quizContextSchema, type QuizContextRequest, type AgentQuizPatch } from '../../src/lib/domain/quiz-agent.js';
import { quizDraftReceiptSchema, type QuizDraftWrite } from '../../src/lib/domain/quiz-content.js';
import type { ModulePatchImport } from '../../src/lib/domain/module-patch.js';
import { importContextSchema, importReceiptSchema, type ModuleImport } from '../../src/lib/domain/module-import.js';

export const agentConnectionSchema = z
	.strictObject({
		version: z.literal(1),
		origin: z.url(),
		key: z.string().regex(/^coursely_[A-Za-z\d_]{64,200}$/),
		keyId: z.string().min(1),
		teacherId: z.string().min(1),
		expiresAt: z.iso.datetime()
	})
	.superRefine((config, ctx) => {
		const url = new URL(config.origin);
		const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
		if (
			(url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== '/'
		)
			ctx.addIssue({
				code: 'custom',
				path: ['origin'],
				message: 'Use an exact HTTPS origin, or HTTP loopback for development.'
			});
	});
export type AgentConnection = z.infer<typeof agentConnectionSchema>;
export class AgentApiError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
	}
}
export function agentClient(config: AgentConnection, fetcher: typeof fetch = fetch) {
	const checked = agentConnectionSchema.parse(config);
	const origin = new URL(checked.origin).origin;
	async function request(path: string, method = 'GET', body?: unknown) {
		if (Date.parse(checked.expiresAt) <= Date.now())
			throw new Error('The agent key has expired. Issue a replacement through the operator command.');
		const response = await fetcher(origin + path, {
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(15000),
			headers: {
				Authorization: 'Bearer ' + checked.key,
				Accept: 'application/json',
				...(body === undefined ? {} : { 'Content-Type': 'application/json' })
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		const reader = response.body?.getReader();
		if (!reader) throw new Error('Campus returned an empty response.');
		let size = 0;
		const chunks: Uint8Array[] = [];
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > 1000000) {
					await reader.cancel();
					throw new Error('Campus returned an oversized response.');
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw new Error('Campus returned an invalid JSON response.');
		}
		if (!response.ok) {
			const message =
				parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string'
					? parsed.message.replaceAll(checked.key, '[redacted]').slice(0, 1000)
					: 'Campus refused this operation.';
			throw new AgentApiError(response.status, message);
		}
		return parsed;
	}
	return {
		origin,
		async createClass(input: z.infer<typeof createAgentClassSchema>) {
			return z
				.strictObject({ id: idSchema })
				.parse(await request('/api/agent/classes', 'POST', createAgentClassSchema.parse(input)));
		},
		async classRoster(classId: string) {
			return classRosterSchema.parse(
				await request('/api/agent/roster?classId=' + encodeURIComponent(idSchema.parse(classId)))
			);
		},
		async addStudents(input: z.infer<typeof addAgentStudentsSchema>) {
			return z
				.strictObject({
					classId: idSchema,
					revision: z.int().positive(),
					studentIds: z.array(idSchema)
				})
				.parse(await request('/api/agent/roster', 'POST', addAgentStudentsSchema.parse(input)));
		},
		async quizContext(input: QuizContextRequest) {
			const query = new URLSearchParams({
				moduleId: input.moduleId,
				...(input.contextId ? { contextId: input.contextId } : {}),
				...(input.quizId ? { quizId: input.quizId } : {})
			});
			return quizContextSchema.parse(await request('/api/agent/quizzes/context?' + query));
		},
		async createQuiz(input: QuizDraftWrite) {
			if (Buffer.byteLength(JSON.stringify(input)) > 256000)
				throw new Error('The quiz exceeds the 256 KB request limit.');
			return quizDraftReceiptSchema.parse(await request('/api/agent/quizzes', 'POST', input));
		},
		async patchQuiz(input: AgentQuizPatch) {
			if (Buffer.byteLength(JSON.stringify(input)) > 256000)
				throw new Error('The quiz exceeds the 256 KB request limit.');
			return quizDraftReceiptSchema.parse(
				await request('/api/agent/quizzes/' + encodeURIComponent(input.id), 'PATCH', input)
			);
		},
		async context(moduleId?: string) {
			return importContextSchema.parse(
				await request('/api/agent/context' + (moduleId ? '?moduleId=' + encodeURIComponent(moduleId) : ''))
			);
		},
		async correctionContext(moduleId: string, contextId: string, studentId?: string) {
			const query = new URLSearchParams({
				moduleId,
				contextId,
				...(studentId ? { studentId } : {})
			});
			return correctionContextSchema.parse(await request('/api/agent/correction-context?' + query));
		},
		async propose(input: CreateProposal) {
			if (Buffer.byteLength(JSON.stringify(input)) > 256000)
				throw new Error('The proposal exceeds the 256 KB request limit.');
			return proposalReceiptSchema.parse(await request('/api/agent/proposals', 'POST', input));
		},
		async import(action: 'create' | 'update', input: ModuleImport | ModulePatchImport) {
			if (Buffer.byteLength(JSON.stringify(input)) > 256000)
				throw new Error('The import exceeds the 256 KB request limit.');
			return importReceiptSchema.parse(
				await request(
					'/api/agent/modules' + (action === 'update' ? '/' + input.moduleId : ''),
					action === 'create' ? 'POST' : 'PATCH',
					input
				)
			);
		}
	};
}
