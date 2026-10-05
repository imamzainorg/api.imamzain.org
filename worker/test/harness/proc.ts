import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const WIN = process.platform === 'win32';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  /** Through the shell: needed for `npm` on Windows (npm.cmd). */
  shell?: boolean;
  /** Return the result instead of throwing on a non-zero exit. */
  allowFail?: boolean;
  /** Also write stdout + stderr here. */
  logFile?: string;
}

export interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** Runs a command to completion. Throws with the tail of its output on a non-zero exit unless `allowFail`. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: opts.shell, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() };
      if (opts.logFile) {
        fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
        fs.writeFileSync(opts.logFile, Buffer.concat([result.stdout, Buffer.from(result.stderr)]));
      }
      if (result.code !== 0 && !opts.allowFail) {
        const tail = (result.stderr || result.stdout.toString()).trim().split('\n').slice(-15).join('\n');
        reject(new Error(`${cmd} ${args.join(' ')} exited ${result.code}\n${tail}`));
      } else resolve(result);
    });
    child.stdin.end(opts.input ?? '');
  });
}

/** A long-running process with stdout + stderr in `logFile`. Detached on POSIX so `stopTree` can kill its group. */
export function startBackground(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; logFile: string }): ChildProcess {
  fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
  const fd = fs.openSync(opts.logFile, 'w');
  const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', fd, fd], detached: !WIN });
  fs.closeSync(fd);
  return child;
}

/** Kills the process and everything it started (wrangler → workerd). */
export async function stopTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (WIN) await run('taskkill', ['/PID', String(child.pid), '/T', '/F'], { allowFail: true });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
}

export function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });
}

/** Polls `url` until it answers (any status). Fails early with the log tail if the process exits first. */
export async function waitForHttp(url: string, child: ChildProcess, logFile: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`process for ${url} exited ${child.exitCode}\n${tail(logFile)}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${url} not up after ${timeoutMs / 1000}s\n${tail(logFile)}`);
}

export function tail(file: string, lines = 15): string {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/** Only the OS variables a child needs, so no secret from the caller's shell (DATABASE_URL, R2_*, SMTP_*) leaks in. */
export function baseEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'XDG_CONFIG_HOME', 'CI'];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}
