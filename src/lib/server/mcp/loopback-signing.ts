import type { Jwk, JwtOptions } from 'better-auth/plugins/jwt';
import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { verification } from '../db/schema.js';

const rotationInterval = 7 * 24 * 60 * 60;
const gracePeriod = 60 * 60;
type KeyMaterial = Pick<Jwk, 'publicKey' | 'privateKey' | 'alg' | 'crv'>;

const keyringIdentifier = async (origin: string, secret: string) => {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign'
	]);
	const digest = await crypto.subtle.sign('HMAC', key, encoder.encode('campus-loopback-jwks:' + origin));
	const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return 'campus-loopback-jwks:' + hash;
};

// Preview and loopback can share SQL while using different signing secrets. Keep
// local keys out of the legacy JWKS table used by the deployed Worker.
export const loopbackSigning = async (db: Database, origin: string, secret: string): Promise<JwtOptions> => {
	const identifier = await keyringIdentifier(origin, secret);
	return {
		jwks: { rotationInterval, gracePeriod },
		adapter: {
			getJwks: async () => {
				const rows = await db
					.select({
						id: verification.id,
						value: verification.value,
						createdAt: verification.createdAt,
						expiresAt: verification.expiresAt
					})
					.from(verification)
					.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())));
				return rows.map(({ value, expiresAt, ...row }) => ({
					...(JSON.parse(value) as KeyMaterial),
					...row,
					expiresAt: new Date(expiresAt.getTime() - gracePeriod * 1000)
				}));
			},
			createJwk: async ({ createdAt, expiresAt, ...material }) => {
				const id = crypto.randomUUID();
				const rotatesAt = expiresAt ?? new Date(createdAt.getTime() + rotationInterval * 1000);
				await db.insert(verification).values({
					id,
					identifier,
					value: JSON.stringify(material),
					createdAt,
					expiresAt: new Date(rotatesAt.getTime() + gracePeriod * 1000)
				});
				return { ...material, id, createdAt, expiresAt: rotatesAt };
			}
		}
	};
};
