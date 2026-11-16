<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { notify } from '#lib/client/notifications.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import { currentAcademicYear } from '#lib/domain/academic-year.js';
	import type { CalendarCommand, CalendarSettings } from '#lib/domain/calendar-subscription.js';

	type Mapping = Extract<CalendarCommand, { action: 'connect' }>['mappings'][number];
	let {
		settings,
		busy,
		onconnect,
		onchange
	}: {
		settings: CalendarSettings;
		busy: boolean;
		onconnect: (mappings: Mapping[]) => Promise<void>;
		onchange?: (dirty: boolean) => void;
	} = $props();
	const courses = $derived([...new Set(settings.connection?.events.map((event) => event.course) ?? [])]);
	const availableContexts = $derived.by(() => {
		const currentYear = currentAcademicYear();
		return settings.contexts.filter((context) => context.academicYear === currentYear);
	});
	let choices = $state<Mapping[]>(untrack(() => courses.map((course) => ({ course, contextId: '', adoptions: [] }))));
	const selected = $derived(
		choices.filter((choice) => availableContexts.some((context) => context.id === choice.contextId))
	);
	let attempted = $state(false);
	let controls = $state<HTMLDivElement | null>(null);
	const candidateLessons = (contextId: string, startsAt: string, endsAt: string) =>
		settings.contexts
			.find((context) => context.id === contextId)
			?.lessons.filter(
				(lesson) =>
					new Date(lesson.startsAt).getTime() === new Date(startsAt).getTime() &&
					new Date(lesson.endsAt).getTime() === new Date(endsAt).getTime()
			) ?? [];
	const unresolved = $derived(
		selected.some((choice) =>
			settings.connection?.events.some(
				(event) =>
					event.course === choice.course &&
					!event.cancelled &&
					candidateLessons(choice.contextId, event.startsAt, event.endsAt).length > 0 &&
					!choice.adoptions.some((item) => item.key === event.key)
			)
		)
	);
	const connect = async () => {
		if (busy) return;
		attempted = true;
		if (!selected.length || unresolved) {
			notify(
				!selected.length
					? 'Choisissez au moins un cours à importer.'
					: 'Choisissez les séances existantes signalées avant de connecter le calendrier.',
				'error'
			);
			await tick();
			controls?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
			return;
		}
		await onconnect(selected);
	};
	const updateContext = (course: string, contextId: string) => {
		choices = choices.map((choice) => (choice.course === course ? { ...choice, contextId, adoptions: [] } : choice));
		onchange?.(choices.some((choice) => Boolean(choice.contextId)));
	};
	const updateAdoption = (course: string, key: string, lessonId: string) => {
		choices = choices.map((choice) =>
			choice.course === course
				? {
						...choice,
						adoptions: [
							...choice.adoptions.filter((item) => item.key !== key),
							...(lessonId ? [{ key, lessonId }] : [])
						]
					}
				: choice
		);
		onchange?.(choices.some((choice) => Boolean(choice.contextId)));
	};
</script>

