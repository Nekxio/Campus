<script lang="ts">
	import { page } from '$app/state';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
</script>

<h1 class="text-3xl font-semibold tracking-tight">
	{page.status === 404 ? 'Élément introuvable' : 'Espace temporairement indisponible'}
</h1>
<Alert.Root class="mt-6"
	><Alert.Title>Les données n’ont pas pu être chargées</Alert.Title><Alert.Description
		>{page.error?.message ?? 'Réessayez dans un instant.'}</Alert.Description
	></Alert.Root
>
<div class="mt-6 flex flex-wrap gap-3">
	<Button onclick={() => window.location.reload()}>Réessayer</Button><Button
		variant="outline"
		href="/">Retour à l’accueil</Button
	>
</div>
