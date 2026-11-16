import { readFile } from 'node:fs/promises';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { agentConnectionSchema } from './mcp/client.js';
import { moduleOperations } from './mcp/operations.js';
import { createModuleMcp } from './mcp/server.js';

// No .env, Turso credentials or browser cookies are loaded by the MCP process.
const privatePath =
	process.env.CAMPUS_AGENT_CONFIG_FILE ?? fileURLToPath(new URL('../data/agent/codex.json', import.meta.url));
const roots = (process.env.CAMPUS_MODULE_ROOTS ?? '').split(delimiter).filter(Boolean);
if (!roots.length) throw new Error('Configure CAMPUS_MODULE_ROOTS with the allowed local course folders.');
async function connection() {
	try {
		return agentConnectionSchema.parse(JSON.parse(await readFile(privatePath, 'utf8')));
	} catch {
		throw new Error(
			'Agent setup is required. Run the operator key command and keep its private file outside Git; do not paste a key into chat.'
		);
	}
}
const server = createModuleMcp(moduleOperations(roots, connection));
await server.connect(new StdioServerTransport());
