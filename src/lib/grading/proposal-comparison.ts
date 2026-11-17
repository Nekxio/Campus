export function proposedPointsDiffer(recorded: number | null, proposed: number | null | undefined): boolean {
	return proposed !== undefined && proposed !== recorded;
}

export function proposedCommentDiffers(recorded: string, proposed: string | undefined): boolean {
	return proposed !== undefined && proposed !== recorded;
}
