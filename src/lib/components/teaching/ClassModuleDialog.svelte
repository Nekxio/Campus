<script lang="ts">
	import { untrack } from 'svelte';
	import { z } from 'zod';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { resolve } from '$app/paths';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { saveTeaching, TeachingRequestError } from '#lib/teaching/api.js';
	import type { ClassDetail, ModuleSummary } from '#lib/teaching/types.js';
	import ClassMutationFeedback from './ClassMutationFeedback.svelte';

	let {
		record,
		modules,
		onClose,
		onSaved,
		onReload
	}: {
		record: ClassDetail;
		modules: ModuleSummary[];
		onClose: () => void;
		onSaved: (message: string) => Promise<void>;
		onReload: () => Promise<void>;
	} = $props();
	const original = untrack(() => record);
	const available = untrack(() =>
		modules.filter((module) => !original.modules.some((attached) => attached.id === module.id))
	);
	let open = $state(true);
	const moduleSchema = z.strictObject({
		moduleId: z
			.uuid('Choisissez un module disponible.')
			.refine(
				(id) => available.some((module) => module.id === id),
				'Choisissez un module disponible.'
			)
	});
	const moduleForm = superForm(defaults({ moduleId: '' }, zod4Client(moduleSchema)), {
		id: `class-module-${original.id}`,
		validators: zod4Client(moduleSchema),
		applyAction: 'never',
		resetForm: false,
		taintedMessage: false
	});
	const { form: moduleData, errors: moduleErrors } = moduleForm;
	let pending = $state(false);
	let error = $state.raw<TeachingRequestError | null>(null);
	const chosen = $derived(available.find((module) => module.id === $moduleData.moduleId));

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;
		pending = true;
		error = null;
		try {
			const validated = await moduleForm.validateForm({ update: true });
			if (!validated.valid || !chosen) return;
			await saveTeaching(`/api/teaching/classes/${original.id}/modules`, {
				moduleId: chosen.id,
				moduleRevision: chosen.revision,
				expectedRevision: original.revision
			});
			onClose();
			await onSaved('Le module a été rattaché à la classe.');
		} catch (cause) {
			error =
				cause instanceof TeachingRequestError
					? cause
					: new TeachingRequestError(0, 'Rattachement indisponible. Réessayez.');
			$moduleErrors = { moduleId: error.fields.moduleId ? [error.fields.moduleId] : undefined };
		} finally {
			pending = false;
		}
	}

	async function reload() {
		await onReload();
		onClose();
	}
	let discardOpen = $state(false);
	const dirty = $derived($moduleData.moduleId !== '');
	function requestClose() {
		if (pending) return;
		if (dirty) discardOpen = true;
		else onClose();
	}
	function guardClose(event: Event) {
		if (pending || dirty) {
			event.preventDefault();
			if (!pending) requestClose();
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(value) => {
		if (!value) onClose();
	}}
>
	<Dialog.Content
		showCloseButton={false}
		class="class-module-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto"
		onEscapeKeydown={(event) => {
			guardClose(event);
		}}
		onInteractOutside={(event) => {
			guardClose(event);
		}}
	>
		<Dialog.Header>
			<Dialog.Title>Rattacher un module</Dialog.Title>
			<Dialog.Description class="wrap-anywhere"
				>Associez un module existant à {original.name} · {original.academicYear}. Sa préparation
				reste réutilisable.</Dialog.Description
			>
		</Dialog.Header>
		{#if available.length}
			<form onsubmit={save} class="flex flex-col gap-6" aria-busy={pending}>
				<Field.FieldGroup>
					<Field.Field data-invalid={!!$moduleErrors.moduleId?.length} data-disabled={pending}>
						<Form.Field form={moduleForm} name="moduleId">
							<Form.Control id="class-module">
								{#snippet children({ props })}
									<Form.Label>Module à rattacher</Form.Label>
									<NativeSelect.Root
										{...props}
										bind:value={$moduleData.moduleId}
										onchange={(event) => {
											void moduleForm.validate('moduleId', {
												value: event.currentTarget.value,
												update: true
											});
										}}
										class="w-full"
										disabled={pending}
									>
										<NativeSelect.Option value="" disabled>Choisir un module</NativeSelect.Option>
										{#each available as module (module.id)}<NativeSelect.Option value={module.id}
												>{module.title}</NativeSelect.Option
											>{/each}
									</NativeSelect.Root>
								{/snippet}
							</Form.Control>
							<Form.Description
								>Les modules déjà associés à cette classe ne figurent pas dans cette liste. Un
								module d’une autre classe crée une copie indépendante, sans étudiants, notes ou
								dates. Un module mis de côté est repris en brouillon.</Form.Description
							>
							<Form.FieldErrors aria-live="polite" />
						</Form.Field>
					</Field.Field>
				</Field.FieldGroup>
				<ClassMutationFeedback {error} {pending} onReload={reload} />
				<p role="status" class="sr-only">{pending ? 'Rattachement en cours…' : ''}</p>
				<Dialog.Footer>
					<Button variant="outline" class="min-h-11" disabled={pending} onclick={requestClose}
						>Annuler</Button
					>
					<Button type="submit" class="min-h-11" disabled={pending || !chosen}
						>{pending ? 'Rattachement…' : 'Rattacher le module'}</Button
					>
				</Dialog.Footer>
			</form>
		{:else}
			<p class="text-sm text-muted-foreground">
				{modules.length
					? 'Tous vos modules sont déjà associés à cette classe.'
					: 'Créez votre premier module pour pouvoir l’associer à cette classe.'}
			</p>
			<Dialog.Footer>
				<Button variant="outline" class="min-h-11" onclick={requestClose}>Fermer</Button>
				<Button href={resolve('/enseignant/modules/nouveau')} class="min-h-11"
					>Créer un module</Button
				>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={discardOpen}
	><AlertDialog.Content
		><AlertDialog.Header
			><AlertDialog.Title>Abandonner les modifications ?</AlertDialog.Title><AlertDialog.Description
				>Votre saisie n’est pas enregistrée. Vous pouvez continuer à modifier ou l’abandonner
				explicitement.</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel>Continuer à modifier</AlertDialog.Cancel><AlertDialog.Action
				onclick={onClose}>Abandonner la saisie</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

<style>
	:global(.class-module-dialog [data-slot='native-select']) {
		min-height: 2.75rem;
	}
	@media (max-width: 767px), (pointer: coarse) {
		:global(.class-module-dialog [data-slot='native-select']) {
			font-size: 1rem;
		}
	}
</style>
