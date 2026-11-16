<script lang="ts">
	import type { EditorData } from '#lib/teaching/types.js';
	import ModuleDraftEditor from './ModuleDraftEditor.svelte';
	let { data }: { data: EditorData } = $props();
</script>

{#key data.module?.id ?? 'new-module'}
	<ModuleDraftEditor {data} />
{/key}
