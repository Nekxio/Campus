import { afterEach, expect, it, vi } from 'vitest';
import { followRowLink } from './table-row-link.js';

afterEach(() => vi.unstubAllGlobals());

it('follows a row once while preserving controls, selection, and modified clicks', () => {
	const link = { href: 'https://campus.example.test/module', click: vi.fn() };
	let selected = '';
	class Target {
		interactive = false;
		closest() {
			return this.interactive ? this : null;
		}
	}
	class Row {
		querySelector() {
			return link;
		}
	}
	const row = new Row();
	const target = new Target();
	const open = vi.fn();
	vi.stubGlobal('HTMLElement', Row);
	vi.stubGlobal('Element', Target);
	vi.stubGlobal('window', { getSelection: () => ({ toString: () => selected }), open });
	const click = (options: Record<string, unknown> = {}) =>
		followRowLink({ currentTarget: row, target, button: 0, ...options } as unknown as MouseEvent);

	click();
	expect(link.click).toHaveBeenCalledOnce();
	target.interactive = true;
	click();
	expect(link.click).toHaveBeenCalledOnce();
	target.interactive = false;
	selected = 'Texte sélectionné';
	click();
	expect(link.click).toHaveBeenCalledOnce();
	selected = '';
	click({ metaKey: true });
	expect(open).toHaveBeenCalledWith(link.href, '_blank', 'noopener,noreferrer');
	expect(link.click).toHaveBeenCalledOnce();
	click({ button: 2 });
	click({ shiftKey: true });
	expect(link.click).toHaveBeenCalledOnce();
	expect(open).toHaveBeenCalledOnce();
});
