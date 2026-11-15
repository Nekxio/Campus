<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	let {
		sections,
		value = $bindable(''),
		onAdd
	}: {
		sections: { id: string; title: string; maximum: string | number | null }[];
		value?: string;
		onAdd: () => void;
	} = $props();
</script>

<div class="section-index">
	<h2>Sections du module</h2>
	<div class="mobile-sections">
		<Field.FieldLabel for="rubric-section">Section du barème</Field.FieldLabel>
		<NativeSelect.Root id="rubric-section" bind:value class="w-full" disabled={sections.length === 0}>
			{#each sections as section (section.id)}
				<NativeSelect.Option value={section.id}>
					{section.title}{section.maximum === null ? '' : ` · ${section.maximum}`}
				</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
	</div>
	<div class="desktop-sections">
		<Tabs.List aria-label="Sections du module" class="section-list">
			{#each sections as section (section.id)}
				<Tabs.Trigger value={section.id} class="section-choice">
					<span>{section.title}</span>
					{#if section.maximum !== null}<span class="maximum">{section.maximum}</span>{/if}
				</Tabs.Trigger>
			{/each}
		</Tabs.List>
	</div>
	<Button type="button" variant="outline" class="add-section" disabled={sections.length >= 100} onclick={onAdd}>
		<PlusIcon data-icon="inline-start" />Ajouter une section
	</Button>
	<p>Brouillon conservé entre les sections.</p>
</div>

<style>
	.section-index {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--muted);
		border-radius: var(--radius);
	}
	.mobile-sections {
		display: grid;
		min-width: 0;
		gap: 0.5rem;
	}
	.desktop-sections {
		display: none;
		min-width: 0;
	}
	h2 {
		font-size: 0.875rem;
		font-weight: 600;
	}
	p {
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1.5;
	}
	.section-index :global(.section-list) {
		display: flex;
		height: auto;
		width: 100%;
		flex-direction: column;
		align-items: stretch;
		padding: 0.25rem;
		background: transparent;
		gap: 0.25rem;
		max-height: 20rem;
		overflow-y: auto;
	}
	.section-index :global(.section-choice) {
		flex: none;
		justify-content: space-between;
		flex-wrap: wrap;
		row-gap: 0.25rem;
		height: auto;
		min-height: 2.75rem;
		white-space: normal;
		text-align: left;
		padding: 0.75rem;
		border-radius: var(--radius);
		background: transparent;
	}
	.section-index :global(.section-choice:focus-visible) {
		outline-offset: 2px;
	}
	.section-index :global(.section-choice[data-state='active']) {
		background: var(--accent);
		color: var(--accent-foreground);
	}
	.section-index :global(.add-section) {
		background: var(--background);
		height: auto;
		min-height: 2.75rem;
		white-space: normal;
	}
	span {
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.maximum {
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
		max-width: 100%;
	}
	@container rubric (min-width: 58rem) {
		.mobile-sections {
			display: none;
		}
		.desktop-sections {
			display: block;
		}
	}
</style>
