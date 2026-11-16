import { describe, expect, it } from 'vitest';
import { issueQuizCredential, readQuizCredential, hashQuizCredential } from './credentials.js';

describe('opaque room credentials', () => {
	it('creates random credentials and binds their stored hash to a single room', async () => {
		const roomId = crypto.randomUUID();
		const participantId = crypto.randomUUID();
		const first = issueQuizCredential(participantId);
		const second = issueQuizCredential(participantId);
		expect(first).not.toBe(second);
		expect(readQuizCredential(first)?.participantId).toBe(participantId);
		const hash = await hashQuizCredential(roomId, first);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
		expect(await hashQuizCredential(crypto.randomUUID(), first)).not.toBe(hash);
		expect(hash).not.toContain(first);
		const changedIdentity = crypto.randomUUID() + '.' + readQuizCredential(first)!.secret;
		expect(await hashQuizCredential(roomId, changedIdentity)).not.toBe(hash);
		await expect(hashQuizCredential(roomId, participantId + '.guess')).rejects.toThrow();
	});
	it.each([undefined, '', 'teacher', 'x.'.repeat(1000), `${crypto.randomUUID()}.guess`])(
		'rejects malformed browser credentials',
		(value) => expect(readQuizCredential(value)).toBeNull()
	);
});
