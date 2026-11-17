import { describe, expect, it } from 'vitest';
import { defaultMcpScopes, groupMcpScopes, isStudentDataScope, mcpScopes } from './remote-mcp.js';

describe('Student data permissions', () => {
	it('preselects exactly the permissions requested by the OAuth client', () => {
		expect(defaultMcpScopes(mcpScopes)).toEqual([...mcpScopes]);
		expect(defaultMcpScopes(['modules:read', 'roster:manage', 'offline_access'])).toEqual([
			'modules:read',
			'roster:manage',
			'offline_access'
		]);
		expect(defaultMcpScopes(['modules:read', 'modules:read'])).toEqual(['modules:read']);
	});
	it('groups all supported permissions once and keeps destructive permissions explicit', () => {
		const groups = groupMcpScopes(mcpScopes);
		expect(groups).toHaveLength(8);
		expect(groups.flatMap((group) => group.scopes).sort()).toEqual([...mcpScopes].sort());
		expect(groups.find((group) => group.scopes.includes('roster:delete'))?.notice).toContain('Suppression');
		expect(groups.find((group) => group.scopes.includes('annual:purge'))?.notice).toContain('Purge');
	});
	it('shows only requested permissions and omits empty groups and unrelated notices', () => {
		const groups = groupMcpScopes(['modules:read', 'roster:manage']);
		expect(groups.map((group) => group.title)).toEqual(['Modules et barèmes', 'Classes et étudiants']);
		expect(groups.flatMap((group) => group.scopes)).toEqual(['modules:read', 'roster:manage']);
		expect(groups.every((group) => !group.notice)).toBe(true);
	});
	it('recognizes the roster as personal data even without corrections', () => {
		expect(isStudentDataScope('roster:manage')).toBe(true);
		expect(isStudentDataScope('corrections:read')).toBe(true);
		expect(isStudentDataScope('corrections:propose')).toBe(true);
		expect(isStudentDataScope('quizzes:read')).toBe(false);
	});
});
