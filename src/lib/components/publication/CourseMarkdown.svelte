<script lang="ts">
	import CodeBlock from '#lib/components/shared/CodeBlock.svelte';
	import CourseMarkdownTable from './CourseMarkdownTable.svelte';
	import { parseCourseMarkdown, parseInlineExerciseText } from './exercise-instructions.js';

	let { text, headingLevel = 4 }: { text: string; headingLevel?: number } = $props();
	const blocks = $derived(parseCourseMarkdown(text));
	const shallowestHeading = $derived(
		blocks.reduce((level, block) => (block.kind === 'heading' ? Math.min(level, block.level) : level), 6)
	);
</script>

{#snippet inline(text: string)}
	{#each parseInlineExerciseText(text) as part, index (index)}{#if part.kind === 'code'}<code>{part.text}</code
			>{:else if part.kind === 'strong'}<strong>{@render inline(part.text)}</strong
			>{:else if part.kind === 'link'}<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={part.href} target="_blank" rel="noreferrer"
				>{@render inline(part.text)}<span class="sr-only"> · lien externe, nouvel onglet</span></a
			>{:else}{part.text}{/if}{/each}
{/snippet}

<div class="course-markdown flex min-w-0 flex-col gap-4">
	{#each blocks as block, index (index)}
		{#if block.kind === 'spacing'}{block.text}{:else if block.kind === 'heading'}
			<svelte:element this={`h${Math.min(6, headingLevel + block.level - shallowestHeading)}`} class="markdown-heading">
				{@render inline(block.text)}
			</svelte:element>
		{:else if block.kind === 'list'}
			<svelte:element
				this={block.ordered ? 'ol' : 'ul'}
				start={block.ordered ? block.start : undefined}
				class="markdown-list"
			>
				{#each block.items as item, itemIndex (itemIndex)}
					<li>{@render inline(item)}</li>
				{/each}
			</svelte:element>
		{:else if block.kind === 'table'}
			<CourseMarkdownTable table={block} {inline} />
		{:else if block.kind === 'code'}
			<CodeBlock
				label="Exemple de code"
				language={block.language ? `Code · ${block.language}` : 'Code'}
				value={block.code}
			>
				{#each block.tokens as token, tokenIndex (tokenIndex)}<span
						style:color={token.kind === 'plain' ? undefined : `var(--syntax-${token.kind})`}>{token.text}</span
					>{/each}
			</CodeBlock>
		{:else}
			<p class="whitespace-pre-wrap">{@render inline(block.text)}</p>
		{/if}
	{/each}
</div>

<style>
	.course-markdown {
		line-height: 1.65;
		overflow-wrap: anywhere;
	}
	p,
	.markdown-list,
	.markdown-heading {
		max-width: var(--reading-measure);
	}
	strong {
		font-weight: 600;
	}
	.markdown-heading {
		margin-block-end: -0.5rem;
		color: var(--foreground);
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.5;
	}
	.markdown-heading:not(:first-child) {
		margin-block-start: 0.5rem;
	}
	.markdown-list {
		padding-inline-start: 1.5rem;
		list-style-type: disc;
	}
	ol.markdown-list {
		list-style-type: decimal;
	}
	.markdown-list li + li {
		margin-block-start: 0.5rem;
	}
	a {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 0.18em;
	}
	a:focus-visible {
		border-radius: var(--radius-sm);
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	code {
		border-radius: var(--radius-control);
		background: var(--muted);
		padding: 0.125rem 0.25rem;
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
</style>
