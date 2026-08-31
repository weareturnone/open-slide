import config from 'virtual:open-slide/config';
import { AlertTriangle, Check, Loader2, LockKeyhole, RotateCw } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { authoringReadOnly } from '@/lib/authoring';
import type { AuthoringMutationKind } from '@/lib/authoring-protocol';
import {
  assertHostedVersionWritable,
  deployedStudioUrl,
  fetchHostedVersion,
  type HostedOperationReceipt,
  type HostedOperationStatus,
  HostedStudioError,
  waitForHostedDeployment,
  waitForHostedOperation,
} from '@/lib/hosted-deployment';
import {
  dispatchStoredStructuralRequest,
  prepareStoredStructuralRequest,
  type StoredStructuralRequest,
} from '@/lib/hosted-structural-operation';
import { cn } from '@/lib/utils';

type OperationPhase =
  | 'idle'
  | 'restoring'
  | 'saving'
  | 'publishing'
  | 'waiting'
  | 'verifying'
  | 'loading'
  | 'ready'
  | 'delayed'
  | 'failed'
  | 'conflict';

type OperationState = {
  phase: OperationPhase;
  label: string;
  startedAt: number;
  request: StoredStructuralRequest | null;
  receipt: HostedOperationReceipt | null;
  targetSha: string | null;
  destination: string | null;
  message: string | null;
  allowedActions: string[];
};

type StructuralMutationOptions<T extends Record<string, unknown>> = {
  label: string;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  protocolKind?: AuthoringMutationKind;
  body: Record<string, unknown> | ((operationId: string) => Record<string, unknown>);
  onCommitted?: () => void;
  destination?: (result: T, status: HostedOperationStatus) => string | URL | null;
};

type StructuralMutationResult<T> = {
  result: T;
  status: HostedOperationStatus;
};

type DeploymentOptions<T> = {
  label: string;
  action: () => Promise<{ targetSha: string; result: T }>;
  destination?: (result: T, targetSha: string) => string | URL | null;
};

type HostedOperationContextValue = {
  state: OperationState;
  structuralLocked: boolean;
  runStructuralMutation: <T extends Record<string, unknown>>(
    options: StructuralMutationOptions<T>,
  ) => Promise<StructuralMutationResult<T>>;
  runDeployment: <T>(options: DeploymentOptions<T>) => Promise<{ result: T; targetSha: string }>;
  retry: () => Promise<void>;
  dismiss: () => void;
};

export type RunStructuralMutation = HostedOperationContextValue['runStructuralMutation'];

const STORAGE_KEY = 'open-slide:hosted-operation:v1';
const publishConfig = config.authoring?.publish;
const DEPLOYMENT_DELAYED_MESSAGE =
  'The change is saved. Vercel is still deploying it. Keep this tab open; Studio will load it when ready.';

const initialState: OperationState = {
  phase: 'idle',
  label: '',
  startedAt: 0,
  request: null,
  receipt: null,
  targetSha: null,
  destination: null,
  message: null,
  allowedActions: [],
};

const HostedOperationContext = createContext<HostedOperationContextValue | null>(null);

function markDeploymentDelayed(previous: OperationState): OperationState {
  return {
    ...previous,
    phase: 'delayed',
    message: DEPLOYMENT_DELAYED_MESSAGE,
  };
}

