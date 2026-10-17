<script lang="ts">
	import PlugIcon from '@lucide/svelte/icons/plug';
	import { resolve } from '$app/paths';
	import HomeIcon from '@lucide/svelte/icons/house';
	import BookIcon from '@lucide/svelte/icons/book-open';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PenIcon from '@lucide/svelte/icons/clipboard-pen';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import DotsIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import UserIcon from '@lucide/svelte/icons/user-round';
	import BellIcon from '@lucide/svelte/icons/bell';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { authClient } from '#lib/auth-client.js';
	import { getInitials } from '#lib/profile.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import ThemeSwitcher from './ThemeSwitcher.svelte';

	let {
		userName,
		active = 'home'
	}: {
		userName: string;
		active?: 'home' | 'classes' | 'modules' | 'grading' | 'student-view' | 'applications';
	} = $props();
	const sidebar = Sidebar.useSidebar();
	const initials = $derived(getInitials(userName));
	let signingOut = $state(false);
	let signOutFailed = $state(false);
	let userMenuOpen = $state(false);
	const navigationVisible = $derived(sidebar.isMobile ? sidebar.openMobile : sidebar.open);

	$effect(() => {
		// Reset the portaled menu when navigation hides; a derived open value would reopen it later.
		if (!navigationVisible) userMenuOpen = false;
	});

	async function signOut(event: Event) {
		event.preventDefault();
		if (signingOut) return;
		signingOut = true;
		signOutFailed = false;
		try {
			const result = await authClient.signOut();
			if (result.error) throw new Error('Sign out failed.');
			window.location.assign('/connexion');
		} catch {
			signOutFailed = true;
			signingOut = false;
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

{#snippet identity()}
	<Avatar.Root aria-hidden="true">
		<Avatar.Fallback style="--muted-foreground: var(--foreground)">{initials}</Avatar.Fallback>
	</Avatar.Root>
	<div class="grid min-w-0 flex-1 text-start leading-tight">
		<span class="truncate text-sm font-medium text-foreground">{userName}</span>
		<span
			class="truncate text-xs text-muted-foreground"
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
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton>
					{#snippet child({ props })}
						<a {...props} href={resolve('/')} onclick={closeNavigation}>
							<span class="text-base font-semibold">Coursely</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
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
										href={resolve('/#modules')}
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
										onclick={closeNavigation}
										><UsersIcon aria-hidden="true" /><span>Classes</span></a
									>{/snippet}
							</Sidebar.MenuButton></Sidebar.MenuItem
						>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={active === 'grading'}
								>{#snippet child({ props })}<a
										{...props}
										href={resolve('/enseignant/notation')}
										aria-current={active === 'grading' ? 'page' : undefined}
										onclick={closeNavigation}><PenIcon aria-hidden="true" /><span>Notation</span></a
									>{/snippet}</Sidebar.MenuButton
							></Sidebar.MenuItem
						>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active === 'student-view'}>
								{#snippet child({ props })}
									<a
										{...props}
										href={resolve('/enseignant/vue-etudiante')}
										target="_blank"
										rel="noopener noreferrer"
										aria-current={active === 'student-view' ? 'page' : undefined}
										onclick={closeNavigation}
									>
										<ExternalLinkIcon aria-hidden="true" /><span>Vue étudiante</span>
										<span class="sr-only"> · nouvel onglet</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					</Sidebar.Menu>
				</nav>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer class="gap-3">
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<DropdownMenu.Root bind:open={userMenuOpen}>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Sidebar.MenuButton
								{...props}
								size="lg"
								aria-label={`Menu utilisateur de ${userName}`}
							>
								{@render identity()}
								<DotsIcon aria-hidden="true" />
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
								<div class="flex items-center gap-2 px-3 py-2.5">{@render identity()}</div>
							</DropdownMenu.Label>
							<DropdownMenu.Label>Compte et notifications à venir</DropdownMenu.Label>
						</DropdownMenu.Group>
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.Item disabled><UserIcon aria-hidden="true" />Compte</DropdownMenu.Item>
							<DropdownMenu.Item disabled
								><BellIcon aria-hidden="true" />Notifications</DropdownMenu.Item
							>
						</DropdownMenu.Group>
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.Item disabled={signingOut} onSelect={signOut}
								><LogOutIcon aria-hidden="true" />{signingOut
									? 'Déconnexion…'
									: 'Se déconnecter'}</DropdownMenu.Item
							>
						</DropdownMenu.Group>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
		<Sidebar.Menu
			><Sidebar.MenuItem
				><Sidebar.MenuButton isActive={active === 'applications'}
					>{#snippet child({ props })}<a
							{...props}
							href={resolve('/enseignant/applications')}
							aria-current={active === 'applications' ? 'page' : undefined}
							onclick={closeNavigation}
							><PlugIcon aria-hidden="true" /><span>Applications connectées</span></a
						>{/snippet}</Sidebar.MenuButton
				></Sidebar.MenuItem
			></Sidebar.Menu
		>
		<ThemeSwitcher />
		{#if signOutFailed}
			<Alert.Root>
				<Alert.Title>Déconnexion non aboutie</Alert.Title>
				<Alert.Description>Réessayez depuis le menu utilisateur.</Alert.Description>
			</Alert.Root>
		{/if}
	</Sidebar.Footer>
</Sidebar.Root>
