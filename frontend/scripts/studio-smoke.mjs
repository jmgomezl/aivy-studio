import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = Number(process.env.STUDIO_SMOKE_PORT || 5179);
const baseUrl = `http://${host}:${port}`;
const ignoredConsoleErrors = [
  /favicon/i,
  /Failed to load resource.*404/i,
  new RegExp(`WebSocket connection to 'ws://${host}:${port}/ws' failed`),
];

async function main() {
  const server = spawn(npmCommand(), ['run', 'dev', '--', '--host', host, '--port', String(port), '--strictPort'], {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  server.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await waitForServer();
    await runSmoke();
    console.log('Studio smoke passed');
  } catch (error) {
    console.error(serverOutput.trim());
    throw error;
  } finally {
    server.kill('SIGTERM');
  }
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/studio`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function runSmoke() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto(`${baseUrl}/studio`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.studio-canvas', { timeout: 15_000 });
    await clearStudioStorage(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.studio-canvas', { timeout: 15_000 });

    await assertSafeKickoffTemplate(page);
    await assertStarterTemplates(page);
    await assertCanvasBuilderFlow(page);
    await assertPersistenceFlow(page);
    assertNoRelevantErrors(errors);
  } finally {
    await clearStudioStorage(page).catch(() => {});
    await browser.close();
  }
}

async function assertSafeKickoffTemplate(page) {
  await page.getByText('Live template unchanged', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('Kickoff live template', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await page.locator('.react-flow__node').count(), 8, 'Kickoff template should load with 8 nodes');
  assert.equal(await page.locator('.template-card.starter').count(), 7, 'Studio should expose seven local starter templates');
  await page.getByText('OpenClaw Agent', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('x402 Payment', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('ENS Identity', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function assertStarterTemplates(page) {
  const starters = [
    ['Auction House', 5, 4],
    ['Supply Negotiator', 5, 4],
    ['DAO Approval', 5, 4],
    ['Escrow Release', 4, 3],
    ['OpenClaw Connector', 5, 4],
    ['x402 Paid Resource', 5, 4],
    ['ENS Agent Identity', 5, 4],
  ];

  for (const [name, nodeCount, edgeCount] of starters) {
    await page.locator('.template-card.starter').filter({ hasText: name }).click();
    await waitForGraphCounts(page, nodeCount, edgeCount);
    assert.equal(await page.locator('.workflow-name-input').inputValue(), name);
    await page.getByText('Local workflow', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });
    const timeline = await page.locator('.simulation-timeline').innerText({ timeout: 10_000 });
    assert.match(timeline, new RegExp(`0/${nodeCount + edgeCount}`));
  }
}

async function assertCanvasBuilderFlow(page) {
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByText('Add nodes to preview simulation steps', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });

  await dropPalette(page, 'Agent', 430, 220);
  await dropPalette(page, 'x402 Payment', 690, 220);
  await dropPalette(page, 'HCS-10 Channel', 950, 220);
  await waitForGraphCounts(page, 3, 0);
  await connectNodes(page, 'Agent', 'x402 Payment');
  await connectNodes(page, 'x402 Payment', 'HCS-10 Channel');
  await waitForGraphCounts(page, 3, 2);

  await page.getByText('pay', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('receipt', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('Edge inspector', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });

  await connectNodes(page, 'Agent', 'x402 Payment');
  await page.getByText('Connection already exists', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await page.locator('.react-flow__edge-path').count(), 2, 'Duplicate connection should not create another edge');

  await page.getByRole('button', { name: 'Step' }).click();
  await page.waitForFunction(() => document.querySelector('.simulation-timeline')?.innerText.includes('1/5'), null, { timeout: 10_000 });
  assert.equal(await page.locator('.timeline-item.done').count(), 1);
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.waitForFunction(() => document.querySelector('.simulation-timeline')?.innerText.includes('0/5'), null, { timeout: 10_000 });
}

async function assertPersistenceFlow(page) {
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.locator('.workflow-name-input').fill('Studio smoke saved workflow');
  await dropPalette(page, 'Agent', 430, 220);
  await waitForGraphCounts(page, 1, 0);
  await page.getByText('Draft saved locally', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });

  let storage = await readStudioStorage(page);
  assert.equal(storage.lastOpened, 'draft');
  assert.equal(storage.draft.name, 'Studio smoke saved workflow');
  assert.equal(storage.draft.nodes.length, 1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGraphCounts(page, 1, 0);
  assert.equal(await page.locator('.workflow-name-input').inputValue(), 'Studio smoke saved workflow');

  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved just now', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });
  storage = await readStudioStorage(page);
  assert.equal(storage.draft, null, 'Manual save should clear the draft');
  assert.equal(storage.workflows[0].name, 'Studio smoke saved workflow');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForGraphCounts(page, 1, 0);
  await page.getByText('Saved locally', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function clearStudioStorage(page) {
  await page.evaluate(() => {
    localStorage.removeItem('aivy-studio-workflows');
    localStorage.removeItem('aivy-studio-draft');
    localStorage.removeItem('aivy-studio-last-opened');
  });
}

async function readStudioStorage(page) {
  return page.evaluate(() => ({
    draft: JSON.parse(localStorage.getItem('aivy-studio-draft') || 'null'),
    lastOpened: localStorage.getItem('aivy-studio-last-opened'),
    workflows: JSON.parse(localStorage.getItem('aivy-studio-workflows') || '[]'),
  }));
}

async function waitForGraphCounts(page, nodes, edges) {
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll('.react-flow__node').length === expected.nodes &&
      document.querySelectorAll('.react-flow__edge-path').length === expected.edges,
    { nodes, edges },
    { timeout: 10_000 }
  );
}

async function connectNodes(page, sourceLabel, targetLabel) {
  const source = graphNodeByTitle(page, sourceLabel).locator('.kn-handle-source');
  const target = graphNodeByTitle(page, targetLabel).locator('.kn-handle-target');
  await source.dragTo(target, { force: true, sourcePosition: { x: 2, y: 2 }, targetPosition: { x: 2, y: 2 } });
}

function graphNodeByTitle(page, title) {
  return page.locator('.react-flow__node').filter({ has: page.locator('.kn-title', { hasText: new RegExp(`^${escapeRegExp(title)}$`) }) });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function dropPalette(page, label, x, y) {
  const source = page.locator('.palette-item').filter({ hasText: label }).first();
  await source.waitFor({ state: 'visible', timeout: 10_000 });
  const data = await source.evaluate((element) => {
    const title = element.querySelector('.template-name')?.textContent?.trim() || 'Node';
    const sub = element.querySelector('.template-desc')?.textContent?.trim() || '';
    const icon = element.querySelector('.palette-icon')?.textContent?.trim() || '🤖';
    const kindByTitle = { Agent: 'agent', 'HCS-10 Channel': 'hcs10', 'OpenClaw Agent': 'openclaw', 'x402 Payment': 'x402', 'ENS Identity': 'ens' };
    const colorByKind = { agent: '#A78BFA', hcs10: '#00FF87', openclaw: '#F97316', x402: '#22C55E', ens: '#5298FF' };
    const kind = kindByTitle[title] || 'custom';
    return { kind, icon, color: colorByKind[kind] || '#A78BFA', title, sub, detail: '', config: {} };
  });
  const dataTransfer = await page.evaluateHandle((payload) => {
    const transfer = new DataTransfer();
    transfer.setData('application/reactflow', JSON.stringify(payload));
    return transfer;
  }, data);

  await page.locator('.studio-canvas').dispatchEvent('dragover', { clientX: x, clientY: y, dataTransfer });
  await page.locator('.studio-canvas').dispatchEvent('drop', { clientX: x, clientY: y, dataTransfer });
}

function assertNoRelevantErrors(errors) {
  const relevantErrors = errors.filter((error) => !ignoredConsoleErrors.some((pattern) => pattern.test(error)));
  assert.deepEqual(relevantErrors, [], 'No relevant browser console errors expected');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
