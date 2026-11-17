import type { Client } from '@libsql/client/web';

export async function revokeAccount(client: Client, email: string) {
	const transaction = await client.transaction('write');
	try {
		await transaction.execute({
			sql: "DELETE FROM verification WHERE identifier LIKE 'coursely-invite:%' AND json_extract(value, '$.email') = ?",
			args: [email.trim().toLowerCase()]
		});
		// Deleting an account cascades to all of its sessions and passkeys.
		await transaction.execute({
			sql: 'DELETE FROM user WHERE email = ?',
			args: [email.trim().toLowerCase()]
		});
		await transaction.commit();
	} catch (cause) {
		await transaction.rollback();
		throw cause;
	} finally {
		transaction.close();
	}
}
