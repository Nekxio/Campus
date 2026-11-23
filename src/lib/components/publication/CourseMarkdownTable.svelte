<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Table from '#lib/components/ui/table/index.js';
	import { parseInlineExerciseText, type CourseTable } from './exercise-instructions.js';

	let { table, inline }: { table: CourseTable; inline: Snippet<[string]> } = $props();
	let viewportWidth = $state(0);
	let tableWidth = $state(0);
	const overflows = $derived(viewportWidth > 0 && tableWidth > viewportWidth);
	const firstHeading = $derived(
		parseInlineExerciseText(table.columns[0].text)
			.map((part) => part.text)
			.join('')
	);
</script>

<figure class="min-w-0">
	{#if overflows}<figcaption class="mb-2 text-sm text-muted-foreground">
			Faites défiler le tableau pour voir toutes les colonnes.
		</figcaption>{/if}
	<!-- Keyboard users need to scroll the table when its columns exceed the reading area. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:clientWidth={viewportWidth}
		class="overflow-x-auto overscroll-x-contain rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
		role={overflows ? 'region' : undefined}
		aria-label={overflows ? `Défilement horizontal du tableau · ${firstHeading}` : undefined}
		tabindex={overflows ? 0 : undefined}
	>
		<table bind:offsetWidth={tableWidth} class="w-full text-sm">
			<Table.Header>
				<Table.Row>
					{#each table.columns as column, index (index)}
						<Table.Head scope="col" class="min-w-24 whitespace-normal" style={`text-align: ${column.align}`}>
							{@render inline(column.text)}
						</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each table.rows as row, rowIndex (rowIndex)}
					<Table.Row>
						{#each row as cell, index (index)}
							<Table.Cell class="align-top whitespace-normal" style={`text-align: ${table.columns[index].align}`}>
								{@render inline(cell)}
							</Table.Cell>
						{/each}
					</Table.Row>
				{/each}
			</Table.Body>
		</table>
	</div>
</figure>
