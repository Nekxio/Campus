<script lang="ts">
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import { mode, resetMode, setMode, userPrefersMode } from 'mode-watcher';
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';

	const themes = [
		{ value: 'light', label: 'Clair', accessibleLabel: 'Thème clair', icon: SunIcon },
		{ value: 'dark', label: 'Sombre', accessibleLabel: 'Thème sombre', icon: MoonIcon },
		{ value: 'system', label: 'Système', accessibleLabel: 'Thème système', icon: MonitorIcon }
	] as const;

	const changeTheme = (value: string) => {
		if (value === 'system') resetMode();
		else if (value === 'light' || value === 'dark') setMode(value);
	};
</script>

<div class="theme-switcher shrink-0">
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			class={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
			aria-label="Choisir le thème"
			title={`Thème : ${themes.find((theme) => theme.value === userPrefersMode.current)?.label ?? 'Système'}`}
		>
			{#if mode.current === 'dark'}<MoonIcon aria-hidden="true" />{:else}<SunIcon aria-hidden="true" />{/if}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content side="bottom" align="end">
			<DropdownMenu.RadioGroup
				aria-label="Thème de l’interface"
				bind:value={() => userPrefersMode.current, changeTheme}
			>
				{#each themes as theme (theme.value)}
					<DropdownMenu.RadioItem value={theme.value} aria-label={theme.accessibleLabel} class="min-h-11" closeOnSelect>
						<theme.icon aria-hidden="true" />{theme.label}
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>

<style>
	@media (pointer: coarse) {
		.theme-switcher :global([data-slot='dropdown-menu-trigger']) {
			min-width: 2.75rem;
			min-height: 2.75rem;
		}
	}
</style>
