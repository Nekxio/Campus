import { expect, it } from 'vitest';
import { invitationDocument } from './invitation-link.js';

it('keeps the private invitation in a fragment on a fixed activation path', () => {
	const html = invitationDocument('https://coursely.example.test', 'a'.repeat(64));
	expect(html).toContain('href="https://coursely.example.test/activation#' + 'a'.repeat(64) + '"');
	expect(html).not.toContain('?token=');
	expect(html).toContain('rel="noreferrer"');
	expect(() => invitationDocument('https://coursely.example.test', '"><script>')).toThrow();
});
