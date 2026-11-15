<script lang="ts">
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import { notifyAfterNavigation } from '#lib/client/notifications.js';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import { tick } from 'svelte';
	import HomeIcon from '@lucide/svelte/icons/house';
	import BookIcon from '@lucide/svelte/icons/book-open';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PenIcon from '@lucide/svelte/icons/clipboard-pen';
	import DotsIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import UserIcon from '@lucide/svelte/icons/user-round';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { authClient } from '#lib/auth-client.js';
	import { getInitials } from '#lib/profile.js';
	import * as Alert from '#lib/components/ui/alert/index.js';

	let {
		userName,
		active = 'home'
	}: {
		userName: string;
		active?: 'home' | 'classes' | 'modules' | 'grading' | 'student-view' | 'applications' | 'account';
	} = $props();
	const sidebar = Sidebar.useSidebar();
	const initials = $derived(getInitials(userName));
	let signingOut = $state(false);
	let signOutFailed = $state(false);
	let userMenuOpen = $state(false);
	let signOutSummary = $state<HTMLDivElement | null>(null);
	const navigationVisible = $derived(sidebar.isMobile ? sidebar.openMobile : sidebar.open);
	const inlineSignOutVisible = $derived(navigationVisible && !userMenuOpen);

	$effect(() => {
		// Reset the portaled menu when navigation hides; a derived open value would reopen it later.
		if (!navigationVisible) userMenuOpen = false;
	});

	async function signOut(event: Event) {
		event.preventDefault();
		if (signingOut) return;
		userMenuOpen = false;
		signingOut = true;
		signOutFailed = false;
		try {
			const result = await authClient.signOut();
			if (result.error || result.data?.success !== true) throw new Error('Sign out failed.');
			notifyAfterNavigation('signed-out');
			window.location.assign('/connexion');
		} catch {
			signOutFailed = true;
			signingOut = false;
			await tick();
			if (inlineSignOutVisible) signOutSummary?.focus();
		}
	}

	function closeNavigation() {
		userMenuOpen = false;
		sidebar.setOpenMobile(false);
	}

	function restoreMenuFocus(event: Event) {
		if (!navigationVisible) {
			event.preventDefault();
			document.getElementById('sidebar-toggle')?.focus();
		}
	}
</script>

<ActionNotice
	message={signOutFailed ? 'La déconnexion n’a pas pu être confirmée. Réessayez.' : ''}
	kind="error"
	duration={Infinity}
	dismissOnClear
/>

