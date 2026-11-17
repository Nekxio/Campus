<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { Button } from '#lib/components/ui/button/index.js';

	let { label, language, value, children }: { label: string; language?: string; value?: string; children: Snippet } =
		$props();
	let feedback = $state<{ value: string; status: 'copied' | 'failed' }>();
	let pending = $state(false);
	const status = $derived(feedback?.value === value ? feedback?.status : undefined);
	let pre: HTMLPreElement;
	let code: HTMLElement;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let destroyed = false;

	const copy = async () => {
		if (value === undefined || pending) return;
		const copiedValue = value;
		pending = true;
		feedback = undefined;
		clearTimeout(timeout);
		try {
			await navigator.clipboard.writeText(copiedValue);
			if (destroyed || value !== copiedValue) return;
			feedback = { value: copiedValue, status: 'copied' };
			timeout = setTimeout(() => (feedback = undefined), 2000);
		} catch {
			if (destroyed || value !== copiedValue) return;
			feedback = { value: copiedValue, status: 'failed' };
			pre.focus();
			const selection = window.getSelection();
			const range = document.createRange();
			range.selectNodeContents(code);
			selection?.removeAllRanges();
			selection?.addRange(range);
		} finally {
			pending = false;
		}
	};

	onDestroy(() => {
		destroyed = true;
		clearTimeout(timeout);
	});
</script>

<div class="code-block">
	{#if language || value !== undefined}
		<div class="code-header">
			<span class="code-language">{language ?? 'Code'}</span>
			{#if value !== undefined}
				<Button
					variant="ghost"
					size="icon"
					aria-label={status === 'copied' ? 'Code copié' : 'Copier le code'}
					title={status === 'copied' ? 'Code copié' : 'Copier le code'}
					aria-busy={pending}
					aria-disabled={pending}
					onclick={copy}
				>
					{#if status === 'copied'}<CheckIcon aria-hidden="true" />{:else}<CopyIcon aria-hidden="true" />{/if}
				</Button>
			{/if}
		</div>
	{/if}
	{#if value !== undefined}
		<p role="status" class={status === 'failed' ? 'code-message' : 'sr-only'}>
			{#if status === 'copied'}Le code a été copié.{:else if status === 'failed'}Copie impossible. Le code est
				sélectionné : utilisez la commande Copier de votre appareil.{/if}
		</p>
	{/if}
	<!-- Scrollable source text must be reachable without a pointer. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<pre bind:this={pre} tabindex="0" role="region" aria-label={label}><code bind:this={code}>{@render children()}</code
		></pre>
</div>

<style>
	.code-block {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--background);
	}
	.code-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		border-bottom: 1px solid var(--border);
		padding: 0.25rem 0.5rem 0.25rem 1rem;
	}
	.code-language {
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		font-weight: 500;
	}
	.code-message {
		padding: 0.5rem 1rem 0;
		color: var(--destructive);
		font-size: 0.875rem;
	}
	pre {
		max-width: 100%;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		padding: 1rem;
		font-family: var(--font-mono);
		font-size: 0.875rem;
		line-height: 1.7;
	}
	pre:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
</style>
