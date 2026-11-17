import { z } from 'zod';

export function invitationDocument(origin: string, token: string) {
	z.string()
		.regex(/^[a-f0-9]{64}$/)
		.parse(token);
	const url = new URL('/activation', origin);
	url.hash = token;
	const href = url.toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
	return `<!doctype html>
<html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Invitation privée · Campus</title>
<h1>Votre invitation Campus</h1><p>Ce fichier est privé. L’invitation est utilisable une seule fois et expire après 24 heures.</p><p><a href="${href}" rel="noreferrer">Ouvrir mon invitation</a></p></html>
`;
}
