<script lang="ts">
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import { resetMode, setMode, userPrefersMode } from 'mode-watcher';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';

	const themes = [
		{ value: 'light', label: 'Clair', accessibleLabel: 'Thème clair', icon: SunIcon },
		{ value: 'dark', label: 'Sombre', accessibleLabel: 'Thème sombre', icon: MoonIcon },
		{ value: 'system', label: 'Système', accessibleLabel: 'Thème système', icon: MonitorIcon }
	] as const;

	function changeTheme(value: string) {
		if (value === 'system') resetMode();
		else if (value === 'light' || value === 'dark') setMode(value);
	}
</script>

<ToggleGroup.Root
	type="single"
	variant="outline"
	aria-label="Thème de l’interface"
	class="w-full"
	bind:value={() => userPrefersMode.current, changeTheme}
>
	{#each themes as theme (theme.value)}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<ToggleGroup.Item
						{...props}
						value={theme.value}
						aria-label={theme.accessibleLabel}
						class="min-h-11 min-w-11 flex-1"
					>
						<theme.icon aria-hidden="true" />
					</ToggleGroup.Item>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="top" sideOffset={8}>{theme.label}</Tooltip.Content>
		</Tooltip.Root>
	{/each}
</ToggleGroup.Root>