function saveSession(state: OperationState) {
  try {
    if (!state.request && !state.receipt && !state.targetSha) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function persistStructuralRequest(state: OperationState) {
  if (!saveSession(state)) {
    throw new Error('Studio could not persist the structural request before dispatch.');
  }
}

function storedRequest(value: unknown): StoredStructuralRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Partial<StoredStructuralRequest>;
  if (
    request.version !== 1 ||
    typeof request.label !== 'string' ||
    typeof request.endpoint !== 'string' ||
    !['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(request.method)) ||
    typeof request.operationId !== 'string' ||
    typeof request.requestHash !== 'string' ||
    typeof request.expectedDraftSha !== 'string' ||
    typeof request.expectedMainSha !== 'string' ||
    !request.body ||
    typeof request.body !== 'object' ||
    Array.isArray(request.body)
  ) {
    return null;
  }
  return request as StoredStructuralRequest;
}

function readSession(): OperationState | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<OperationState>;
    const request = storedRequest(value.request);
    if (
      (!request && !value.receipt?.operationId && typeof value.targetSha !== 'string') ||
      typeof value.label !== 'string'
    )
      return null;
    return {
      phase: 'restoring',
      label: value.label,
      startedAt: Number(value.startedAt) || Date.now(),
      request,
      receipt: value.receipt ?? null,
      targetSha: typeof value.targetSha === 'string' ? value.targetSha : null,
      destination: typeof value.destination === 'string' ? value.destination : null,
      message: null,
      allowedActions: [],
    };
  } catch {
    return null;
  }
}

function phaseFromStatus(state: HostedOperationStatus['state']): OperationPhase {
  if (state === 'publishing') return 'publishing';
  if (state === 'delayed') return 'delayed';
  if (state === 'conflict') return 'conflict';
  if (state === 'ready') return 'verifying';
  return 'waiting';
}

