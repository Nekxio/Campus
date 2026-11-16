<script lang="ts">
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	let {
		section,
		sections,
		onSelect
	}: {
		section: string;
		sections: { value: string; label: string }[];
		onSelect: (value: string) => Promise<void>;
	} = $props();
	const descriptions: Record<string, string> = {
		information: 'Identité et objectifs',
		preparation: 'Références et travail personnel',
		resources: 'Supports, consignes, exercices',
		planning: 'Association et séances'
	};
</script>

<div class="task-navigation">
	<div class="desktop-sections">
		<Tabs.List aria-label="Sections du module" class="w-full gap-1">
			{#each sections as item (item.value)}
				<Tabs.Trigger value={item.value} class="min-h-16 w-full whitespace-normal text-foreground">
					<span class="task-label">{item.label}<span>{descriptions[item.value]}</span></span>
				</Tabs.Trigger>
			{/each}
		</Tabs.List>
	</div>
	<div class="mobile-sections">
		<Field.FieldGroup>
			<Field.Field>
				<Field.FieldLabel for="module-section">Section du module</Field.FieldLabel>
				<NativeSelect.Root
					id="module-section"
					value={section}
					onchange={(event) => onSelect(event.currentTarget.value)}
					class="w-full"
				>
					{#each sections as item (item.value)}<NativeSelect.Option value={item.value}>{item.label}</NativeSelect.Option
						>{/each}
				</NativeSelect.Root>
			</Field.Field>
		</Field.FieldGroup>
	</div>
</div>

<style>
	.task-navigation {
		min-width: 0;
	}
	.desktop-sections {
		display: none;
	}
	.task-label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		text-align: left;
	}
	.task-label > span {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--muted-foreground);
	}
	@media (min-width: 64rem) {
		.task-navigation {
			position: sticky;
			top: 5rem;
		}
		.desktop-sections {
			display: block;
		}
		.mobile-sections {
			display: none;
		}
	}
</style>
