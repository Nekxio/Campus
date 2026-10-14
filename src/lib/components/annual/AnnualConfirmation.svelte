<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import { annualActionSchema, type AnnualAction, type AnnualPreview } from '#lib/domain/annual.js';

	let {
		preview,
		pending,
		blocked,
		errorMessage,
		retryCommand,
		onConfirm,
		onRetry,
		onReload,
		onClose
	}: {
		preview: AnnualPreview;
		pending: boolean;
		blocked: boolean;
		errorMessage: string;
		retryCommand: AnnualAction | null;
		onConfirm: (command: AnnualAction) => Promise<Record<string, string> | null>;
		onRetry: () => Promise<Record<string, string> | null>;
		onReload: () => Promise<void>;
		onClose: () => void;
	} = $props();
	// Confirmation always retains the scope that the teacher opened.
	const reviewed = untrack(() => preview);
	let open = $state(true);
	const purgeForm = superForm<AnnualAction>(
		defaults(
			{
				academicYear: reviewed.academicYear,
				action: 'purge',
				reviewToken: reviewed.reviewToken,
				requestId: '00000000-0000-4000-8000-000000000000',
				typedYear: '',
				pdfsKept: false
			},
			zod4Client(annualActionSchema)
		),
		{
			id: `annual-purge-${reviewed.academicYear}`,
			validators: zod4Client(annualActionSchema),
			applyAction: 'never',
			resetForm: false,
			taintedMessage: false
		}
	);
	const { form: purgeData, errors: purgeErrors, allErrors } = purgeForm;
	const locked = $derived(pending || blocked || retryCommand !== null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (pending || blocked) return;
		if (retryCommand) {
			await onRetry();
			return;
		}
		const validated = await purgeForm.validateForm({ update: true, focusOnError: false });
		if (!validated.valid) {
			await tick();
			const id = validated.errors.pdfsKept?.length
				? 'annual-pdfs-kept'
				: validated.errors.typedYear?.length
					? 'annual-typed-year'
					: null;
			if (id) document.getElementById(id)?.focus();
			return;
		}
		const command = annualActionSchema.parse({
			...validated.data,
			academicYear: reviewed.academicYear,
			action: 'purge',
			reviewToken: reviewed.reviewToken,
			requestId: crypto.randomUUID()
		});
		const fields = await onConfirm(command);
		if (fields)
			$purgeErrors = {
				typedYear: fields.typedYear ? [fields.typedYear] : undefined,
				pdfsKept: fields.pdfsKept ? [fields.pdfsKept] : undefined
			};
	}
</script>

<AlertDialog.Root
	bind:open
	onOpenChange={(value) => {
		if (!value && !pending) onClose();
	}}
