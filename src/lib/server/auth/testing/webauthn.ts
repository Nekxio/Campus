import { generateKeyPairSync, createHash, randomBytes, sign } from 'node:crypto';
import { encodeCBOR, type CBORType } from '@levischuck/tiny-cbor';

// Synthetic authenticator: verifies real WebAuthn cryptography without a user's device.
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest();
function challenge(options: unknown) {
	if (!options || typeof options !== 'object' || !('challenge' in options) || typeof options.challenge !== 'string')
		throw new Error('Invalid WebAuthn options.');
	return options.challenge;
}
export function virtualPasskey(origin: string) {
	const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const jwk = publicKey.export({ format: 'jwk' });
	if (!jwk.x || !jwk.y) throw new Error('Missing EC coordinates.');
	const x = new Uint8Array(Buffer.from(jwk.x, 'base64url'));
	const y = new Uint8Array(Buffer.from(jwk.y, 'base64url'));
	const credential = randomBytes(32),
		id = credential.toString('base64url');
	const rpHash = hash(new URL(origin).hostname);
	const data = (type: string, challenge: string, claimedOrigin = origin) =>
		Buffer.from(JSON.stringify({ type, challenge, origin: claimedOrigin, crossOrigin: false }));
	return {
		register(options: unknown, claimedOrigin = origin, verified = true) {
			const cose = encodeCBOR(
				new Map<number, CBORType>([
					[1, 2],
					[3, -7],
					[-1, 1],
					[-2, x],
					[-3, y]
				])
			);
			const length = Buffer.alloc(2);
			length.writeUInt16BE(credential.length);
			const authData = Buffer.concat([
				rpHash,
				Buffer.from([verified ? 0x45 : 0x41]),
				Buffer.alloc(4),
				Buffer.alloc(16),
				length,
				credential,
				Buffer.from(cose)
			]);
			const attestation = encodeCBOR(
				new Map<string, CBORType>([
					['fmt', 'none'],
					['attStmt', new Map()],
					['authData', new Uint8Array(authData)]
				])
			);
			return {
				id,
				rawId: id,
				type: 'public-key',
				response: {
					clientDataJSON: data('webauthn.create', challenge(options), claimedOrigin).toString('base64url'),
					attestationObject: Buffer.from(attestation).toString('base64url'),
					transports: ['internal']
				},
				clientExtensionResults: {},
				authenticatorAttachment: 'platform'
			};
		},
		authenticate(options: unknown, counter = 1, verified = true) {
			const count = Buffer.alloc(4);
			count.writeUInt32BE(counter);
			const authData = Buffer.concat([rpHash, Buffer.from([verified ? 0x05 : 0x01]), count]);
			const clientData = data('webauthn.get', challenge(options));
			return {
				id,
				rawId: id,
				type: 'public-key',
				response: {
					clientDataJSON: clientData.toString('base64url'),
					authenticatorData: authData.toString('base64url'),
					signature: sign('sha256', Buffer.concat([authData, hash(clientData)]), privateKey).toString('base64url'),
					userHandle: null
				},
				clientExtensionResults: {},
				authenticatorAttachment: 'platform'
			};
		}
	};
}
