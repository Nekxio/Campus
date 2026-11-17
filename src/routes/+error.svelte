<script lang="ts">
	import { page } from '$app/state';
	import PublicUnavailable from '#lib/components/publication/PublicUnavailable.svelte';
	const teacher = $derived(/^\/(?:$|(?:enseignant|connexion|activation|autoriser)(?:\/|$))/.test(page.url.pathname));
</script>

<PublicUnavailable status={page.status} audience={teacher ? 'teacher' : 'general'} />
