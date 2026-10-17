<script lang="ts">
	import { page } from '$app/state';
	import ErrorContent from '#lib/components/errors/ErrorContent.svelte';
</script>

<div class="pt-5 pb-6 sm:pt-10">
	<ErrorContent status={page.status} audience="teacher" />
</div>
