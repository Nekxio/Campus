<script lang="ts">
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { createDemoStudents, type TeachingModule } from '#lib/demo/teaching.js';
	import { demoGradeError } from '#lib/demo/grade-input.js';

	let { open = $bindable(false), module }: { open?: boolean; module: TeachingModule } = $props();
	let students = $state(createDemoStudents());
	let feedback = $state('');
	function validate() {
		const invalid = students.find((student) => demoGradeError(student.grade, student.absent));
		feedback = invalid
			? `Vérifiez la note de ${invalid.name}.`
			: 'Saisie valide dans cet aperçu. Rien n’est enregistré.';
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content class="w-full overflow-y-auto sm:max-w-xl">
		<Sheet.Header class="gap-3 p-6 pb-4">
			<div class="flex items-center justify-between gap-3 pr-10">
				<Sheet.Title>Aperçu de la notation</Sheet.Title><Badge variant="outline">Démo</Badge>
			</div>
			<Sheet.Description
				>Étudiants fictifs. Les modifications restent dans cet aperçu et sont réinitialisées au
				changement de module ou au rechargement.</Sheet.Description
			>
		</Sheet.Header>
		<div class="flex flex-col gap-6 px-6 pb-6">
			<div>
				<h3 class="text-2xl font-semibold tracking-tight">{module.title}</h3>
				<p class="mt-2 text-muted-foreground">
					{module.className} · extrait de 4 étudiants · évaluation sur 20
				</p>
			</div>
			<p class="text-sm leading-relaxed text-muted-foreground">
				Saisissez une note entière. Une case vide reste sans note. Cochez « Absent » pour désactiver
				la saisie.
			</p>
			<Field.FieldGroup>
				{#each students as student (student.id)}
					{@const error = demoGradeError(student.grade, student.absent)}
					<Field.FieldSet class="gap-3 border-b pb-6">
						<Field.FieldLegend variant="label">{student.name}</Field.FieldLegend>
						<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6">
							<Field.Field data-invalid={!!error} data-disabled={student.absent}>
								<Field.FieldLabel for={`grade-${student.id}`}>Note / 20</Field.FieldLabel>
								<Input
									id={`grade-${student.id}`}
									type="text"
									inputmode="numeric"
									pattern="[0-9]*"
									autocomplete="off"
									bind:value={student.grade}
									disabled={student.absent}
									aria-invalid={!!error}
									aria-describedby={error ? `error-${student.id}` : undefined}
									onclick={() => (feedback = '')}
									oninput={() => (feedback = '')}
								/>
							</Field.Field>
							<Field.Field orientation="horizontal">
								<Checkbox
									id={`absent-${student.id}`}
									bind:checked={student.absent}
									onCheckedChange={() => (feedback = '')}
								/>
								<Field.FieldLabel for={`absent-${student.id}`} class="min-h-11 items-center"
									>Absent</Field.FieldLabel
								>
							</Field.Field>
						</div>
						{#if error}<p id={`error-${student.id}`} class="text-sm text-destructive" role="status">
								{error}
							</p>{/if}
					</Field.FieldSet>
				{/each}
			</Field.FieldGroup>
			<p class="min-h-6 text-sm text-muted-foreground" role="status">{feedback}</p>
		</div>
		<Sheet.Footer class="mt-auto gap-3 border-t p-6">
			<Button onclick={validate}>Valider la saisie</Button>
			<Sheet.Close
				>{#snippet child({ props })}<Button variant="outline" {...props}>Fermer l’aperçu</Button
					>{/snippet}</Sheet.Close
			>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
