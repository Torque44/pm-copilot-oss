// Anthropic provider — supports two auth paths, auto-detected:
//
//   1. ANTHROPIC_API_KEY in env  →  use @anthropic-ai/sdk with the API key.
//   2. Local Claude Code session →  shell out to `claude -p` (subprocess).
//
// The Claude Code path is the v1 default — it rides the user's local OAuth
// session, no key required. The SDK path is for users who have an explicit
// Anthropic API key (or want to run on a host where Claude Code is not
// installed — e.g. Azure App Service later).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import type {
  CompleteOpts,
  CompleteResult,
  LLMProvider,
  ProviderCapabilities,
} from './types';

const briefLimit = pLimit(4);
const askLimit = pLimit(2);

const DEFAULT_TIMEOUT_MS = 30_000;

function tierToModel(tier: 'fast' | 'reasoning'): string {
  return tier === 'reasoning' ? 'claude-sonnet-4-5' : 'claude-haiku-4-5';
}

// ---------------- subprocess (Claude Code) path ----------------

function resolveClaudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // lib/providers/anthropic.ts → repoRoot is two levels up
  const repoRoot = path.join(__dirname, '..', '..');
  const isWin = process.platform === 'win32';
  const nativeExe = path.join(
    repoRoot,
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    isWin ? 'claude.exe' : 'claude'
  );
  if (existsSync(nativeExe)) return nativeExe;
  const shim = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    isWin ? 'claude.cmd' : 'claude'
  );
  if (existsSync(shim)) return shim;
  return 'claude';
}

const CLAUDE_BIN = resolveClaudeBin();
const BIN_IS_NATIVE_EXE =
  /\.exe$/i.test(CLAUDE_BIN) ||
  (!/\.cmd$/i.test(CLAUDE_BIN) && process.platform !== 'win32');

async function callViaSubprocess(
  prompt: string,
  opts: CompleteOpts
): Promise<CompleteResult> {
  const started = Date.now();
  const model = opts.model ?? tierToModel(opts.tier ?? 'reasoning');
  const args: string[] = ['-p', '--model', model, '--output-format', 'text'];

  let system = opts.systemPrompt ?? '';
  if (opts.jsonOnly) {
    const j =
      'Respond with ONLY a JSON object matching the requested shape. No prose, no markdown fences, no commentary.';
    system = system ? `${system}\n\n${j}` : j;
  }
  if (system) args.push('--append-system-prompt', system);
  if (opts.allowedTools?.length) {
    args.push('--allowedTools', opts.allowedTools.join(','));
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Strip env vars that confuse `claude` auth resolution.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  delete childEnv.ANTHROPIC_BASE_URL;
  delete childEnv.CLAUDE_CODE_USE_BEDROCK;
  delete childEnv.CLAUDE_CODE_USE_VERTEX;

  return new Promise<CompleteResult>((resolve) => {
    const child = spawn(CLAUDE_BIN, args, {
      shell: !BIN_IS_NATIVE_EXE,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const killer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      resolve({
        ok: false,
        text: stdout.trim(),
        error: `timeout after ${timeoutMs}ms`,
        elapsedMs: Date.now() - started,
        model,
        provider: 'anthropic',
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve({
        ok: false,
        text: '',
        error: `spawn error: ${err.message}`,
        elapsedMs: Date.now() - started,
        model,
        provider: 'anthropic',
      });
    });

    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      const text = stdout.trim();
      if (code !== 0 && !text) {
        resolve({
          ok: false,
          text: '',
          error: `exit ${code}: ${stderr.trim().slice(0, 500)}`,
          elapsedMs: Date.now() - started,
          model,
          provider: 'anthropic',
        });
        return;
      }
      resolve({
        ok: true,
        text,
        elapsedMs: Date.now() - started,
        model,
        provider: 'anthropic',
      });
    });

    try {
      child.stdin?.write(prompt);
      child.stdin?.end();
    } catch (err: any) {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve({
        ok: false,
        text: '',
        error: `stdin write failed: ${err?.message ?? 'unknown'}`,
        elapsedMs: Date.now() - started,
        model,
        provider: 'anthropic',
      });
    }
  });
}

// ---------------- API-key path (@anthropic-ai/sdk) ----------------

async function callViaSdk(
  prompt: string,
  opts: CompleteOpts,
  apiKey: string
): Promise<CompleteResult> {
  const started = Date.now();
  const model = opts.model ?? tierToModel(opts.tier ?? 'reasoning');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let system = opts.systemPrompt ?? '';
  if (opts.jsonOnly) {
    const j =
      'Respond with ONLY a JSON object matching the requested shape. No prose, no markdown fences, no commentary.';
    system = system ? `${system}\n\n${j}` : j;
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey, timeout: timeoutMs });
    const resp = await client.messages.create({
      model,
      max_tokens: 2048,
      system: system || undefined,
      messages: [{ role: 'user', content: prompt }],
    });
    const text =
      resp.content
        ?.map((b: any) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim() ?? '';
    return {
      ok: true,
      text,
      elapsedMs: Date.now() - started,
      model,
      provider: 'anthropic',
    };
  } catch (err: any) {
    return {
      ok: false,
      text: '',
      error: err?.message ?? 'sdk call failed',
      elapsedMs: Date.now() - started,
      model,
      provider: 'anthropic',
    };
  }
}

// ---------------- public provider ----------------

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  readonly capabilities: ProviderCapabilities;

  private readonly mode: 'sdk' | 'subprocess';
  private readonly apiKey?: string;

  constructor(opts?: { apiKey?: string | null }) {
    const explicitKey = opts?.apiKey ?? null;
    const envKey = process.env.ANTHROPIC_API_KEY;
    const key = explicitKey || envKey;
    if (key) {
      this.mode = 'sdk';
      this.apiKey = key;
      this.capabilities = {
        nativeJsonMode: false,
        webSearch: false,
        authViaSession: false,
      };
    } else {
      this.mode = 'subprocess';
      this.capabilities = {
        nativeJsonMode: false,
        webSearch: true, // via --allowedTools=WebSearch
        authViaSession: true,
      };
    }
  }

  async complete(prompt: string, opts: CompleteOpts = {}): Promise<CompleteResult> {
    const pool = opts.lane === 'ask' ? askLimit : briefLimit;
    return pool(async () => {
      if (this.mode === 'sdk' && this.apiKey) {
        return callViaSdk(prompt, opts, this.apiKey);
      }
      return callViaSubprocess(prompt, opts);
    });
  }
}

/** Factory: returns an LLMProvider bound to the given API key (or env fallback). */
export function makeAnthropicProvider(apiKey?: string | null): LLMProvider {
  return new AnthropicProvider({ apiKey });
}
