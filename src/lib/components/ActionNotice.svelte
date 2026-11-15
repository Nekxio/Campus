<script lang="ts">
	import { notify, dismissNotification, type NotificationKind } from '#lib/client/notifications.js';

	let {
		message,
		kind = 'success',
		duration,
		dismissOnClear = false
	}: {
		message: string;
		kind?: NotificationKind;
		duration?: number;
		dismissOnClear?: boolean;
	} = $props();
	const id = $props.id();

	// Synchronize an existing action result with Sonner, without replaying it on unrelated renders.
	// Confirmations survive navigation; only explicitly scoped notices opt into cleanup.
	$effect(() => {
		notify(message, kind, id, { duration });
		if (dismissOnClear) return () => dismissNotification(id);
		return undefined;
	});
</script>
