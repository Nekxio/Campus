<script lang="ts">
	import { page } from '$app/state';
	import PublicUnavailable from '#lib/components/publication/PublicUnavailable.svelte';
</script>

<PublicUnavailable status={page.status} />
