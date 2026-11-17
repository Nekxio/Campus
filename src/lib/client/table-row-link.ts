const interactive =
	'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [contenteditable]';

export function followRowLink(event: MouseEvent) {
	if (event.defaultPrevented || event.button !== 0 || event.altKey || event.shiftKey) return;
	if (!(event.currentTarget instanceof HTMLElement) || !(event.target instanceof Element)) return;
	if (event.target.closest(interactive) || window.getSelection()?.toString().trim()) return;
	const link = event.currentTarget.querySelector<HTMLAnchorElement>('a[data-row-link]');
	if (!link) return;
	if (event.metaKey || event.ctrlKey) window.open(link.href, '_blank', 'noopener,noreferrer');
	else link.click();
}
