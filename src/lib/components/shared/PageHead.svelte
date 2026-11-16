<script lang="ts">
	let {
		title,
		description,
		publicContent = false
	}: {
		title: string;
		description: string;
		publicContent?: boolean;
	} = $props();
	const pageTitle = $derived(`${title} · Campus`);
	const shareTitle = $derived(publicContent ? pageTitle : 'Campus');
	const shareDescription = $derived(
		publicContent ? description : 'Préparer, évaluer et partager les cours avec Campus.'
	);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={description} />
	<meta property="og:title" content={shareTitle} />
	<meta property="og:description" content={shareDescription} />
	<meta name="twitter:title" content={shareTitle} />
	<meta name="twitter:description" content={shareDescription} />
</svelte:head>
