import { describe, expect, it, vi } from 'vitest';
import type { SuperForm } from 'sveltekit-superforms';
import { z } from 'zod';
import { createFormActionTransport, decodeFormAction } from './form-actions.js';
import { TeachingRequestError } from './api.js';

const receipt = z.object({ revision: z.number() });

describe('form action transport', () => {
	it.each(['success', 'failure', 'error'] as const)(
		'ignores a late %s from an unmounted form while a newer command is pending',
		async (type) => {
			let handlers: Parameters<SuperForm<Record<string, unknown>>['enhance']>[1];
			const form = {
				options: { dataType: 'json' },
				enhance: vi.fn((_node, events) => {
					handlers = events;
					return { destroy: vi.fn() };
				})
			} as unknown as SuperForm<Record<string, unknown>>;
			const transport = createFormActionTransport(form);
			const first = { action: '', dataset: {}, requestSubmit: vi.fn() } as unknown as HTMLFormElement;
			const mounted = transport.enhance(first);
			const abandoned = transport.submit('/page?/save', { content: 'First command' }, receipt.parse);
			const rejected = expect(abandoned).rejects.toThrow('Enregistrement non confirmé.');
			mounted.destroy();
			await rejected;
			const second = { action: '', dataset: {}, requestSubmit: vi.fn() } as unknown as HTMLFormElement;
			transport.enhance(second);
			const settled = vi.fn();
			const pending = transport.submit('/page?/save', { content: 'Newer command' }, receipt.parse);
			void pending.then(settled, settled);
			const lateResult =
				type === 'success'
					? { type, status: 200, location: '/page', data: { receipt: { revision: 2 } } }
					: type === 'failure'
						? { type, status: 409, location: '/page', data: { message: 'Old conflict.' } }
						: { type, status: 503, error: { message: 'Old network error.', status: 503 } };
			const cancel = vi.fn();
			await handlers?.onResult?.({ result: lateResult, formElement: first, cancel } as never);
			await Promise.resolve();
			expect(cancel).toHaveBeenCalledOnce();
			expect(settled).not.toHaveBeenCalled();
			await handlers?.onResult?.({
				result: { type: 'failure', status: 409, location: '/page', data: { message: 'New conflict.' } },
				formElement: second,
				cancel
			} as never);
			await expect(pending).rejects.toMatchObject({ status: 409, message: 'New conflict.' });
		}
	);
	it('decodes receipts and preserves typed conflicts and validation fields', () => {
		expect(
			decodeFormAction(
				{ type: 'success', status: 200, location: '/page', data: { receipt: { revision: 2 } } },
				receipt.parse
			)
		).toEqual({ revision: 2 });
		try {
			decodeFormAction(
				{
					type: 'failure',
					status: 409,
					location: '/page',
					data: { message: 'Refresh first.', fields: { name: 'Invalid' } }
				},
				receipt.parse
			);
			throw new Error('Expected conflict');
		} catch (cause) {
			expect(cause).toMatchObject({ status: 409, fields: { name: 'Invalid' }, decodedServerError: true });
		}
		expect(() =>
			decodeFormAction({ type: 'success', status: 200, location: '/page', data: {} }, receipt.parse)
		).toThrow(TeachingRequestError);
		expect(() =>
			decodeFormAction({ type: 'error', status: 503, error: { message: 'Unavailable', status: 503 } }, receipt.parse)
		).toThrow(TeachingRequestError);
	});
	it('turns action redirects into the existing consent receipt', () => {
		expect(
			decodeFormAction(
				{ type: 'redirect', status: 303, location: 'https://client.test/callback' },
				z.object({ url: z.string() }).parse
			)
		).toEqual({ url: 'https://client.test/callback' });
	});
	it.each(['json', 'form'] as const)(
		'submits the captured command once through Superforms in %s mode',
		async (dataType) => {
			let handlers: Parameters<SuperForm<Record<string, unknown>>['enhance']>[1];
			const form = {
				options: { dataType },
				enhance: vi.fn((_node, events) => {
					handlers = events;
					return { destroy: vi.fn() };
				})
			} as unknown as SuperForm<Record<string, unknown>>;
			const command = { accept: false, scopes: ['modules:read', 'modules:create'], name: 'captured' };
			const formData = new FormData();
			formData.set('name', 'newer edit');
			formData.set('__superform_id', 'stable');
			const jsonData = vi.fn();
			const cancel = vi.fn();
			const validators = vi.fn();
			const transport = createFormActionTransport(form);
			const handler = vi.fn();
			const element = {
				action: '',
				dataset: {},
				requestSubmit: () => {
					transport.handleSubmit(handler)({} as SubmitEvent);
					void handlers?.onSubmit?.({ formData, jsonData, validators, cancel } as never);
					void handlers?.onResult?.({
						result: { type: 'success', status: 200, location: '/page', data: { receipt: { revision: 3 } } },
						formElement: element,
						cancel
					} as never);
				}
			} as unknown as HTMLFormElement;
			transport.enhance(element);
			expect(await transport.submit('/page?/save', command, receipt.parse)).toEqual({ revision: 3 });
			expect(element.action).toBe('/page?/save');
			expect(handler).not.toHaveBeenCalled();
			expect(validators).toHaveBeenCalledWith(false);
			if (dataType === 'json') expect(jsonData).toHaveBeenCalledWith(command);
			else {
				expect(formData.get('accept')).toBe('false');
				expect(formData.getAll('scopes')).toEqual(command.scopes);
				expect(formData.get('name')).toBe('captured');
			}
		}
	);
});