export function HostedOperationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OperationState>(initialState);
  const activeRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const settleReady = useCallback((status: HostedOperationStatus, current: OperationState) => {
    const destination = current.destination
      ? deployedStudioUrl(
          current.destination,
          status.operation.targetMainSha,
          status.operation.operationId,
        ).toString()
      : null;
    const next: OperationState = {
      ...current,
      phase: 'ready',
      destination,
      message: null,
      allowedActions: status.allowedActions,
    };
    activeRef.current = false;
    setState(next);
    saveSession(next);
  }, []);

  const waitForStoredOperation = useCallback(
    async (current: OperationState) => {
      if (!publishConfig || (!current.request && !current.receipt && !current.targetSha)) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let durable = current;
      try {
        if (durable.request && !durable.receipt) {
          const result = await dispatchStoredStructuralRequest<Record<string, unknown>>(
            durable.request,
            (request) => {
              durable = {
                ...durable,
                phase: 'saving',
                request,
                message: null,
                allowedActions: [],
              };
              setState(durable);
              persistStructuralRequest(durable);
            },
          );
          durable = {
            ...durable,
            phase: 'waiting',
            receipt: result.operation,
            targetSha: result.operation.targetMainSha,
            message: null,
            allowedActions: [],
          };
          setState(durable);
          saveSession(durable);
        }
        if (durable.receipt) {
          const status = await waitForHostedOperation(
            publishConfig.statusEndpoint,
            durable.receipt,
            {
              signal: controller.signal,
              onPhase: (phase) => {
                setState((previous) => ({
                  ...previous,
                  phase: phaseFromStatus(phase),
                  allowedActions: phase === 'delayed' ? ['retry-status', 'open-current'] : [],
                }));
              },
            },
          );
          settleReady(status, durable);
          return;
        }
        const targetSha = durable.targetSha;
        if (!targetSha) return;
        await waitForHostedDeployment(publishConfig.statusEndpoint, targetSha, {
          signal: controller.signal,
          onDelayed: () => setState(markDeploymentDelayed),
        });
        const destination = durable.destination
          ? deployedStudioUrl(durable.destination, targetSha).toString()
          : null;
        const ready = {
          ...durable,
          phase: 'ready' as const,
          destination,
          message: null,
          allowedActions: destination ? ['open-current'] : [],
        };
        activeRef.current = false;
        setState(ready);
        saveSession(ready);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        const conflict = error instanceof HostedStudioError && error.code === 'OPERATION_CONFLICT';
        const next: OperationState = {
          ...durable,
          phase: conflict ? 'conflict' : 'failed',
          message: String((error as Error).message ?? error),
          allowedActions:
            error instanceof HostedStudioError
              ? error.allowedActions
              : durable.request && !durable.receipt
                ? ['retry-request', 'open-current']
                : ['retry-status', 'open-current'],
        };
        activeRef.current = false;
        setState(next);
        saveSession(next);
      }
    },
    [settleReady],
  );

  useEffect(() => {
    if (!publishConfig || import.meta.env.DEV) return;
    const currentUrl = new URL(window.location.href);
    const completedId = currentUrl.searchParams.get('studioOperation');
    const completedVersion = currentUrl.searchParams.get('studioVersion');
    const restored = readSession();
    if (!restored) return;
    if (
      completedId === restored.receipt?.operationId ||
      (restored.targetSha && completedVersion === restored.targetSha.slice(0, 12))
    ) {
      saveSession(initialState);
      return;
    }
    activeRef.current = true;
    setState(restored);
    void waitForStoredOperation(restored);
    return () => abortRef.current?.abort();
  }, [waitForStoredOperation]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runStructuralMutation = useCallback(
    async <T extends Record<string, unknown>>(
      options: StructuralMutationOptions<T>,
    ): Promise<StructuralMutationResult<T>> => {
      if (!publishConfig || import.meta.env.DEV) {
        throw new Error('Hosted structural coordination is unavailable');
      }
      if (authoringReadOnly) {
        throw new HostedStudioError(
          { code: 'STUDIO_READ_ONLY', message: 'This preview is read-only.' },
          'This preview is read-only.',
        );
      }
      if (activeRef.current) {
        throw new HostedStudioError(
          {
            code: 'STUDIO_DEPLOYMENT_IN_PROGRESS',
            message: 'Studio is already deploying another change.',
          },
          'Studio is already deploying another change.',
        );
      }

      activeRef.current = true;
      const operationId = crypto.randomUUID();
      const startedAt = Date.now();
      performance.mark('studio-operation-request');
      setState({
        phase: 'saving',
        label: options.label,
        startedAt,
        request: null,
        receipt: null,
        targetSha: null,
        destination: null,
        message: null,
        allowedActions: [],
      });

      let durableState: OperationState | null = null;
      try {
        const version = await fetchHostedVersion(publishConfig.statusEndpoint);
        assertHostedVersionWritable(version);
        const suppliedBody =
          typeof options.body === 'function' ? options.body(operationId) : options.body;
        const request = await prepareStoredStructuralRequest({
          label: options.label,
          endpoint: options.endpoint,
          method: options.method,
          protocolKind: options.protocolKind,
          operationId,
          version,
          body: suppliedBody,
        });
        const result = await dispatchStoredStructuralRequest<T>(request, (stored) => {
          const requesting: OperationState = {
            phase: 'saving',
            label: options.label,
            startedAt,
            request: stored,
            receipt: null,
            targetSha: null,
            destination: null,
            message: null,
            allowedActions: [],
          };
          durableState = requesting;
          setState(requesting);
          persistStructuralRequest(requesting);
        });
        performance.mark('studio-operation-published');
        const pending: OperationState = {
          phase: 'waiting',
          label: options.label,
          startedAt,
          request,
          receipt: result.operation,
          targetSha: result.operation.targetMainSha,
          destination: null,
          message: null,
          allowedActions: [],
        };
        durableState = pending;
        setState(pending);
        saveSession(pending);
        options.onCommitted?.();
        const status = await waitForHostedOperation(
          publishConfig.statusEndpoint,
          result.operation,
          {
            onPhase: (phase) => {
              setState((previous) =>
                phase === 'delayed'
                  ? markDeploymentDelayed(previous)
                  : { ...previous, phase: phaseFromStatus(phase) },
              );
            },
          },
        );
        performance.mark('studio-operation-verified');
        const rawDestination = options.destination?.(result, status) ?? null;
        const destination = rawDestination
          ? deployedStudioUrl(
              rawDestination,
              status.operation.targetMainSha,
              status.operation.operationId,
            ).toString()
          : null;
        const ready: OperationState = {
          ...pending,
          phase: 'ready',
          destination,
          allowedActions: status.allowedActions,
        };
        activeRef.current = false;
        setState(ready);
        saveSession(ready);
        return { result, status };
      } catch (error) {
        const conflict =
          error instanceof HostedStudioError &&
          ['OPERATION_CONFLICT', 'STALE_STUDIO_HEADS', 'OPERATION_ID_REUSED'].includes(error.code);
        const next: OperationState = {
          ...(durableState || initialState),
          phase: conflict ? 'conflict' : 'failed',
          label: options.label,
          startedAt,
          message: String((error as Error).message ?? error),
          allowedActions:
            error instanceof HostedStudioError
              ? error.allowedActions
              : durableState?.request && !durableState.receipt
                ? ['retry-request', 'open-current']
                : ['open-current'],
        };
        activeRef.current = false;
        setState(next);
        saveSession(next);
        throw error;
      }
    },
    [],
  );

  const runDeployment = useCallback(
    async <T,>(options: DeploymentOptions<T>): Promise<{ result: T; targetSha: string }> => {
      if (!publishConfig || import.meta.env.DEV) {
        throw new Error('Hosted deployment coordination is unavailable');
      }
      if (authoringReadOnly) {
        throw new HostedStudioError(
          { code: 'STUDIO_READ_ONLY', message: 'This preview is read-only.' },
          'This preview is read-only.',
        );
      }
      if (activeRef.current) {
        throw new HostedStudioError(
          {
            code: 'STUDIO_DEPLOYMENT_IN_PROGRESS',
            message: 'Studio is already deploying another change.',
          },
          'Studio is already deploying another change.',
        );
      }

      activeRef.current = true;
      const startedAt = Date.now();
      setState({
        ...initialState,
        phase: 'publishing',
        label: options.label,
        startedAt,
      });
      let durableState: OperationState | null = null;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const { targetSha, result } = await options.action();
        const rawDestination = options.destination?.(result, targetSha) ?? null;
        const pending: OperationState = {
          phase: 'waiting',
          label: options.label,
          startedAt,
          request: null,
          receipt: null,
          targetSha,
          destination: rawDestination
            ? new URL(rawDestination, window.location.origin).toString()
            : null,
          message: null,
          allowedActions: [],
        };
        durableState = pending;
        setState(pending);
        saveSession(pending);
        await waitForHostedDeployment(publishConfig.statusEndpoint, targetSha, {
          signal: controller.signal,
          onWaiting: () => setState((previous) => ({ ...previous, phase: 'waiting' })),
          onDelayed: () => setState(markDeploymentDelayed),
        });
        const destination = rawDestination
          ? deployedStudioUrl(rawDestination, targetSha).toString()
          : null;
        const ready: OperationState = {
          ...pending,
          phase: 'ready',
          destination,
          allowedActions: destination ? ['open-current'] : [],
        };
        activeRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
        setState(ready);
        saveSession(ready);
        return { result, targetSha };
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          activeRef.current = false;
          throw error;
        }
        const next: OperationState = {
          ...(durableState || initialState),
          phase: 'failed',
          label: options.label,
          startedAt,
          message: String((error as Error).message ?? error),
          allowedActions:
            error instanceof HostedStudioError ? error.allowedActions : ['open-current'],
        };
        activeRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
        setState(next);
        saveSession(next);
        throw error;
      }
    },
    [],
  );

  const retry = useCallback(async () => {
    if ((!state.request && !state.receipt && !state.targetSha) || activeRef.current) return;
    activeRef.current = true;
    const next = { ...state, phase: 'waiting' as const, message: null };
    setState(next);
    await waitForStoredOperation(next);
  }, [state, waitForStoredOperation]);

  const dismiss = useCallback(() => {
    if (activeRef.current) return;
    setState(initialState);
    saveSession(initialState);
  }, []);

  const value = useMemo<HostedOperationContextValue>(
    () => ({
      state,
      structuralLocked: activeRef.current,
      runStructuralMutation,
      runDeployment,
      retry,
      dismiss,
    }),
    [state, runStructuralMutation, runDeployment, retry, dismiss],
  );

  return (
    <HostedOperationContext.Provider value={value}>{children}</HostedOperationContext.Provider>
  );
}

