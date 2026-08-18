export function assertExecutionAllowed({
  scheduled,
  dispatchedByScheduler,
  agendaId,
  familiaId,
  dryRun,
}) {
  if (dryRun) return;

  if (!scheduled || !dispatchedByScheduler || !agendaId || !familiaId) {
    throw new Error(
      "Execucao bloqueada: coletas com gravacao so podem ser iniciadas por uma agenda ativa.",
    );
  }
}

export function shouldPrepareRuntimeSchema({ dryRun }) {
  return dryRun !== true;
}
