import { z } from 'zod';

// Better Auth's installed Drizzle adapter owns JSON encoding of array fields.
// Its schema uses plain SQLite TEXT, rather than Drizzle's JSON encoder.
export function stringArray(value: unknown): string[] {
	return z
		.array(z.string())
		.max(100)
		.parse(typeof value === 'string' ? JSON.parse(value) : value);
}
