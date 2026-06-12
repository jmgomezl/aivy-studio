const WORKFLOW_KEY = 'aivy-studio-workflows';

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
  return workflows;
}
