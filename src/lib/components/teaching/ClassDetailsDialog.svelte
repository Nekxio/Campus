<script lang="ts">
	import { untrack } from 'svelte';
	import { z } from 'zod';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { classInputSchema } from '#lib/domain/teaching.js';
	import { saveTeaching, TeachingRequestError } from '#lib/teaching/api.js';
	import type { ClassSummary } from '#lib/teaching/types.js';
	import ClassMutationFeedback from './ClassMutationFeedback.svelte';

	let {
		record,
		onClose,
		onSaved,
		onReload
	}: {
		record: ClassSummary | null;
		onClose: () => void;
		onSaved: (message: string, classId?: string) => Promise<void>;
		onReload: () => Promise<void>;
	} = $props();
	// A draft deliberately retains the record and revision that were opened.
	const original = untrack(() => record);
	let open = $state(true);
	const classSchema = classInputSchema.extend({
		academicYear: z
			.string()
			.refine(
				(value) => classInputSchema.shape.academicYear.safeParse(value).success,
				'Indiquez deux années consécutives, par exemple 2026-2027.'
			)
	});
	const classForm = superForm(
		defaults(
			{
				name: original?.name ?? '',
				academicYear: original?.academicYear ?? ''
			},
			zod4Client(classSchema)
		),
		{
			id: original ? `class-${original.id}` : 'class-new',
			validators: zod4Client(classSchema),
			applyAction: 'never',
			resetForm: false,
			taintedMessage: false
		}
	);
	const { form: classData, errors: classErrors } = classForm;
	const initialYear = untrack(() => $classData.academicYear);
	let pending = $state(false);
	let error = $state.raw<TeachingRequestError | null>(null);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;
		error = null;
		pending = true;
		try {
			const validated = await classForm.validateForm({ update: true });
			if (!validated.valid) return;
			if (original) {
				await saveTeaching(
					`/api/teaching/classes/${original.id}`,
					{
						...validated.data,
						expectedRevision: original.revision
					},
					'PATCH'
				);
				onClose();
				await onSaved('Le nom de la classe a été enregistré.');
			} else {
				const result = await saveTeaching<{ id: string }>('/api/teaching/classes', validated.data);
				onClose();
				await onSaved('La classe a été créée.', result.id);
			}
		} catch (cause) {
			error =
				cause instanceof TeachingRequestError
					? cause
					: new TeachingRequestError(0, 'Enregistrement indisponible. Réessayez.');
			$classErrors = {
				name: error.fields.name ? [error.fields.name] : undefined,
				academicYear: error.fields.academicYear ? [error.fields.academicYear] : undefined
			};
		} finally {
			pending = false;
		}
	}

	async function reload() {
		await onReload();
		onClose();
	}
	let discardOpen = $state(false);
	const dirty = $derived(
		$classData.name !== (original?.name ?? '') || $classData.academicYear !== initialYear
	);
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
		class="max-h-[calc(100dvh-2rem)] overflow-y-auto"
		onEscapeKeydown={(event) => {
			guardClose(event);
		}}
		onInteractOutside={(event) => {
			guardClose(event);
		}}
	>
		<Dialog.Header>
			<Dialog.Title>{original ? 'Modifier la classe' : 'Nouvelle classe'}</Dialog.Title>
			<Dialog.Description>
				{original
					? 'Modifiez le nom de cette classe annuelle.'
					: 'Créez une classe pour une année scolaire, puis ajoutez ses étudiants.'}
			</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={save} class="flex flex-col gap-6" aria-busy={pending}>
			<Field.FieldGroup>
				<Field.Field data-invalid={!!$classErrors.name?.length} data-disabled={pending}>
					<Form.Field form={classForm} name="name">
						<Form.Control id="class-name">
							{#snippet children({ props })}
								<Form.Label>Nom de la classe</Form.Label>
								<Input
									{...props}
									bind:value={$classData.name}
									class="min-h-11"
									maxlength={200}
									disabled={pending}
									oninput={(event) => {
										if ($classErrors.name?.length)
											void classForm.validate('name', {
												value: event.currentTarget.value,
												update: true
											});
									}}
									autocomplete="off"
									placeholder="Ex. B2"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors aria-live="polite" />
					</Form.Field>
				</Field.Field>
				<Field.Field data-invalid={!!$classErrors.academicYear?.length} data-disabled={pending}>
					<Form.Field form={classForm} name="academicYear">
						<Form.Control id="class-year">
							{#snippet children({ props })}
								<Form.Label>Année scolaire</Form.Label>
								<Input
									{...props}
									bind:value={$classData.academicYear}
									class="min-h-11"
									readonly={!!original}
									disabled={pending}
									maxlength={9}
									placeholder="2026-2027"
									oninput={(event) => {
										if ($classErrors.academicYear?.length)
											void classForm.validate('academicYear', {
												value: event.currentTarget.value,
												update: true
											});
									}}
								/>
							{/snippet}
						</Form.Control>
						<Form.Description>
							{original
								? 'L’année reste fixe pour préserver la liste annuelle. Créez une nouvelle classe pour une autre année.'
								: 'Utilisez le format 2026-2027.'}
						</Form.Description>
						<Form.FieldErrors aria-live="polite" />
					</Form.Field>
				</Field.Field>
			</Field.FieldGroup>
			<ClassMutationFeedback {error} {pending} onReload={reload} />
			<p role="status" class="sr-only">{pending ? 'Enregistrement en cours…' : ''}</p>
			<Dialog.Footer>
				<Button variant="outline" class="min-h-11" disabled={pending} onclick={requestClose}
					>Annuler</Button
				>
				<Button type="submit" class="min-h-11" disabled={pending}>
					{pending ? 'Enregistrement…' : original ? 'Enregistrer le nom' : 'Créer la classe'}
				</Button>
			</Dialog.Footer>
		</form>
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