export function useHostedOperation() {
  const value = useContext(HostedOperationContext);
  if (!value) throw new Error('useHostedOperation must run inside HostedOperationProvider');
  return value;
}

const PHASE_COPY: Record<OperationPhase, string> = {
  idle: '',
  restoring: 'Restoring deployment status',
  saving: 'Saving source to GitHub',
  publishing: 'Publishing the saved change',
  waiting: 'Waiting for Studio deployment',
  verifying: 'Verifying the deployed content',
  loading: 'Loading the deployed version',
  ready: 'The deployed change is ready',
  delayed: 'Deployment is taking longer than expected',
  failed: 'Studio could not finish this change',
  conflict: 'Studio changed before this operation could finish',
};

export function HostedOperationStatusBar({ className }: { className?: string }) {
  const { state, retry, dismiss } = useHostedOperation();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state.phase === 'idle' || !state.startedAt) return;
    const update = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - state.startedAt) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [state.phase, state.startedAt]);

  if (import.meta.env.DEV) return null;
  if (state.phase === 'idle' && authoringReadOnly) {
    return (
      <section
        className={cn(
          'flex min-h-11 flex-wrap items-center gap-3 border-b border-hairline bg-card px-4 py-2 text-[12.5px] md:px-5',
          className,
        )}
        role="status"
      >
        <LockKeyhole className="size-4 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <span className="font-medium">Read-only preview</span>
          <span className="text-muted-foreground"> · Editing controls are disabled</span>
        </div>
      </section>
    );
  }
  if (state.phase === 'idle') return null;
  const terminal = ['ready', 'failed', 'conflict'].includes(state.phase);
  const alert = ['failed', 'conflict'].includes(state.phase);
  return (
    <section
      className={cn(
        'flex min-h-11 flex-wrap items-center gap-3 border-b border-hairline bg-card px-4 py-2 text-[12.5px] md:px-5',
        alert && 'border-destructive/30 bg-destructive/5',
        className,
      )}
      role={alert ? 'alert' : 'status'}
      aria-live={alert ? 'assertive' : 'polite'}
    >
      {state.phase === 'ready' ? (
        <Check className="size-4 text-emerald-700" aria-hidden />
      ) : alert ? (
        <AlertTriangle className="size-4 text-destructive" aria-hidden />
      ) : (
        <Loader2
          className="size-4 animate-spin text-brand motion-reduce:animate-none"
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <span className="font-medium">{PHASE_COPY[state.phase]}</span>
        {state.label ? <span className="text-muted-foreground"> · {state.label}</span> : null}
        {state.message ? <span className="ml-2 text-muted-foreground">{state.message}</span> : null}
      </div>
      <span className="folio text-muted-foreground" aria-hidden="true">
        {Math.floor(elapsed / 60)
          .toString()
          .padStart(2, '0')}
        :{(elapsed % 60).toString().padStart(2, '0')}
      </span>
      {state.allowedActions.includes('retry-status') && (state.receipt || state.targetSha) ? (
        <Button size="sm" variant="outline" onClick={() => void retry()}>
          <RotateCw className="size-3.5" />
          Retry status
        </Button>
      ) : null}
      {state.allowedActions.includes('retry-request') && state.request && !state.receipt ? (
        <Button size="sm" variant="outline" onClick={() => void retry()}>
          <RotateCw className="size-3.5" />
          Retry save
        </Button>
      ) : null}
      {state.destination ? (
        <Button
          size="sm"
          variant="brand"
          onClick={() => {
            if (!state.destination) return;
            if (state.phase === 'delayed') {
              window.open(state.destination, '_blank', 'noopener,noreferrer');
            } else {
              window.location.assign(state.destination);
            }
          }}
        >
          {state.phase === 'delayed' ? 'Open current version' : 'Open change'}
        </Button>
      ) : null}
      {terminal ? (
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      ) : null}
    </section>
  );
}
