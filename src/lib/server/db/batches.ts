// Keep statements below 1,000 bound values even for the widest teaching rows.
export function batches<T>(rows: readonly T[], size = 100): T[][] {
	const result: T[][] = [];
	for (let offset = 0; offset < rows.length; offset += size) result.push(rows.slice(offset, offset + size));
	return result;
}