>
	<AlertDialog.Content
		class="annual-confirmation max-h-[calc(100dvh-2rem)] overflow-y-auto"
		onEscapeKeydown={(event) => {
			if (pending) event.preventDefault();
		}}
	>
		<AlertDialog.Header>
			<AlertDialog.Title>Purger l’année {reviewed.academicYear} ?</AlertDialog.Title>
			<AlertDialog.Description>
				Cette suppression est définitive. Les PDF conservés ne restaurent ni les critères, ni les
				remises, ni les commentaires privés.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<form onsubmit={submit} class="flex min-w-0 flex-col gap-5" aria-busy={pending}>
			<div class="flex min-w-0 flex-col gap-4">
				<div>
					<h3 class="text-sm font-semibold">Données supprimées pour {reviewed.academicYear}</h3>
					<dl class="mt-2 flex flex-col gap-2 text-sm">
						<div class="flex flex-wrap justify-between gap-x-4 gap-y-1">
							<dt>Classes</dt>
							<dd class="tabular-nums">{reviewed.removed.classes}</dd>
						</div>
						{#each reviewed.classes as item (item.id)}
							<div class="flex flex-wrap justify-between gap-x-4 gap-y-1 text-muted-foreground">
								<dt class="min-w-0 wrap-anywhere">{item.name}</dt>
								<dd class="tabular-nums">{item.studentCount} étudiants</dd>
							</div>
						{/each}
						<div class="flex flex-wrap justify-between gap-x-4 gap-y-1">
							<dt>Étudiants</dt>
							<dd class="tabular-nums">{reviewed.removed.students}</dd>
						</div>
						<div class="flex flex-wrap justify-between gap-x-4 gap-y-1">
							<dt>Corrections et remises</dt>
							<dd class="tabular-nums">{reviewed.removed.corrections}</dd>
						</div>
						<div class="flex flex-wrap justify-between gap-x-4 gap-y-1">
							<dt>Saisies de points par critère</dt>
							<dd class="tabular-nums">{reviewed.removed.scores}</dd>
						</div>
						<div class="flex flex-wrap justify-between gap-x-4 gap-y-1">
							<dt>Commentaires privés</dt>
							<dd class="tabular-nums">{reviewed.removed.comments}</dd>
						</div>
						<div class="flex flex-wrap justify-between gap-x-4 gap-y-1">
							<dt>Propositions de correction</dt>
							<dd class="tabular-nums">{reviewed.removed.proposals}</dd>
						</div>
						<div class="flex flex-wrap justify-between gap-x-4 gap-y-1">
							<dt>Décisions de propositions</dt>
							<dd class="tabular-nums">{reviewed.removed.decisions}</dd>
						</div>
					</dl>
					<p class="mt-2 text-sm text-muted-foreground">
						Les liens des classes disparaîtront avec les données étudiantes et leur historique.
					</p>
				</div>
				<div class="border-t pt-4">
					<h3 class="text-sm font-semibold">Données conservées</h3>
					<p class="mt-2 text-sm wrap-anywhere text-muted-foreground">
						{reviewed.preserved.modules} modules, leurs préparations, objectifs, sources, ressources et
						barèmes ;
						{reviewed.preserved.contexts} calendriers avec {reviewed.preserved.lessons} séances et
						{reviewed.preserved.deadlines} échéances ; {reviewed.preserved.publications} pages de module
						publiées.
					</p>
					<p class="mt-2 text-sm text-muted-foreground">
						Vos accès enseignant, passkeys et agent ainsi que les liens Drive restent disponibles.
					</p>
				</div>
			</div>
			<Field.FieldGroup>
				<Field.Field data-invalid={!!$purgeErrors.pdfsKept?.length} data-disabled={locked}>
					<Form.Field form={purgeForm} name="pdfsKept">
						<Form.Control id="annual-pdfs-kept">
							{#snippet children({ props })}
								<div class="flex min-h-11 items-center gap-3">
									<Checkbox {...props} bind:checked={$purgeData.pdfsKept} disabled={locked} />
									<Form.Label class="min-h-11 flex-1 items-center"
										>J’ai conservé les PDF nécessaires pour {reviewed.academicYear}.</Form.Label
									>
								</div>
							{/snippet}
						</Form.Control>
						<Form.Description
							>Seuls les fichiers que vous avez conservés restent entre vos mains.</Form.Description
						>
						<Form.FieldErrors aria-live="polite" />
					</Form.Field>
				</Field.Field>
				<Field.Field data-invalid={!!$purgeErrors.typedYear?.length} data-disabled={locked}>
					<Form.Field form={purgeForm} name="typedYear">
						<Form.Control id="annual-typed-year">
							{#snippet children({ props })}
								<Form.Label>Recopiez l’année {reviewed.academicYear}</Form.Label>
								<Input
									{...props}
									bind:value={$purgeData.typedYear}
									maxlength={9}
									autocomplete="off"
									spellcheck={false}
									class="min-h-11"
									disabled={locked}
								/>
							{/snippet}
						</Form.Control>
						<Form.Description
							>Saisissez exactement « {reviewed.academicYear} », avec le tiret.</Form.Description
						>
						<Form.FieldErrors aria-live="polite" />
					</Form.Field>
				</Field.Field>
			</Field.FieldGroup>
			{#if errorMessage || blocked || retryCommand}
				<Alert.Root variant="destructive">
					<CircleAlertIcon aria-hidden="true" />
					<Alert.Title
						>{blocked
							? 'Le dossier doit être actualisé'
							: retryCommand
								? 'Résultat à vérifier'
								: 'Purge non enregistrée'}</Alert.Title
					>
					<Alert.Description class="flex flex-col gap-3">
						<p>{errorMessage}</p>
						{#if retryCommand}<p>
								La même demande sera renvoyée pour vérifier son résultat sans répéter une purge déjà
								réussie.
							</p>{/if}
						{#if blocked}<Button
								variant="outline"
								class="min-h-11"
								disabled={pending}
								onclick={onReload}>Actualiser le dossier</Button
							>{/if}
					</Alert.Description>
				</Alert.Root>
			{/if}
			{#if $allErrors.some((entry) => entry.path !== 'typedYear' && entry.path !== 'pdfsKept')}
				<p role="alert" class="text-sm text-destructive">
					Les références de l’année ne sont plus valides. Actualisez le dossier avant une nouvelle
					confirmation.
				</p>
			{/if}
			<p role="status" class="sr-only">
				{pending ? `Purge de l’année ${reviewed.academicYear} en cours…` : ''}
			</p>
			<AlertDialog.Footer>
				<Button variant="outline" class="min-h-11" disabled={pending} onclick={onClose}
					>Annuler</Button
				>
				<Button type="submit" variant="destructive" class="min-h-11" disabled={pending || blocked}>
					{#if pending}<Spinner data-icon="inline-start" />{:else}<Trash2Icon
							data-icon="inline-start"
						/>{/if}
					{pending
						? 'Purge en cours…'
						: retryCommand
							? 'Réessayer la même purge'
							: `Purger ${reviewed.academicYear}`}
				</Button>
			</AlertDialog.Footer>
		</form>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	@media (pointer: coarse) {
		:global(.annual-confirmation input) {
			font-size: 1rem;
		}
	}
</style>