{#snippet connectAction()}
	<Button
		type="button"
		class="ms-auto min-h-11"
		disabled={busy || !choices.length || !availableContexts.length}
		onclick={connect}
	>
		{busy ? 'Connexion en cours…' : 'Connecter les cours sélectionnés'}
	</Button>
{/snippet}

<div class="flex min-w-0 flex-col gap-6" bind:this={controls}>
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div class="min-w-0 flex-1 basis-56">
			<h3 class="item-title">Associer les cours</h3>
			<p class="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
				Choisissez le module et la classe pour chaque cours à afficher. Les cours laissés sans association ne seront pas
				importés.
			</p>
		</div>
		{@render connectAction()}
	</header>
	{#if !availableContexts.length}
		<p class="text-sm text-muted-foreground">
			Associez d’abord une classe de l’année en cours à votre module dans « Classe et planning », puis revenez ici.
		</p>
	{/if}
	{#if !choices.length}<p class="text-sm text-muted-foreground">
			Aucune séance exploitable dans cet aperçu. Aucun cours ne sera importé.
		</p>{/if}
	{#each choices as choice, index (choice.course)}
		{@const events =
			settings.connection?.events.filter((event) => event.course === choice.course && !event.cancelled) ?? []}
		<fieldset class="min-w-0">
			<legend class="max-w-full text-sm font-semibold wrap-anywhere">{choice.course}</legend>
			<p class="mt-2 text-sm text-muted-foreground">
				{events.length} séance{events.length > 1 ? 's' : ''} dans l’aperçu
			</p>
			<div class="mt-3 flex min-w-0 flex-col gap-2">
				<label for={`calendar-course-${index}`} class="text-sm font-medium"
					>Module Campus pour {choice.course} (optionnel)</label
				>
				<NativeSelect.Root
					id={`calendar-course-${index}`}
					value={choice.contextId}
					aria-invalid={attempted && !selected.length ? true : undefined}
					aria-describedby={attempted && !selected.length ? 'calendar-mapping-error' : undefined}
					class="w-full"
					disabled={busy}
					onchange={(event) => updateContext(choice.course, event.currentTarget.value)}
				>
					<NativeSelect.Option value="">Ne pas importer ce cours</NativeSelect.Option>
					{#each availableContexts as context (context.id)}
						<NativeSelect.Option value={context.id}>{context.label}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>
			{#if choice.contextId}
				<p class="mt-2 text-sm wrap-anywhere text-muted-foreground">
					{settings.contexts.find((context) => context.id === choice.contextId)?.label}
				</p>
				<div class="mt-4 flex min-w-0 flex-col gap-4">
					{#each events as event, eventIndex (event.key)}
						{@const candidates = candidateLessons(choice.contextId, event.startsAt, event.endsAt)}
						<div class="min-w-0 text-sm">
							<p class="wrap-anywhere">{formatLessonDate(event.startsAt)} · {event.title}</p>
							{#if candidates.length}
								<label for={`calendar-adopt-${index}-${eventIndex}`} class="mt-2 block font-medium"
									>Séance existante pour {event.title}</label
								>
								<p id={`calendar-adopt-help-${index}-${eventIndex}`} class="my-2 text-muted-foreground">
									Une séance existe au même horaire. Choisissez-la pour conserver sa préparation et éviter un doublon.
								</p>
								<NativeSelect.Root
									id={`calendar-adopt-${index}-${eventIndex}`}
									value={choice.adoptions.find((item) => item.key === event.key)?.lessonId ?? ''}
									aria-describedby={`calendar-adopt-help-${index}-${eventIndex}${
										attempted && !choice.adoptions.some((item) => item.key === event.key)
											? ` calendar-adopt-error-${index}-${eventIndex}`
											: ''
									}`}
									aria-required="true"
									aria-invalid={attempted && !choice.adoptions.some((item) => item.key === event.key)
										? true
										: undefined}
									class="w-full"
									disabled={busy}
									onchange={(change) => updateAdoption(choice.course, event.key, change.currentTarget.value)}
								>
									<NativeSelect.Option value="">Choisir la séance existante</NativeSelect.Option>
									{#each candidates as lesson (lesson.id)}<NativeSelect.Option value={lesson.id}
											>{lesson.title}</NativeSelect.Option
										>{/each}
								</NativeSelect.Root>
								{#if attempted && !choice.adoptions.some((item) => item.key === event.key)}
									<p id={`calendar-adopt-error-${index}-${eventIndex}`} class="mt-2 text-destructive" role="alert">
										Choisissez une séance existante.
									</p>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</fieldset>
	{/each}
	<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
		L’école gérera les horaires et les intitulés des séances importées. Votre préparation sera conservée. Aucune
		publication étudiante ne sera modifiée.
	</p>
	{#if attempted && !selected.length}
		<p id="calendar-mapping-error" role="alert" class="text-sm text-destructive">
			Choisissez au moins un cours à importer.
		</p>
	{/if}
	{#if unresolved}<p class="text-sm text-muted-foreground">
			Choisissez les séances existantes signalées avant de connecter le calendrier.
		</p>{/if}
	{@render connectAction()}
</div>
