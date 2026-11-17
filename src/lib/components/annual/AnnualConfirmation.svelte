<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { notify } from '#lib/client/notifications.js';
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
	import AnnualModuleChoice from './AnnualModuleChoice.svelte';
	import AnnualSummary from './AnnualSummary.svelte';
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
				pdfsKept: false,
				moduleChoices: [
					...new Map(
						reviewed.contexts.map((context) => [
							context.moduleId,
							{ moduleId: context.moduleId, decision: 'pause' as const }
						])
					).values()
				]
			},
			zod4Client(annualActionSchema)
		),
		{
			id: `annual-purge-${reviewed.academicYear}`,
			dataType: 'json',
			validators: zod4Client(annualActionSchema),
			applyAction: 'never',
			invalidateAll: false,
			resetForm: false,
			taintedMessage: false
		}
	);
	const { form: purgeData, errors: purgeErrors, allErrors } = purgeForm;
	const locked = $derived(pending || blocked || retryCommand !== null);
	const moduleSettings = $derived([
		...new Map(($purgeData.moduleChoices ?? []).map((choice) => [choice.moduleId, choice])).values()
	]);
	const continuingCount = $derived(moduleSettings.filter((choice) => choice.decision === 'continue').length);
	const pausedCount = $derived(moduleSettings.filter((choice) => choice.decision === 'pause').length);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (pending || blocked) return;
		if (retryCommand) {
			await onRetry();
			return;
		}
		const validated = await purgeForm.validateForm({ update: true, focusOnError: false });
		if (!validated.valid) {
			notify('Vérifiez les champs indiqués avant de clôturer l’année.', 'error');
			await tick();
			const id = validated.errors.nextAcademicYear?.length
				? 'annual-next-year'
				: validated.errors.pdfsKept?.length
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
				nextAcademicYear: fields.nextAcademicYear ? [fields.nextAcademicYear] : undefined,
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
			<AlertDialog.Title>Clôturer l’année {reviewed.academicYear} ?</AlertDialog.Title>
			<AlertDialog.Description>
				Cette suppression est définitive. Les PDF conservés ne restaurent ni les critères, ni les remises, ni les
				commentaires privés.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<form method="POST" onsubmit={submit} novalidate class="flex min-w-0 flex-col gap-fields" aria-busy={pending}>
			<AnnualSummary preview={reviewed} closing idPrefix="annual-confirmation" title="Conséquences de la clôture" />
			<div class="annual-continuation flex min-w-0 flex-col gap-2">
				<h3 id="annual-confirmation-details-title" class="font-medium">
					{moduleSettings.length === 0
						? 'Aucun module à reprendre'
						: moduleSettings.length === 1
							? 'Choisir le devenir du module'
							: `Choisir le devenir de chacun des ${moduleSettings.length} modules`}
				</h3>
				<p aria-live="polite" class="tabular-nums">
					Réglages à vérifier : {continuingCount} à reprendre, {pausedCount} à mettre de côté.
				</p>
				<p class="text-muted-foreground">La mise de côté est préremplie ; vérifiez chaque module ci-dessous.</p>
				<dl class="flex min-w-0 flex-col gap-2">
					<div>
						<dt class="font-medium">Reprendre</dt>
						<dd class="text-muted-foreground">
							Garde les identités publiques et crée une promotion vide, sans étudiants, notes, planning ni échéances
							copiés. L’ancien contenu publié et ses anciennes dates restent visibles jusqu’à une nouvelle publication
							manuelle.
						</dd>
					</div>
					<div>
						<dt class="font-medium">Mettre de côté</dt>
						<dd class="text-muted-foreground">
							Garde le module privé et désactive son ancien lien public. L’annuaire de classe reste seulement si un
							module est repris.
						</dd>
					</div>
				</dl>
			</div>
			<Field.FieldGroup>
				<Form.Field form={purgeForm} name="nextAcademicYear">
					<Form.Control id="annual-next-year"
						>{#snippet children({ props })}<Form.Label
								>Année de reprise{continuingCount === 0 ? ' (optionnel)' : ''}</Form.Label
							><Input
								{...props}
								bind:value={$purgeData.nextAcademicYear}
								required={continuingCount > 0}
								aria-required={continuingCount > 0 || undefined}
								placeholder="2027-2028"
								disabled={locked}
							/>{/snippet}</Form.Control
					>
					<Form.Description
						>Aucune date de clôture automatique. Les nouvelles classes seront vides et les calendriers à renseigner.</Form.Description
					><Form.FieldErrors />
				</Form.Field>
				{#each $purgeData.moduleChoices ?? [] as choice, index (choice.moduleId)}
					<AnnualModuleChoice
						form={purgeForm}
						{index}
						moduleId={choice.moduleId}
						title={reviewed.contexts.find((context) => context.moduleId === choice.moduleId)?.moduleTitle ?? 'Module'}
						disabled={locked}
					/>
				{/each}
				<Field.Field data-invalid={!!$purgeErrors.pdfsKept?.length} data-disabled={locked}>
					<Form.Field form={purgeForm} name="pdfsKept">
						<Form.Control id="annual-pdfs-kept">
							{#snippet children({ props })}
								<div class="flex min-h-11 items-center gap-3">
									<Checkbox
										{...props}
										bind:checked={$purgeData.pdfsKept}
										required
										aria-required="true"
										disabled={locked}
									/>
									<Form.Label class="min-h-11 flex-1 items-center"
										>J’ai conservé les PDF nécessaires pour {reviewed.academicYear}.</Form.Label
									>
								</div>
							{/snippet}
						</Form.Control>
						<Form.Description>Seuls les fichiers que vous avez conservés restent entre vos mains.</Form.Description>
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
									required
									aria-required="true"
									maxlength={9}
									autocomplete="off"
									spellcheck={false}
									class="min-h-11"
									disabled={locked}
								/>
							{/snippet}
						</Form.Control>
						<Form.Description>Saisissez exactement « {reviewed.academicYear} », avec le tiret.</Form.Description>
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
								: 'Clôture non enregistrée'}</Alert.Title
					>
					<Alert.Description class="flex flex-col gap-3">
						<p>{errorMessage}</p>
						{#if retryCommand}<p>
								La même demande sera renvoyée pour vérifier son résultat sans répéter une purge déjà réussie.
							</p>{/if}
						{#if blocked}<Button variant="outline" class="min-h-11" disabled={pending} onclick={onReload}
								>Actualiser le dossier</Button
							>{/if}
					</Alert.Description>
				</Alert.Root>
			{/if}
			{#if $allErrors.some((entry) => entry.path !== 'typedYear' && entry.path !== 'pdfsKept')}
				<p role="alert" class="text-sm text-destructive">
					Vérifiez l’année de reprise et le choix de chaque module avant de confirmer.
				</p>
			{/if}
			<p role="status" class="sr-only">
				{pending ? `Purge de l’année ${reviewed.academicYear} en cours…` : ''}
			</p>
			<AlertDialog.Footer>
				<Button variant="outline" class="min-h-11" disabled={pending} onclick={onClose}>Annuler</Button>
				<Button type="submit" variant="destructive" class="min-h-11" disabled={pending || blocked}>
					{#if pending}<Spinner data-icon="inline-start" />{:else}<Trash2Icon data-icon="inline-start" />{/if}
					{pending ? 'Purge en cours…' : retryCommand ? 'Réessayer la même purge' : `Clôturer ${reviewed.academicYear}`}
				</Button>
			</AlertDialog.Footer>
		</form>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	.annual-continuation {
		padding-block: 1rem;
		border-block: 1px solid var(--border);
	}
	.annual-continuation > dl {
		margin-block-start: 0.5rem;
	}
	@media (min-width: 48rem) {
		.annual-continuation > dl {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 1.5rem;
		}
	}

	@media (pointer: coarse) {
		:global(.annual-confirmation input) {
			font-size: 1rem;
		}
	}
</style>
