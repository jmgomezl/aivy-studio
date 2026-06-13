const WORKFLOW_KEY = 'aivy-studio-workflows';
const DRAFT_KEY = 'aivy-studio-draft';
const LAST_OPENED_KEY = 'aivy-studio-last-opened';

export function readWorkflows() {
  if (typeof window === 'undefined') return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKFLOW_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeWorkflows(workflows) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(WORKFLOW_KEY, JSON.stringify(workflows));
}

export function saveWorkflow(workflow) {
  const workflows = readWorkflows();
  const id = workflow.id || `workflow-${Date.now().toString(36)}`;
  const saved = { ...workflow, id, updatedAt: new Date().toISOString() };
  const existingIndex = workflows.findIndex((item) => item.id === id);

  if (existingIndex >= 0) {
    workflows.splice(existingIndex, 1, saved);
  } else {
    workflows.unshift(saved);
  }

  writeWorkflows(workflows);
  return saved;
}

export function deleteWorkflow(id) {
  const workflows = readWorkflows().filter((workflow) => workflow.id !== id);
  writeWorkflows(workflows);
  clearDraft(id);
  if (readLastOpenedWorkflowId() === id) {
    window.localStorage.removeItem(LAST_OPENED_KEY);
  }
  return workflows;
}

export function readDraft() {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDraft(workflow) {
  if (typeof window === 'undefined') return null;
  const saved = { ...workflow, id: workflow.id || 'draft', updatedAt: new Date().toISOString() };
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(saved));
  return saved;
}

export function clearDraft(sourceWorkflowId) {
  if (typeof window === 'undefined') return;
  if (!sourceWorkflowId) {
    window.localStorage.removeItem(DRAFT_KEY);
    return;
  }

  const draft = readDraft();
  if (draft?.sourceWorkflowId === sourceWorkflowId || draft?.id === sourceWorkflowId) {
    window.localStorage.removeItem(DRAFT_KEY);
  }
}

export function readLastOpenedWorkflowId() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(LAST_OPENED_KEY) || '';
}

export function writeLastOpenedWorkflowId(id) {
  if (typeof window === 'undefined') return;
  if (!id) {
    window.localStorage.removeItem(LAST_OPENED_KEY);
    return;
  }
  window.localStorage.setItem(LAST_OPENED_KEY, id);
}
