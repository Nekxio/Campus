// The room answers these frames without waking its hibernating Durable Object.
// Keep intermediary idle timeouts from interrupting students while they read.
export const quizSocketHeartbeatIntervalMs = 20_000;
export const quizSocketHeartbeatTimeoutMs = 15_000;
export const isQuizSocketHeartbeat = (value: unknown): boolean => value === 'pong';

type HeartbeatSocket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'addEventListener' | 'removeEventListener'>;

export const startQuizSocketHeartbeat = (
	socket: HeartbeatSocket,
	onInterrupted: () => void = () => {}
): (() => void) => {
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const receive = (event: Event) => {
		if (isQuizSocketHeartbeat((event as MessageEvent).data)) {
			clearTimeout(deadline);
			deadline = undefined;
		}
	};
	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		clearTimeout(deadline);
		socket.removeEventListener('message', receive);
		socket.removeEventListener('close', stop);
		socket.removeEventListener('error', interrupt);
	};
	const interrupt = () => {
		if (stopped) return;
		stop();
		try {
			socket.close(3001, 'Heartbeat interrupted');
		} catch {
			// Recovery must also run if the browser can no longer close this transport.
		} finally {
			// Do not wait for a close handshake on a transport that may be blackholed.
			onInterrupted();
		}
	};
	const timer = setInterval(() => {
		// Numeric ready states also work when WebSocket is not a global (SSR/tests).
		if (socket.readyState === 1) {
			try {
				deadline = setTimeout(interrupt, quizSocketHeartbeatTimeoutMs);
				socket.send('ping');
			} catch {
				interrupt();
			}
		} else if (socket.readyState > 1) stop();
	}, quizSocketHeartbeatIntervalMs);
	socket.addEventListener('close', stop);
	socket.addEventListener('error', interrupt);
	socket.addEventListener('message', receive);
	return stop;
};