{#snippet identity()}
	<Avatar.Root aria-hidden="true">
		<Avatar.Fallback style="--muted-foreground: var(--foreground)">{initials}</Avatar.Fallback>
	</Avatar.Root>
	<div class="grid min-w-0 flex-1 text-start leading-tight">
		<span class="truncate text-sm font-medium text-foreground">{userName}</span>
		<span
			class="text-xs wrap-anywhere whitespace-normal text-muted-foreground"
			style="--muted-foreground: var(--foreground)">Espace enseignant</span
		>
	</div>
{/snippet}

<Sidebar.Root
	variant="inset"
	collapsible="offcanvas"
	inert={!sidebar.isMobile && !sidebar.open}
	aria-hidden={!sidebar.isMobile && !sidebar.open ? true : undefined}
>
	<Sidebar.Header class="h-16 shrink-0 justify-center px-4 py-2">
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton class="[&_svg]:size-6">
					{#snippet child({ props })}
						<a {...props} href={resolve('/')} onclick={closeNavigation}>
							<BookIcon aria-hidden="true" /><span class="campus-wordmark">Campus</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content class="pt-4">
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<nav aria-label="Navigation principale">
					<Sidebar.Menu>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active === 'home'}>
								{#snippet child({ props })}
									<a
										{...props}
										href={resolve('/')}
										aria-current={active === 'home' ? 'page' : undefined}
										onclick={closeNavigation}
									>
										<HomeIcon aria-hidden="true" /><span>Accueil</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active === 'modules'}>
								{#snippet child({ props })}
									<a
										aria-current={active === 'modules' ? 'page' : undefined}
										{...props}
										href={resolve('/enseignant/modules')}
										onclick={closeNavigation}
									>
										<BookIcon aria-hidden="true" /><span>Modules</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={active === 'classes'}>
								{#snippet child({ props })}<a
										{...props}
										href={resolve('/enseignant/classes')}
										aria-current={active === 'classes' ? 'page' : undefined}
										onclick={closeNavigation}><UsersIcon aria-hidden="true" /><span>Classes</span></a
									>{/snippet}
							</Sidebar.MenuButton></Sidebar.MenuItem
						>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active === 'grading'}>
								{#snippet child({ props })}
									<a
										{...props}
										href={resolve('/enseignant/notation?classe=&module=')}
										aria-current={active === 'grading' && page.url.pathname !== '/enseignant/propositions'
											? 'page'
											: undefined}
										onclick={closeNavigation}><PenIcon aria-hidden="true" /><span>Notation</span></a
									>
								{/snippet}
							</Sidebar.MenuButton>
							{#if active === 'grading'}
								<Sidebar.MenuSub>
									<Sidebar.MenuSubItem>
										<Sidebar.MenuSubButton
											href={resolve('/enseignant/propositions')}
											isActive={page.url.pathname === '/enseignant/propositions'}
											aria-current={page.url.pathname === '/enseignant/propositions' ? 'page' : undefined}
											onclick={closeNavigation}
											class="min-h-11"
											><ListChecksIcon aria-hidden="true" /><span>Propositions</span></Sidebar.MenuSubButton
										>
									</Sidebar.MenuSubItem>
								</Sidebar.MenuSub>
							{/if}
						</Sidebar.MenuItem>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active === 'student-view'}>
								{#snippet child({ props })}
									<a
										{...props}
										href={resolve('/enseignant/vue-etudiante')}
										aria-current={active === 'student-view' ? 'page' : undefined}
										onclick={closeNavigation}
									>
										<BookIcon aria-hidden="true" /><span>Pages publiées</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					</Sidebar.Menu>
				</nav>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer class="gap-3 p-3">
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<DropdownMenu.Root bind:open={userMenuOpen}>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Sidebar.MenuButton
								{...props}
								size="lg"
								class="grid h-auto min-h-14 grid-cols-[1.5rem_minmax(0,1fr)_1rem] gap-x-2 gap-y-1 py-2"
								aria-label={`Menu utilisateur de ${userName}`}
							>
								<Avatar.Root aria-hidden="true" class="size-6">
									<Avatar.Fallback style="--muted-foreground: var(--foreground)">{initials}</Avatar.Fallback>
								</Avatar.Root>
								<span class="min-w-0 truncate text-start text-sm font-medium text-foreground">{userName}</span>
								<DotsIcon aria-hidden="true" class="size-4" />
								<span
									class="col-span-3 min-w-0 text-start text-xs wrap-anywhere whitespace-normal! text-muted-foreground"
									style="--muted-foreground: var(--foreground)">Espace enseignant</span
								>
							</Sidebar.MenuButton>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content
						id="sidebar-account-menu"
						class="min-w-56"
						side={sidebar.isMobile ? 'bottom' : 'right'}
						align="end"
						sideOffset={4}
						onCloseAutoFocus={restoreMenuFocus}
					>
						<DropdownMenu.Group>
							<DropdownMenu.Label class="p-0">
								<div class="flex items-center gap-2 px-3 py-3">{@render identity()}</div>
							</DropdownMenu.Label>
							<DropdownMenu.Label>Espace enseignant</DropdownMenu.Label>
						</DropdownMenu.Group>
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.Item>
								{#snippet child({ props })}
									<a
										{...props}
										href={resolve('/enseignant/compte')}
										aria-current={active === 'account' ? 'page' : undefined}
										onclick={closeNavigation}><UserIcon aria-hidden="true" />Compte</a
									>
								{/snippet}
							</DropdownMenu.Item>
							<DropdownMenu.Item>
								{#snippet child({ props })}
									<a
										{...props}
										href={resolve('/enseignant/applications')}
										aria-current={active === 'applications' ? 'page' : undefined}
										onclick={closeNavigation}><PlugIcon aria-hidden="true" />Applications connectées</a
									>
								{/snippet}
							</DropdownMenu.Item>
						</DropdownMenu.Group>
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.Item disabled={signingOut} onSelect={signOut}
								><LogOutIcon aria-hidden="true" />{signingOut ? 'Déconnexion…' : 'Se déconnecter'}</DropdownMenu.Item
							>
						</DropdownMenu.Group>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
		{#if signOutFailed && inlineSignOutVisible}
			<Alert.Root bind:ref={signOutSummary} tabindex={-1}>
				<Alert.Title>Déconnexion non aboutie</Alert.Title>
				<Alert.Description
					>La déconnexion n’a pas pu être confirmée. Réessayez depuis le menu utilisateur.</Alert.Description
				>
			</Alert.Root>
		{/if}
	</Sidebar.Footer>
</Sidebar.Root>
