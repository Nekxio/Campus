<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { notify } from '#lib/client/notifications.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';

	let {
		dirty,
		pending = false,
		title,
		description
	}: {
		dirty: boolean;
		pending?: boolean;
		title: string;
		description: string;
	} = $props();
	let confirmOpen = $state(false);
	let allowNavigation = false;
	let destination: ResolvedPathname | undefined;
	let historyDelta: number | undefined;
	const resetNavigation = () => {
		allowNavigation = false;
	};

	beforeNavigate((navigation) => {
		if (allowNavigation) {
			void navigation.complete.then(resetNavigation, resetNavigation);
			return;
		}
		if (!dirty && !pending) return;
		if (
			!navigation.willUnload &&
			navigation.to?.url.pathname === navigation.from?.url.pathname &&
			navigation.to?.url.search === navigation.from?.url.search
		)
			return;
		navigation.cancel();
		if (navigation.willUnload || !navigation.to) return;
		destination = (navigation.to.url.pathname + navigation.to.url.search + navigation.to.url.hash) as ResolvedPathname;
		historyDelta = navigation.type === 'popstate' ? navigation.delta : undefined;
		confirmOpen = true;
	});

	const confirmDiscard = async () => {
		if (pending || !destination) return;
		allowNavigation = true;
		if (historyDelta) {
			window.history.go(historyDelta);
			return;
		}
		try {
			await goto(destination);
		} catch {
			notify('La page est indisponible. Vos saisies sont conservées ; réessayez.', 'error');
		} finally {
			resetNavigation();
		}
	};
</script>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description>
				{pending
					? 'Une opération est en cours. Attendez sa réponse avant de quitter cette page.'
					: dirty
						? description
						: 'Vous pouvez maintenant quitter cette page.'}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Continuer à modifier</AlertDialog.Cancel>
			<AlertDialog.Action disabled={pending} onclick={confirmDiscard}
				>{dirty ? 'Quitter sans enregistrer' : 'Quitter la page'}</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
