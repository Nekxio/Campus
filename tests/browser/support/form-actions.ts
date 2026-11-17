import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Request, Response, Route } from '@playwright/test';

const require = createRequire(import.meta.url);
const devaluePath = require.resolve('devalue', {
	paths: [dirname(require.resolve('sveltekit-superforms/server'))]
});
const devalue = import(pathToFileURL(devaluePath).href) as Promise<{
	parse: (value: string) => unknown;
	stringify: (value: unknown) => string;
}>;

export const readFormActionCommand = async <T = Record<string, unknown>>(request: Request): Promise<T> => {
	const body = request.postDataBuffer();
	if (!body) throw new Error('Missing form action body.');
	const data = await new globalThis.Request(request.url(), {
		method: 'POST',
		headers: request.headers(),
		body: new Uint8Array(body)
	}).formData();
	return (await devalue).parse(data.getAll('__superform_json').join('')) as T;
};

export const readFormActionReceipt = async <T = Record<string, unknown>>(
	response: Pick<Response, 'json'>
): Promise<T> => {
	const envelope = (await response.json()) as { data: string };
	const data = (await devalue).parse(envelope.data) as { receipt: T };
	return data.receipt;
};

export const fulfillFormAction = async (
	route: Route,
	result: {
		status?: number;
		receipt?: unknown;
		message?: string;
		fields?: Record<string, string>;
	}
) => {
	const status = result.status ?? 200;
	await route.fulfill({
		status,
		contentType: 'application/json',
		body: JSON.stringify({
			type: status >= 400 ? 'failure' : 'success',
			status,
			location: new URL(route.request().url()).pathname,
			data: (await devalue).stringify(
				status >= 400
					? { message: result.message ?? 'Unavailable', fields: result.fields ?? {} }
					: { receipt: result.receipt }
			)
		})
	});
};
